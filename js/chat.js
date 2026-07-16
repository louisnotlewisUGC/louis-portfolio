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

// ---------------------------------------------------------------------------
// Profile card: click someone's name/avatar in chat to see their banner,
// avatar, and description.
// ---------------------------------------------------------------------------
function openProfileCard(p) {
  if (!p) return;
  const banner = document.getElementById('pc-banner');
  banner.style.backgroundImage = p.banner_url ? 'url("' + p.banner_url + '")' : '';
  document.getElementById('pc-avatar').src = p.avatar_url || 'assets/avatar.svg';
  document.getElementById('pc-name').textContent = p.username || 'User';
  document.getElementById('pc-role').textContent =
    p.role === 'owner' ? '✓ UGC Hair Creator · Owner' : 'Customer';
  document.getElementById('pc-desc').textContent =
    p.description || 'No description yet.';
  document.getElementById('profile-modal').hidden = false;
}

function wireProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  document.getElementById('profile-card-close')
    .addEventListener('click', () => { modal.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modal.hidden = true;
  });
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
  wireProfileModal();

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

  // The chat header shows Louis's REAL profile (avatar updates when he changes
  // his pfp), and clicking it opens his profile card.
  const { data: owners } = await supabase
    .from('profiles').select('*').eq('role', 'owner').limit(1);
  const ownerProf = owners && owners[0];
  if (ownerProf) {
    profileCache[ownerProf.id] = ownerProf;
    const head = document.querySelector('#customer-view .chat-window-head');
    head.querySelector('img').src = ownerProf.avatar_url || 'assets/avatar.svg';
    head.querySelector('strong').textContent = ownerProf.username || 'Louis';
    head.style.cursor = 'pointer';
    head.addEventListener('click', () => openProfileCard(ownerProf));
  }

  await refreshCustomer();
  await loadCustomerOrders(conv.id);

  // live updates: re-render on any message or reaction change
  supabase.channel('cust-msgs-' + conv.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conv.id },
      () => refreshCustomer())
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'message_reactions' },
      () => refreshCustomer())
    .subscribe();

  const form = document.getElementById('cust-composer');
  const input = document.getElementById('cust-input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleComposerSubmit(conv.id, input);
  });

  // picking files stages them in the strip — they send with the Send button
  document.getElementById('cust-file').addEventListener('change', (e) =>
    stageFiles(e.target));

  wireEmojiPicker('cust-emoji-btn', 'cust-emoji-pop', 'cust-input');
}

async function refreshCustomer() {
  const { data } = await supabase
    .from('messages').select('*').eq('conversation_id', custConvId).order('created_at');
  // RLS already hides deleted from customers; filter again to be safe.
  const msgs = (data || []).filter((m) => !m.deleted_at);
  // cache sender profiles (Louis's included) so names + profile cards work
  await cacheProfiles(msgs.map((m) => m.sender_id));
  await attachReactions(msgs);
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
  // Keep the reader where they are: only auto-scroll to the newest message if
  // they were already at (or near) the bottom. Reacting to / editing an old
  // message must not yank the view down.
  const firstRender = !box.dataset.rendered;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const prevScroll = box.scrollTop;
  box.innerHTML = '';

  const pinned = msgs.filter((m) => m.pinned);
  if (pinned.length) box.appendChild(buildPinnedBar(pinned, box));

  msgs.forEach((m) => box.appendChild(buildMessageRow(m, convId)));
  renderPending(box, boxId);
  box.dataset.rendered = '1';
  box.scrollTop = (firstRender || nearBottom) ? box.scrollHeight : prevScroll;
}

function buildPinnedBar(pinned, box) {
  const bar = document.createElement('div');
  bar.className = 'pinned-bar';
  bar.innerHTML = '<span class="pinned-bar-title">📌 Pinned</span>';
  pinned.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    const imgCount = (m.image_urls || []).length || (m.image_url ? 1 : 0);
    b.innerHTML = renderContent(m.content ||
      (imgCount ? '📷 ' + (imgCount === 1 ? 'image' : imgCount + ' images') : (m.file_name || 'file')));
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

  // media first, caption text underneath (WhatsApp style)
  let media = '';
  const gallery = (m.image_urls && m.image_urls.length)
    ? m.image_urls
    : (m.image_url ? [m.image_url] : []);
  if (gallery.length) {
    const cls = gallery.length === 1 ? 'g1' : gallery.length === 2 ? 'g2' : 'gmulti';
    media += '<div class="msg-gallery ' + cls + '">' +
      gallery.map((u) =>
        '<a class="msg-image-link" href="' + esc(u) + '" target="_blank" rel="noopener">' +
        '<img class="msg-image" src="' + esc(u) + '" alt="shared image"></a>').join('') +
      '</div>';
  }
  if (m.file_url) {
    const fname = m.file_name || 'file';
    media += '<a class="msg-file" href="' + esc(m.file_url) + '" download="' + esc(fname) + '" target="_blank" rel="noopener">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>' +
      '<span>' + esc(fname) + '</span></a>';
  }
  const text = m.content ? '<span class="msg-text">' + renderContent(m.content) + '</span>' : '';
  const body = media + text;

  const editedTag = m.edited_at ? '<span class="msg-edited">(edited)</span>' : '';
  const pinTag = m.pinned ? '<span class="msg-pin-tag">📌 pinned</span> ' : '';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble' + (m.pinned ? ' pinned' : '');
  bubble.innerHTML =
    '<span class="msg-name">' + esc(name) + '</span>' +
    body +
    '<span class="msg-time">' + pinTag + fmtTime(m.created_at) + editedTag + '</span>';

  // click the sender's name to open their profile card
  const nameEl = bubble.querySelector('.msg-name');
  nameEl.classList.add('clickable');
  nameEl.addEventListener('click', () =>
    openProfileCard(mine ? me : profileCache[m.sender_id]));

  if (m.reactions && m.reactions.length) bubble.appendChild(buildReactions(m));
  bubble.appendChild(buildMsgActions(m, convId, bubble));
  row.appendChild(bubble);
  return row;
}

function buildReactions(m) {
  const wrap = document.createElement('div');
  wrap.className = 'reactions';
  m.reactions.forEach((r) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'reaction-chip' + (r.mine ? ' mine' : '');
    chip.innerHTML = renderReactionEmoji(r.emoji) + ' <span>' + r.count + '</span>';
    chip.addEventListener('click', () => toggleReaction(m, r.emoji));
    wrap.appendChild(chip);
  });
  return wrap;
}

// Discord-style hover toolbar icons (clean strokes, no emoji glyphs).
const ICONS = {
  react: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11v1a10 10 0 1 1-9-10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/><path d="M16 5h6"/><path d="M19 2v6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

// The little hover toolbar on each message.
function buildMsgActions(m, convId, bubble) {
  const bar = document.createElement('div');
  bar.className = 'msg-actions';
  const mine = m.sender_id === me.id;
  const canDelete = mine || me.role === 'owner';
  const canEdit = mine && m.content; // only text you wrote

  const add = (icon, title, fn, cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = ICONS[icon];
    b.title = title;
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    bar.appendChild(b);
  };

  // Anyone in the chat can react and pin.
  add('react', 'Add reaction', (e) => { e.stopPropagation(); openReactionPicker(e.currentTarget, m); });
  add('pin', m.pinned ? 'Unpin' : 'Pin', () => togglePinMessage(m), m.pinned ? 'is-active' : '');
  if (canEdit) add('edit', 'Edit', () => startEditMessage(m, bubble, convId));
  if (canDelete) add('trash', 'Delete', () => deleteMessage(m), 'danger');

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

// Upload files (up to 30 MB each). Multiple pics picked together are sent as ONE
// bubble (WhatsApp style), and whatever you'd typed in the composer goes out as
// the caption. A "Uploading…" placeholder bubble shows while it's in flight.
const MAX_UPLOAD = 30 * 1024 * 1024;
const pendingUploads = []; // {label, boxId}

function myBoxId() { return me.role === 'owner' ? 'owner-messages' : 'cust-messages'; }
function myRefresh() { return me.role === 'owner' ? refreshOwner() : refreshCustomer(); }

// Append a loading bubble for each in-flight upload (called by renderMessages).
function renderPending(box, boxId) {
  pendingUploads.filter((p) => p.boxId === boxId).forEach((p) => {
    const row = document.createElement('div');
    row.className = 'msg-row mine';
    row.innerHTML =
      '<div class="msg-bubble"><span class="msg-name">You</span>' +
      '<span class="msg-uploading"><span class="spinner"></span>Uploading ' +
      esc(p.label) + '…</span></div>';
    box.appendChild(row);
  });
}

async function uploadToBucket(file) {
  const isImage = file.type.startsWith('image/');
  const bucket = isImage ? 'chat-images' : 'chat-files';
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const { error } = await supabase.storage.from(bucket)
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) { alert(error.message); return null; }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------------------
// Staged attachments (Discord-style): picking files does NOT send them. They
// wait as little previews above the composer until you press Send / Enter,
// then go out together with whatever text is in the box.
// ---------------------------------------------------------------------------
let stagedFiles = []; // File objects waiting in the composer

function attachStripEl() {
  return document.getElementById(me.role === 'owner' ? 'owner-attach-strip' : 'cust-attach-strip');
}

function stageFiles(fileInput) {
  Array.from(fileInput.files || []).forEach((f) => {
    if (f.size > MAX_UPLOAD) { alert('"' + f.name + '" is over 30 MB — skipped.'); return; }
    stagedFiles.push(f);
  });
  fileInput.value = '';
  renderAttachStrip();
}

function renderAttachStrip() {
  const strip = attachStripEl();
  if (!strip) return;
  strip.innerHTML = '';
  strip.hidden = stagedFiles.length === 0;

  stagedFiles.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'attach-item';
    if (f.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.onload = () => URL.revokeObjectURL(img.src);
      item.appendChild(img);
    } else {
      const chip = document.createElement('span');
      chip.className = 'attach-file-name';
      chip.textContent = f.name;
      item.appendChild(chip);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'attach-remove';
    del.title = 'Remove';
    del.textContent = '✕';
    del.addEventListener('click', () => { stagedFiles.splice(i, 1); renderAttachStrip(); });
    item.appendChild(del);
    strip.appendChild(item);
  });
}

// Send button / Enter: text alone, or text + the staged files together.
async function handleComposerSubmit(convId, inputEl) {
  const text = inputEl.value.trim();
  const files = stagedFiles;
  if (!text && !files.length) return;
  inputEl.value = '';
  stagedFiles = [];
  renderAttachStrip();

  if (!files.length) {
    const { error } = await supabase.from('messages').insert({
      conversation_id: convId, sender_id: me.id, content: text,
    });
    if (error) alert(error.message);
    return;
  }

  const images = files.filter((f) => f.type.startsWith('image/'));
  const others = files.filter((f) => !f.type.startsWith('image/'));
  const label = images.length
    ? (images.length === 1 ? 'image' : images.length + ' images')
    : files[0].name;
  const pending = { label, boxId: myBoxId() };
  pendingUploads.push(pending);
  await myRefresh(); // show the loading placeholder

  try {
    // all images share one bubble, the text underneath as the caption
    if (images.length) {
      const urls = [];
      for (const f of images) {
        const u = await uploadToBucket(f);
        if (u) urls.push(u);
      }
      if (urls.length) {
        let { error } = await supabase.from('messages').insert({
          conversation_id: convId, sender_id: me.id,
          content: text || null, image_urls: urls,
        });
        // Database doesn't have image_urls yet (schema.sql not re-run) —
        // fall back to one bubble per image so nothing is lost.
        if (error && /image_urls/i.test(error.message)) {
          let cap = text || null;
          for (const u of urls) {
            ({ error } = await supabase.from('messages').insert({
              conversation_id: convId, sender_id: me.id, content: cap, image_url: u,
            }));
            cap = null;
            if (error) break;
          }
        }
        if (error) alert(error.message);
      }
    }
    // non-image files go one per message; the text tags along on the first
    // when there were no images to carry it
    let fileCaption = images.length ? null : (text || null);
    for (const f of others) {
      const u = await uploadToBucket(f);
      if (!u) continue;
      const { error } = await supabase.from('messages').insert({
        conversation_id: convId, sender_id: me.id,
        content: fileCaption, file_url: u, file_name: f.name,
      });
      fileCaption = null;
      if (error) alert(error.message);
    }
  } finally {
    const idx = pendingUploads.indexOf(pending);
    if (idx >= 0) pendingUploads.splice(idx, 1);
    await myRefresh();
  }
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------
const COMMON_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
let activeReactionPicker = null;

// Fetch reactions for a set of messages and attach a grouped list to each.
async function attachReactions(msgs) {
  const ids = msgs.map((m) => m.id);
  const { data } = ids.length
    ? await supabase.from('message_reactions').select('*').in('message_id', ids)
    : { data: [] };
  const byMsg = {};
  (data || []).forEach((r) => { (byMsg[r.message_id] = byMsg[r.message_id] || []).push(r); });
  msgs.forEach((m) => {
    const grouped = {};
    (byMsg[m.id] || []).forEach((r) => {
      grouped[r.emoji] = grouped[r.emoji] || { emoji: r.emoji, count: 0, mine: false };
      grouped[r.emoji].count += 1;
      if (r.user_id === me.id) grouped[r.emoji].mine = true;
    });
    m.reactions = Object.values(grouped);
  });
}

function renderReactionEmoji(emoji) {
  const cm = /^:([a-z0-9_]+):$/.exec(emoji);
  if (cm && emojiMap[cm[1]]) {
    return '<img class="chat-emoji" src="' + esc(emojiMap[cm[1]]) + '" alt="' + esc(emoji) + '">';
  }
  return esc(emoji);
}

async function toggleReaction(m, emoji) {
  const mine = (m.reactions || []).find((r) => r.emoji === emoji && r.mine);
  if (mine) {
    await supabase.from('message_reactions').delete()
      .eq('message_id', m.id).eq('user_id', me.id).eq('emoji', emoji);
  } else {
    const { error } = await supabase.from('message_reactions')
      .insert({ message_id: m.id, user_id: me.id, emoji });
    if (error && !/duplicate/i.test(error.message)) alert(error.message);
  }
  await myRefresh();
}

function closeReactionPicker() {
  if (activeReactionPicker) { activeReactionPicker.remove(); activeReactionPicker = null; }
}

function openReactionPicker(anchorBtn, m) {
  closeReactionPicker();
  const pop = document.createElement('div');
  pop.className = 'reaction-picker';
  const emojis = COMMON_REACTIONS.concat(emojiList.map((em) => ':' + em.name + ':'));
  emojis.forEach((emoji) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = renderReactionEmoji(emoji);
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleReaction(m, emoji); closeReactionPicker(); });
    pop.appendChild(b);
  });
  document.body.appendChild(pop);
  const r = anchorBtn.getBoundingClientRect();
  pop.style.top = (window.scrollY + r.bottom + 4) + 'px';
  pop.style.left = (window.scrollX + Math.max(8, r.left - 60)) + 'px';
  activeReactionPicker = pop;
  setTimeout(() => document.addEventListener('click', onReactionOutside), 0);
}
function onReactionOutside(e) {
  if (activeReactionPicker && !activeReactionPicker.contains(e.target)) {
    closeReactionPicker();
    document.removeEventListener('click', onReactionOutside);
  }
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
  // preventScroll: focusing the composer must not jump the page around
  input.focus({ preventScroll: true });
  input.setSelectionRange(caret, caret);
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

  document.getElementById('owner-composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!activeConv) return;
    handleComposerSubmit(activeConv.id, document.getElementById('owner-input'));
  });

  // picking files stages them in the strip — they send with the Send button
  document.getElementById('owner-file').addEventListener('change', (e) => {
    if (!activeConv) return;
    stageFiles(e.target);
  });

  wireEmojiPicker('owner-emoji-btn', 'owner-emoji-pop', 'owner-input');
  initEmojiManager();
  wireCollapsible('history-toggle', 'history-body', 'historyPanelHidden');
  wireCollapsible('todo-toggle', 'todo-body', 'todoPanelHidden');

  document.getElementById('conv-search').addEventListener('input', renderConvList);
  document.getElementById('add-order').addEventListener('click', addOrder);
  document.getElementById('todo-add').addEventListener('submit', addTodo);
  document.getElementById('autoreply-save').addEventListener('click', saveAutoReply);
}

// Hide/Show toggle for a panel section; the choice sticks across visits.
function wireCollapsible(toggleId, bodyId, storageKey) {
  const toggle = document.getElementById(toggleId);
  const body = document.getElementById(bodyId);
  if (!toggle || !body) return;
  const apply = (hidden) => {
    body.hidden = hidden;
    toggle.textContent = hidden ? 'Show' : 'Hide';
    try { localStorage.setItem(storageKey, hidden ? '1' : ''); } catch (e) {}
  };
  let saved = false;
  try { saved = localStorage.getItem(storageKey) === '1'; } catch (e) {}
  apply(saved);
  toggle.addEventListener('click', () => apply(!body.hidden));
}

// ---- Custom emoji manager (owner only) ------------------------------------
function initEmojiManager() {
  renderEmojiManage();
  document.getElementById('emoji-add').addEventListener('submit', addEmoji);
  wireCollapsible('emoji-toggle', 'emoji-body', 'emojiPanelHidden');
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

let convCache = [];

async function loadConversations() {
  const { data: convs } = await supabase.from('conversations').select('*');
  convCache = convs || [];
  await cacheProfiles(convCache.map((c) => c.customer_id));

  // pinned first, then most recent activity
  convCache.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });

  renderConvList();
}

// Draw the sidebar, applying whatever's typed in the DM search box.
function renderConvList() {
  const q = (document.getElementById('conv-search').value || '').trim().toLowerCase();
  const list = convCache.filter((c) => {
    const p = profileCache[c.customer_id] || {};
    return !q || (p.username || '').toLowerCase().includes(q);
  });

  const wrap = document.getElementById('conv-items');
  wrap.innerHTML = '';
  document.getElementById('conv-empty').hidden = convCache.length > 0;
  document.getElementById('conv-no-match').hidden = !(convCache.length && !list.length);

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

  // click the customer's avatar/name in the header to open their profile card
  head.querySelector('.chat-head-avatar').style.cursor = 'pointer';
  head.querySelector('.chat-head-avatar').addEventListener('click', () => openProfileCard(p));
  head.querySelector('.chat-head-info').style.cursor = 'pointer';
  head.querySelector('.chat-head-info').addEventListener('click', () => openProfileCard(p));

  document.getElementById('owner-composer').hidden = false;
  document.getElementById('owner-side').hidden = false;
  document.getElementById('owner-history-section').hidden = false;

  await refreshOwner();

  // realtime: re-render on any message or reaction change
  if (activeMsgChannel) supabase.removeChannel(activeMsgChannel);
  activeMsgChannel = supabase.channel('owner-msgs-' + conv.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conv.id },
      () => { if (activeConv && activeConv.id === conv.id) refreshOwner(); })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'message_reactions' },
      () => { if (activeConv) refreshOwner(); })
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
  const visible = all.filter((m) => !m.deleted_at);
  await attachReactions(visible);
  renderMessages('owner-messages', visible, activeConv.id);
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
    const imgCount = (m.image_urls || []).length || (m.image_url ? 1 : 0);
    const preview = m.content
      ? renderContent(m.content)
      : (imgCount ? '📷 ' + (imgCount === 1 ? 'image' : imgCount + ' images')
        : (m.file_name ? '📎 ' + esc(m.file_name) : '(empty)'));

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
  const list = data || [];
  // pinned tasks float to the top
  list.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });
  const wrap = document.getElementById('todo-list');
  wrap.innerHTML = '';
  list.forEach((t) => wrap.appendChild(todoRow(t)));
}

function todoRow(t) {
  const row = document.createElement('div');
  row.className = 'todo-row' + (t.done ? ' done' : '') + (t.pinned ? ' pinned' : '');
  const desc = t.description ? '<span class="todo-desc">' + esc(t.description) + '</span>' : '';
  row.innerHTML =
    '<label><input type="checkbox"' + (t.done ? ' checked' : '') + '>' +
      '<span class="todo-text"><span class="todo-title">' +
        (t.pinned ? '<span class="msg-pin-tag">📌</span> ' : '') + esc(t.content) +
      '</span>' + desc + '</span></label>' +
    '<span class="todo-actions">' +
      '<button class="todo-pin' + (t.pinned ? ' is-active' : '') + '" type="button" title="' +
        (t.pinned ? 'Unpin' : 'Pin') + '">' + ICONS.pin + '</button>' +
      '<button class="link-btn danger todo-del" type="button">✕</button>' +
    '</span>';
  row.querySelector('input').addEventListener('change', async (e) => {
    await supabase.from('todos').update({ done: e.target.checked }).eq('id', t.id);
    row.classList.toggle('done', e.target.checked);
  });
  row.querySelector('.todo-pin').addEventListener('click', async () => {
    const { error } = await supabase.from('todos').update({ pinned: !t.pinned }).eq('id', t.id);
    if (error) {
      return alert(/pinned/i.test(error.message)
        ? 'Pinning needs the newest schema.sql run in Supabase first.'
        : error.message);
    }
    await loadTodos();
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
  const descInput = document.getElementById('todo-desc');
  const content = input.value.trim();
  if (!content) return;
  const description = descInput.value.trim() || null;
  input.value = '';
  descInput.value = '';
  let { error } = await supabase.from('todos')
    .insert({ content, description }).select().single();
  // description column not in the database yet — save the title at least
  if (error && /description/i.test(error.message)) {
    ({ error } = await supabase.from('todos').insert({ content }).select().single());
  }
  if (error) return alert(error.message);
  await loadTodos();
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
