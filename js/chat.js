// Chat: customer <-> owner messaging, plus owner dashboard (pin, ban,
// orders, to-dos). Access is enforced by Row Level Security in Supabase;
// this file just renders whichever view the logged-in role is allowed.
import {
  supabase, isConfigured, showNotConfiguredBanner,
  getSession, getProfile, signOut,
} from './supabase-client.js';

const signedOut = document.getElementById('signed-out');
const customerView = document.getElementById('customer-view');
const ownerView = document.getElementById('owner-view');

let me = null;              // my profile row
const profileCache = {};    // id -> profile (for names/avatars)

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
async function cacheProfiles(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !profileCache[id]);
  if (!missing.length) return;
  const { data } = await supabase.from('profiles').select('*').in('id', missing);
  (data || []).forEach((p) => { profileCache[p.id] = p; });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (!isConfigured()) {
  showNotConfiguredBanner(document.querySelector('.chat-page'));
  signedOut.hidden = false;
} else {
  boot();
}

async function boot() {
  const session = await getSession();
  if (!session) { signedOut.hidden = false; return; }
  me = await getProfile();
  if (!me) { signedOut.hidden = false; return; }
  profileCache[me.id] = me;

  const slot = document.getElementById('nav-account-slot');
  slot.innerHTML = '<a class="nav-cta" href="account.html">' + esc(me.username) + '</a>';

  if (me.role === 'owner') initOwner();
  else initCustomer();
}

// ===========================================================================
// CUSTOMER VIEW
// ===========================================================================
async function initCustomer() {
  customerView.hidden = false;
  const conv = await ensureConversation();
  if (!conv) return;

  await loadCustomerMessages(conv.id);
  await loadCustomerOrders(conv.id);

  // live updates for this conversation
  supabase.channel('cust-msgs-' + conv.id)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conv.id },
      (payload) => appendMessage('cust-messages', payload.new))
    .subscribe();

  const form = document.getElementById('cust-composer');
  const input = document.getElementById('cust-input');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    const { error } = await supabase.from('messages').insert({
      conversation_id: conv.id, sender_id: me.id, content,
    });
    if (error) alert(error.message);
  });
}

async function ensureConversation() {
  const { data: existing } = await supabase
    .from('conversations').select('*').eq('customer_id', me.id).maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase
    .from('conversations').insert({ customer_id: me.id }).select().single();
  if (error) { alert(error.message); return null; }
  return data;
}

async function loadCustomerMessages(convId) {
  const { data } = await supabase
    .from('messages').select('*').eq('conversation_id', convId).order('created_at');
  const box = document.getElementById('cust-messages');
  box.innerHTML = '';
  (data || []).forEach((m) => appendMessage('cust-messages', m));
}

async function loadCustomerOrders(convId) {
  const { data } = await supabase
    .from('orders').select('*').eq('conversation_id', convId).order('created_at');
  const wrap = document.getElementById('cust-orders');
  const empty = document.getElementById('cust-orders-empty');
  wrap.innerHTML = '';
  if (!data || !data.length) { empty.hidden = false; return; }
  empty.hidden = true;
  data.forEach((o) => wrap.insertAdjacentHTML('beforeend', orderCardReadOnly(o)));
}

function orderCardReadOnly(o) {
  return (
    '<div class="order-card">' +
      '<div class="order-card-top">' +
        '<strong>' + esc(o.title) + '</strong>' +
        statusBadge(o.status) +
      '</div>' +
      (o.details ? '<p>' + esc(o.details) + '</p>' : '') +
      '<div class="order-meta">' +
        '<span>Qty: ' + esc(o.quantity) + '</span>' +
        priorityBadge(o.priority) +
      '</div>' +
    '</div>'
  );
}

// ===========================================================================
// SHARED message rendering
// ===========================================================================
function appendMessage(boxId, m) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const mine = m.sender_id === me.id;
  const sender = profileCache[m.sender_id];
  const name = mine ? 'You' : (sender ? sender.username : 'Them');
  const row = document.createElement('div');
  row.className = 'msg-row ' + (mine ? 'mine' : 'theirs');
  row.innerHTML =
    '<div class="msg-bubble">' +
      '<span class="msg-name">' + esc(name) + '</span>' +
      '<span class="msg-text">' + esc(m.content) + '</span>' +
      '<span class="msg-time">' + fmtTime(m.created_at) + '</span>' +
    '</div>';
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

// ===========================================================================
// OWNER DASHBOARD
// ===========================================================================
let activeConv = null;
let activeMsgChannel = null;

async function initOwner() {
  ownerView.hidden = false;
  await loadConversations();
  await loadTodos();

  // refresh sidebar whenever any conversation changes (new message bumps it)
  supabase.channel('owner-convs')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' },
      () => loadConversations())
    .subscribe();

  document.getElementById('owner-composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeConv) return;
    const input = document.getElementById('owner-input');
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    const { error } = await supabase.from('messages').insert({
      conversation_id: activeConv.id, sender_id: me.id, content,
    });
    if (error) alert(error.message);
  });

  document.getElementById('add-order').addEventListener('click', addOrder);
  document.getElementById('todo-add').addEventListener('submit', addTodo);
}

async function loadConversations() {
  const { data: convs } = await supabase.from('conversations').select('*');
  const list = convs || [];
  await cacheProfiles(list.map((c) => c.customer_id));

  // pinned first, then most recent activity
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });

  const wrap = document.getElementById('conv-items');
  const empty = document.getElementById('conv-empty');
  wrap.innerHTML = '';
  empty.hidden = list.length > 0;

  list.forEach((c) => {
    const p = profileCache[c.customer_id] || {};
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'conv-item' + (activeConv && activeConv.id === c.id ? ' is-active' : '');
    item.innerHTML =
      '<img class="conv-avatar" src="' + esc(p.avatar_url || 'assets/avatar.svg') + '" alt="">' +
      '<span class="conv-name">' + esc(p.username || 'User') +
        (p.banned ? ' <span class="ban-tag">banned</span>' : '') + '</span>' +
      (c.pinned ? '<span class="pin-dot" title="Pinned">📌</span>' : '');
    item.addEventListener('click', () => openConversation(c));
    wrap.appendChild(item);
  });
}

async function openConversation(conv) {
  activeConv = conv;
  const p = profileCache[conv.customer_id] || {};

  // header with pin + ban controls
  const head = document.getElementById('owner-chat-head');
  head.innerHTML =
    '<img src="' + esc(p.avatar_url || 'assets/avatar.svg') + '" alt="" class="chat-head-avatar">' +
    '<div class="chat-head-info"><strong>' + esc(p.username || 'User') + '</strong>' +
      '<span class="chat-head-sub">' + (p.banned ? 'Banned account' : 'Customer') + '</span></div>' +
    '<div class="chat-head-actions">' +
      '<button class="btn btn-soft btn-sm" id="pin-btn">' + (conv.pinned ? 'Unpin' : 'Pin') + '</button>' +
      '<button class="btn btn-sm ' + (p.banned ? 'btn-soft' : 'btn-danger') + '" id="ban-btn">' +
        (p.banned ? 'Unban' : 'Ban') + '</button>' +
    '</div>';
  document.getElementById('pin-btn').addEventListener('click', () => togglePin(conv));
  document.getElementById('ban-btn').addEventListener('click', () => toggleBan(conv, p));

  document.getElementById('owner-composer').hidden = false;
  document.getElementById('owner-side').hidden = false;

  // messages
  const { data } = await supabase
    .from('messages').select('*').eq('conversation_id', conv.id).order('created_at');
  const box = document.getElementById('owner-messages');
  box.innerHTML = '';
  (data || []).forEach((m) => appendMessage('owner-messages', m));

  // realtime for this conversation
  if (activeMsgChannel) supabase.removeChannel(activeMsgChannel);
  activeMsgChannel = supabase.channel('owner-msgs-' + conv.id)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conv.id },
      (payload) => { if (activeConv && activeConv.id === conv.id) appendMessage('owner-messages', payload.new); })
    .subscribe();

  await loadOwnerOrders(conv.id);
  // reflect active highlight
  document.querySelectorAll('.conv-item').forEach((el) => el.classList.remove('is-active'));
}

async function togglePin(conv) {
  const { error } = await supabase
    .from('conversations').update({ pinned: !conv.pinned }).eq('id', conv.id);
  if (error) return alert(error.message);
  conv.pinned = !conv.pinned;
  await loadConversations();
  openConversation(conv);
}

async function toggleBan(conv, p) {
  const next = !p.banned;
  if (next && !confirm('Ban ' + (p.username || 'this user') + '? They won\'t be able to send messages.')) return;
  const { error } = await supabase
    .from('profiles').update({ banned: next }).eq('id', conv.customer_id);
  if (error) return alert(error.message);
  profileCache[conv.customer_id] = { ...p, banned: next };
  await loadConversations();
  openConversation(conv);
}

// ---- Orders (owner editable) ----------------------------------------------
async function loadOwnerOrders(convId) {
  const { data } = await supabase
    .from('orders').select('*').eq('conversation_id', convId).order('created_at');
  const wrap = document.getElementById('owner-orders');
  wrap.innerHTML = '';
  (data || []).forEach((o) => wrap.appendChild(orderCardEditable(o)));
}

function orderCardEditable(o) {
  const card = document.createElement('div');
  card.className = 'order-card editable';
  card.innerHTML =
    '<input class="order-title" value="' + esc(o.title) + '" maxlength="80">' +
    '<textarea class="order-details" rows="2" placeholder="Details…">' + esc(o.details || '') + '</textarea>' +
    '<div class="order-row">' +
      '<label>Qty <input class="order-qty" type="number" min="1" value="' + esc(o.quantity) + '"></label>' +
      '<label>Priority <select class="order-priority">' +
        opt('normal', o.priority) + opt('high', o.priority) + opt('paid extra', o.priority) +
      '</select></label>' +
    '</div>' +
    '<div class="order-row">' +
      '<label>Status <select class="order-status">' +
        opt('requested', o.status) + opt('in progress', o.status) + opt('done', o.status) +
      '</select></label>' +
    '</div>' +
    '<div class="order-row order-actions">' +
      '<button class="btn btn-soft btn-sm order-save">Save</button>' +
      '<button class="link-btn danger order-del">Delete</button>' +
    '</div>';

  card.querySelector('.order-save').addEventListener('click', async () => {
    const upd = {
      title: card.querySelector('.order-title').value.trim() || 'Order',
      details: card.querySelector('.order-details').value.trim(),
      quantity: Math.max(1, parseInt(card.querySelector('.order-qty').value, 10) || 1),
      priority: card.querySelector('.order-priority').value,
      status: card.querySelector('.order-status').value,
    };
    const { error } = await supabase.from('orders').update(upd).eq('id', o.id);
    if (error) return alert(error.message);
    const btn = card.querySelector('.order-save');
    btn.textContent = 'Saved ✓';
    setTimeout(() => (btn.textContent = 'Save'), 1200);
  });

  card.querySelector('.order-del').addEventListener('click', async () => {
    if (!confirm('Delete this order card?')) return;
    const { error } = await supabase.from('orders').delete().eq('id', o.id);
    if (error) return alert(error.message);
    card.remove();
  });

  return card;
}

function opt(val, current) {
  return '<option value="' + val + '"' + (val === current ? ' selected' : '') + '>' + val + '</option>';
}

async function addOrder() {
  if (!activeConv) return;
  const { error } = await supabase.from('orders').insert({ conversation_id: activeConv.id });
  if (error) return alert(error.message);
  await loadOwnerOrders(activeConv.id);
}

// ---- To-dos (owner only) ---------------------------------------------------
async function loadTodos() {
  const { data } = await supabase.from('todos').select('*').order('created_at');
  const wrap = document.getElementById('todo-list');
  wrap.innerHTML = '';
  (data || []).forEach((t) => wrap.appendChild(todoRow(t)));
}

function todoRow(t) {
  const row = document.createElement('div');
  row.className = 'todo-row' + (t.done ? ' done' : '');
  row.innerHTML =
    '<label><input type="checkbox"' + (t.done ? ' checked' : '') + '> <span>' + esc(t.content) + '</span></label>' +
    '<button class="link-btn danger todo-del">✕</button>';
  row.querySelector('input').addEventListener('change', async (e) => {
    await supabase.from('todos').update({ done: e.target.checked }).eq('id', t.id);
    row.classList.toggle('done', e.target.checked);
  });
  row.querySelector('.todo-del').addEventListener('click', async () => {
    await supabase.from('todos').delete().eq('id', t.id);
    row.remove();
  });
  return row;
}

async function addTodo(e) {
  e.preventDefault();
  const input = document.getElementById('todo-input');
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  const { data, error } = await supabase.from('todos').insert({ content }).select().single();
  if (error) return alert(error.message);
  document.getElementById('todo-list').appendChild(todoRow(data));
}

// ---- Badges ----------------------------------------------------------------
function statusBadge(s) {
  const cls = s === 'done' ? 'ok' : s === 'in progress' ? 'warn' : 'muted';
  return '<span class="badge badge-' + cls + '">' + esc(s) + '</span>';
}
function priorityBadge(p) {
  if (p === 'normal') return '';
  const cls = p === 'paid extra' ? 'hot' : 'warn';
  return '<span class="badge badge-' + cls + '">' + esc(p) + '</span>';
}
