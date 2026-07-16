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
let emojiMap = {};          // shortcode name -> image url
let emojiList = [];         // [{name, image_url}] for the picker

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Escape text, then swap any :shortcode: for its custom-emoji image.
function renderContent(text) {
  return esc(text).replace(/:([a-z0-9_]+):/g, (whole, name) => (
    emojiMap[name]
      ? '<img class="chat-emoji" src="' + esc(emojiMap[name]) + '" alt=":' + name + ':" title=":' + name + ':">'
      : whole
  ));
}

async function loadEmojis() {
  const { data } = await supabase.from('emojis').select('*').order('name');
  emojiList = data || [];
  emojiMap = {};
  emojiList.forEach((e) => { emojiMap[e.name] = e.image_url; });
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

  await loadEmojis();

  if (me.role === 'owner') initOwner();
  else initCustomer();
}

// ===========================================================================
// CUSTOMER VIEW
// ===========================================================================
let custConvId = null;

async function initCustomer() {
  customerView.hidden = false;
  const conv = await ensureConversation();
  if (!conv) return;
  custConvId = conv.id;

  await refreshCustomer();
  await loadCustomerOrders(conv.id);

  // live updates: re-render on any message change (insert / edit / delete / pin)
  supabase.channel('cust-msgs-' + conv.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conv.id },
      () => refreshCustomer())
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

  document.getElementById('cust-file').addEventListener('change', (e) =>
    sendAttachment(e.target, conv.id));

  wireEmojiPicker('cust-emoji-btn', 'cust-emoji-pop', 'cust-input');
}

async function refreshCustomer() {
  const { data } = await supabase
    .from('messages').select('*').eq('conversation_id', custConvId).order('created_at');
  // RLS already hides deleted from customers; filter again to be safe.
  const msgs = (data || []).filter((m) => !m.deleted_at);
  renderMessages('cust-messages', msgs, custConvId);
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

// Render a whole list of (non-deleted) messages into a box, with a pinned strip
// at the top. convId lets the message actions know where they belong.
function renderMessages(boxId, msgs, convId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = '';

  const pinned = msgs.filter((m) => m.pinned);
  if (pinned.length) box.appendChild(buildPinnedBar(pinned, box));

  msgs.forEach((m) => box.appendChild(buildMessageRow(m, convId)));
  box.scrollTop = box.scrollHeight;
}

function buildPinnedBar(pinned, box) {
  const bar = document.createElement('div');
  bar.className = 'pinned-bar';
  bar.innerHTML = '<span class="pinned-bar-title">📌 Pinned</span>';
  pinned.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = renderContent(m.content || (m.image_url ? '📷 image' : (m.file_name || 'file')));
    b.addEventListener('click', () => {
      const target = box.querySelector('[data-mid="' + m.id + '"]');
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.querySelector('.msg-bubble').classList.add('msg-flash');
        setTimeout(() => target.querySelector('.msg-bubble').classList.remove('msg-flash'), 1400);
      }
    });
    bar.appendChild(b);
  });
  return bar;
}

function buildMessageRow(m, convId) {
  const mine = m.sender_id === me.id;
  const sender = profileCache[m.sender_id];
  const name = mine ? 'You' : (sender ? sender.username : 'Them');
  const row = document.createElement('div');
  row.className = 'msg-row ' + (mine ? 'mine' : 'theirs');
  row.dataset.mid = m.id;

  let body = '';
  if (m.content) body += '<span class="msg-text">' + renderContent(m.content) + '</span>';
  if (m.image_url) {
    body += '<a class="msg-image-link" href="' + esc(m.image_url) + '" target="_blank" rel="noopener">' +
      '<img class="msg-image" src="' + esc(m.image_url) + '" alt="shared image"></a>';
  }
  if (m.file_url) {
    const fname = m.file_name || 'file';
    body += '<a class="msg-file" href="' + esc(m.file_url) + '" download="' + esc(fname) + '" target="_blank" rel="noopener">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>' +
      '<span>' + esc(fname) + '</span></a>';
  }

  const editedTag = m.edited_at ? '<span class="msg-edited">(edited)</span>' : '';
  const pinTag = m.pinned ? '<span class="msg-pin-tag">📌 pinned</span> ' : '';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble' + (m.pinned ? ' pinned' : '');
  bubble.innerHTML =
    '<span class="msg-name">' + esc(name) + '</span>' +
    body +
    '<span class="msg-time">' + pinTag + fmtTime(m.created_at) + editedTag + '</span>';

  bubble.appendChild(buildMsgActions(m, convId, bubble));
  row.appendChild(bubble);
  return row;
}

// The little hover toolbar on each message.
function buildMsgActions(m, convId, bubble) {
  const bar = document.createElement('div');
  bar.className = 'msg-actions';
  const mine = m.sender_id === me.id;
  const canDelete = mine || me.role === 'owner';
  const canEdit = mine && m.content; // only text you wrote

  const add = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    bar.appendChild(b);
  };

  // Both participants may pin.
  add(m.pinned ? '📌' : '📍', m.pinned ? 'Unpin' : 'Pin', () => togglePinMessage(m));
  if (canEdit) add('✎', 'Edit', () => startEditMessage(m, bubble, convId));
  if (canDelete) add('🗑', 'Delete', () => deleteMessage(m));

  return bar;
}

async function togglePinMessage(m) {
  const { error } = await supabase.from('messages').update({ pinned: !m.pinned }).eq('id', m.id);
  if (error) alert(error.message);
}

async function deleteMessage(m) {
  if (!confirm('Delete this message? It will be hidden from the chat.')) return;
  const { error } = await supabase.from('messages')
    .update({ deleted_at: new Date().toISOString() }).eq('id', m.id);
  if (error) alert(error.message);
}

function startEditMessage(m, bubble, convId) {
  const editor = document.createElement('div');
  editor.className = 'msg-edit';
  editor.innerHTML =
    '<textarea maxlength="1000"></textarea>' +
    '<div class="msg-edit-actions">' +
      '<button class="btn btn-primary btn-sm" type="button">Save</button>' +
      '<button class="link-btn" type="button">Cancel</button>' +
    '</div>';
  const ta = editor.querySelector('textarea');
  ta.value = m.content || '';
  const prev = bubble.innerHTML;
  bubble.innerHTML = '';
  bubble.appendChild(editor);
  ta.focus();

  editor.querySelector('.btn-primary').addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) return;
    if (text === m.content) { bubble.innerHTML = prev; return; }
    const { error } = await supabase.from('messages').update({ content: text }).eq('id', m.id);
    if (error) { alert(error.message); bubble.innerHTML = prev; }
    // success → realtime refresh redraws the row
  });
  editor.querySelector('.link-btn').addEventListener('click', () => { bubble.innerHTML = prev; });
}

// Upload any file (up to 30 MB) and post it as a message. Images preview inline
// (image_url); everything else shows as a download link (file_url + file_name).
const MAX_UPLOAD = 30 * 1024 * 1024;

async function sendAttachment(fileInput, convId) {
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > MAX_UPLOAD) { alert('Files must be under 30 MB.'); fileInput.value = ''; return; }

  const isImage = file.type.startsWith('image/');
  const bucket = isImage ? 'chat-images' : 'chat-files';
  // Keep the original extension; make the object name unique + safe.
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${me.id}/${Date.now()}-${safe}`;

  const { error: upErr } = await supabase.storage.from(bucket)
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (upErr) { alert(upErr.message); fileInput.value = ''; return; }

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
  const row = { conversation_id: convId, sender_id: me.id };
  if (isImage) row.image_url = pub.publicUrl;
  else { row.file_url = pub.publicUrl; row.file_name = file.name; }

  const { error } = await supabase.from('messages').insert(row);
  if (error) alert(error.message);
  fileInput.value = '';
}

// ---------------------------------------------------------------------------
// Emoji picker (used by both composers). Clicking an emoji inserts :name: into
// the given text input at the cursor.
// ---------------------------------------------------------------------------
function wireEmojiPicker(btnId, popId, inputId) {
  const btn = document.getElementById(btnId);
  const pop = document.getElementById(popId);
  const input = document.getElementById(inputId);
  if (!btn || !pop || !input) return;

  renderEmojiPicker(pop, input);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  // close when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true;
  });
}

function renderEmojiPicker(pop, input) {
  if (!emojiList.length) {
    pop.innerHTML = '<p class="emoji-pop-empty">No custom emojis yet' +
      (me && me.role === 'owner' ? ' — add some in the panel on the right.' : '.') + '</p>';
    return;
  }
  pop.innerHTML = '';
  emojiList.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = ':' + em.name + ':';
    b.innerHTML = '<img src="' + esc(em.image_url) + '" alt=":' + esc(em.name) + ':">';
    b.addEventListener('click', () => insertAtCursor(input, ':' + em.name + ':'));
    pop.appendChild(b);
  });
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const caret = start + text.length;
  input.setSelectionRange(caret, caret);
  input.focus();
}

// Refresh every picker on the page (after the owner adds/removes an emoji).
function refreshEmojiPickers() {
  [['cust-emoji-pop', 'cust-input'], ['owner-emoji-pop', 'owner-input']].forEach(([popId, inputId]) => {
    const pop = document.getElementById(popId);
    const input = document.getElementById(inputId);
    if (pop && input) renderEmojiPicker(pop, input);
  });
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
  await loadAutoReply();

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

  document.getElementById('owner-file').addEventListener('change', (e) => {
    if (!activeConv) return;
    sendAttachment(e.target, activeConv.id);
  });

  wireEmojiPicker('owner-emoji-btn', 'owner-emoji-pop', 'owner-input');
  initEmojiManager();

  document.getElementById('add-order').addEventListener('click', addOrder);
  document.getElementById('todo-add').addEventListener('submit', addTodo);
  document.getElementById('autoreply-save').addEventListener('click', saveAutoReply);
}

// ---- Custom emoji manager (owner only) ------------------------------------
function initEmojiManager() {
  renderEmojiManage();
  document.getElementById('emoji-add').addEventListener('submit', addEmoji);
}

function renderEmojiManage() {
  const wrap = document.getElementById('emoji-manage');
  if (!wrap) return;
  if (!emojiList.length) {
    wrap.innerHTML = '<p class="hint">No custom emojis yet.</p>';
    return;
  }
  wrap.innerHTML = '';
  emojiList.forEach((em) => {
    const chip = document.createElement('div');
    chip.className = 'emoji-chip';
    chip.innerHTML =
      '<img src="' + esc(em.image_url) + '" alt="">' +
      '<span>:' + esc(em.name) + ':</span>' +
      '<button type="button" title="Remove">✕</button>';
    chip.querySelector('button').addEventListener('click', () => removeEmoji(em));
    wrap.appendChild(chip);
  });
}

async function addEmoji(e) {
  e.preventDefault();
  const nameInput = document.getElementById('emoji-name');
  const fileInput = document.getElementById('emoji-file');
  const msg = document.getElementById('emoji-msg');
  const setMsg = (t, ok) => { msg.textContent = t; msg.className = 'form-msg ' + (ok ? 'success' : 'error'); };

  const name = nameInput.value.trim().toLowerCase();
  const file = fileInput.files[0];
  if (!/^[a-z0-9_]{1,32}$/.test(name)) return setMsg('Name: letters, numbers, or _ (max 32).', false);
  if (emojiMap[name]) return setMsg('An emoji with that name already exists.', false);
  if (!file) return setMsg('Please choose an image.', false);
  if (!file.type.startsWith('image/')) return setMsg('Emoji must be an image.', false);
  if (file.size > 1024 * 1024) return setMsg('Emoji image must be under 1 MB.', false);

  setMsg('Uploading…', true);
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${name}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('chat-emojis')
    .upload(path, file, { contentType: file.type });
  if (upErr) return setMsg(upErr.message, false);

  const { data: pub } = supabase.storage.from('chat-emojis').getPublicUrl(path);
  const { error } = await supabase.from('emojis').insert({ name, image_url: pub.publicUrl });
  if (error) return setMsg(error.message, false);

  nameInput.value = '';
  fileInput.value = '';
  setMsg('Added :' + name + ':', true);
  setTimeout(() => { msg.textContent = ''; }, 1500);

  await loadEmojis();
  renderEmojiManage();
  refreshEmojiPickers();
}

async function removeEmoji(em) {
  if (!confirm('Remove :' + em.name + ':?')) return;
  const { error } = await supabase.from('emojis').delete().eq('id', em.id);
  if (error) return alert(error.message);
  await loadEmojis();
  renderEmojiManage();
  refreshEmojiPickers();
}

// ---- Auto-welcome reply (owner-editable) ----------------------------------
async function loadAutoReply() {
  const { data } = await supabase.from('settings').select('auto_reply').eq('id', 1).single();
  if (data) document.getElementById('autoreply-input').value = data.auto_reply || '';
}

async function saveAutoReply() {
  const text = document.getElementById('autoreply-input').value.trim();
  const msg = document.getElementById('autoreply-msg');
  if (!text) { msg.textContent = 'Please enter some text.'; msg.className = 'form-msg error'; return; }
  const { error } = await supabase.from('settings').update({ auto_reply: text }).eq('id', 1);
  msg.textContent = error ? error.message : 'Saved!';
  msg.className = 'form-msg ' + (error ? 'error' : 'success');
  if (!error) setTimeout(() => { msg.textContent = ''; }, 1500);
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
  document.getElementById('owner-history-section').hidden = false;

  await refreshOwner();

  // realtime: re-render on any message change (insert / edit / delete / pin)
  if (activeMsgChannel) supabase.removeChannel(activeMsgChannel);
  activeMsgChannel = supabase.channel('owner-msgs-' + conv.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conv.id },
      () => { if (activeConv && activeConv.id === conv.id) refreshOwner(); })
    .subscribe();

  await loadOwnerOrders(conv.id);
  // reflect active highlight
  document.querySelectorAll('.conv-item').forEach((el) => el.classList.remove('is-active'));
}

// Reload the active conversation: visible messages into the chat, and
// soft-deleted ones into the owner-only "Message history" section.
async function refreshOwner() {
  if (!activeConv) return;
  const { data } = await supabase
    .from('messages').select('*').eq('conversation_id', activeConv.id).order('created_at');
  const all = data || [];
  renderMessages('owner-messages', all.filter((m) => !m.deleted_at), activeConv.id);
  renderHistory(all.filter((m) => m.deleted_at));
}

function renderHistory(deleted) {
  const wrap = document.getElementById('owner-history');
  const empty = document.getElementById('owner-history-empty');
  if (!wrap) return;
  wrap.innerHTML = '';
  empty.hidden = deleted.length > 0;

  // newest deletion first
  deleted.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
  deleted.forEach((m) => {
    const sender = profileCache[m.sender_id];
    const who = m.sender_id === me.id ? 'You' : (sender ? sender.username : 'User');
    const remover = m.deleted_by === me.id ? 'you' : (m.deleted_by === m.sender_id ? who.toLowerCase() : 'owner');
    const preview = m.content
      ? renderContent(m.content)
      : (m.image_url ? '📷 image' : (m.file_name ? '📎 ' + esc(m.file_name) : '(empty)'));

    const item = document.createElement('div');
    item.className = 'history-item restorable';
    item.innerHTML =
      '<div class="history-text"><strong>' + esc(who) + ':</strong> ' + preview + '</div>' +
      '<div class="history-meta">deleted by ' + esc(remover) + ' · ' + fmtTime(m.deleted_at) + '</div>' +
      '<button class="btn btn-soft btn-sm history-restore" type="button">Restore</button>';
    item.querySelector('.history-restore').addEventListener('click', () => restoreMessage(m));
    wrap.appendChild(item);
  });
}

async function restoreMessage(m) {
  const { error } = await supabase.from('messages')
    .update({ deleted_at: null }).eq('id', m.id);
  if (error) alert(error.message);
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
