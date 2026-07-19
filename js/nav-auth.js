// Updates the nav's auth slot on the landing/portfolio pages:
// shows "Sign in" when logged out, or an avatar+name chip when logged in.
// For the owner, the floating "Chat with me" button also gets a red badge
// with how many customer messages are waiting.
import { supabase, isConfigured, getProfile } from './supabase-client.js';

const slot = document.getElementById('nav-auth');
if (slot) {
  if (!isConfigured() || !supabase) {
    slot.innerHTML = '<a href="account.html">Sign in</a>';
  } else {
    getProfile().then((p) => {
      if (p) {
        slot.innerHTML =
          '<a class="nav-user" href="account.html">' +
            '<img src="' + (p.avatar_url || 'assets/avatar.svg') + '" alt="">' +
            (p.username || 'Account') +
          '</a>';
        liveFabBadge(p.role === 'owner'
          ? () => ownerUnreadCount(p.id)
          : () => customerUnreadCount(p.id));
      } else {
        slot.innerHTML = '<a href="account.html">Sign in</a>';
      }
    });
  }
}

// Red counter on the floating "Chat with me" button, kept live: new messages
// raise it; reading the chat (which bumps the read marker) lowers it.
async function liveFabBadge(countFn) {
  const fab = document.querySelector('.chat-fab');
  if (!fab) return;
  let badge = null;

  const render = (total) => {
    if (total > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'fab-badge';
        fab.appendChild(badge);
      }
      badge.textContent = total > 99 ? '99+' : String(total);
    } else if (badge) {
      badge.remove();
      badge = null;
    }
  };

  const compute = async () => {
    try {
      const total = await countFn();
      if (total != null) render(total);
    } catch (e) { /* badge is best-effort */ }
  };

  await compute();
  supabase.channel('fab-unread')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' }, compute)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'conversations' }, compute)
    .subscribe();
}

// Owner: unread = customer messages newer than each conversation's marker.
async function ownerUnreadCount(myId) {
  const { data: convs } = await supabase
    .from('conversations').select('id, owner_last_read_at');
  if (!convs || !convs.length || !('owner_last_read_at' in convs[0])) return null;

  const oldest = convs.reduce(
    (a, c) => (a && a < c.owner_last_read_at ? a : c.owner_last_read_at), null);
  const { data: fresh } = await supabase.from('messages')
    .select('conversation_id, created_at')
    .gte('created_at', oldest)
    .is('deleted_at', null)
    .neq('sender_id', myId);

  const lastRead = {};
  convs.forEach((c) => { lastRead[c.id] = c.owner_last_read_at; });
  return (fresh || []).filter(
    (m) => lastRead[m.conversation_id] && m.created_at > lastRead[m.conversation_id]
  ).length;
}

// Customer: unread = Louis's messages in their own conversation newer than
// their marker.
async function customerUnreadCount(myId) {
  const { data: convs } = await supabase
    .from('conversations').select('id, customer_last_read_at')
    .eq('customer_id', myId);
  const conv = convs && convs[0];
  if (!conv || !('customer_last_read_at' in conv)) return null;

  const { data: fresh } = await supabase.from('messages')
    .select('id')
    .eq('conversation_id', conv.id)
    .gt('created_at', conv.customer_last_read_at)
    .is('deleted_at', null)
    .neq('sender_id', myId);
  return (fresh || []).length;
}
