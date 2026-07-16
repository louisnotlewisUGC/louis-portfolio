// Updates the nav's auth slot on the landing/portfolio pages:
// shows "Sign in" when logged out, or an avatar+name chip when logged in.
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
      } else {
        slot.innerHTML = '<a href="account.html">Sign in</a>';
      }
    });
  }
}
