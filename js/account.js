// Account page: sign up (with email verification), sign in, profile editor.
import {
  supabase, isConfigured, showNotConfiguredBanner,
  getSession, getProfile, signOut,
} from './supabase-client.js';

const authShell = document.getElementById('auth-shell');
const profileShell = document.getElementById('profile-shell');

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

function setMsg(id, text, kind = 'error') {
  const el = document.getElementById(id);
  el.textContent = text || '';
  el.className = 'form-msg' + (text ? ' ' + kind : '');
}

// ---- Not configured yet: show banner, keep forms visible but inert --------
if (!isConfigured()) {
  showNotConfiguredBanner(document.querySelector('.auth-page'));
  show(authShell);
} else {
  init();
}

async function init() {
  const session = await getSession();
  if (session) {
    await enterProfile();
  } else {
    show(authShell);
  }
}

// ---- Tab switching --------------------------------------------------------
const tabs = document.querySelectorAll('.auth-tab');
const signinForm = document.getElementById('signin-form');
const signupForm = document.getElementById('signup-form');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
    const isSignup = tab.dataset.tab === 'signup';
    signupForm.hidden = !isSignup;
    signinForm.hidden = isSignup;
    setMsg('signin-msg', ''); setMsg('signup-msg', '');
  });
});

// ---- Sign up --------------------------------------------------------------
signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(signupForm);
  const username = f.get('username').trim();
  const email = f.get('email').trim();
  const password = f.get('password');

  if (username.length < 2) return setMsg('signup-msg', 'Please enter a display name.');
  if (password.length < 6) return setMsg('signup-msg', 'Password must be at least 6 characters.');

  setMsg('signup-msg', 'Creating your account…', 'info');
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: {
      data: { username },
      emailRedirectTo: window.location.origin + '/account.html',
    },
  });

  if (error) return setMsg('signup-msg', error.message);

  // With email confirmation ON, there's no active session yet.
  if (!data.session) {
    signupForm.reset();
    setMsg('signup-msg',
      'Almost there! Check your email inbox and click the verification link, ' +
      'then come back and sign in.', 'success');
  } else {
    await enterProfile();
  }
});

// ---- Sign in --------------------------------------------------------------
signinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(signinForm);
  const email = f.get('email').trim();
  const password = f.get('password');

  setMsg('signin-msg', 'Signing in…', 'info');
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = /confirm|verify/i.test(error.message)
      ? 'Please verify your email first — check your inbox for the link.'
      : 'Wrong email or password, or your email isn’t verified yet.';
    return setMsg('signin-msg', msg);
  }
  await enterProfile();
});

// ---- Forgot password ------------------------------------------------------
document.getElementById('forgot-link').addEventListener('click', async () => {
  const email = signinForm.querySelector('[name="email"]').value.trim();
  if (!email) return setMsg('signin-msg', 'Type your email above first, then click "Forgot".');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/account.html',
  });
  setMsg('signin-msg', error ? error.message
    : 'Password reset link sent — check your email.', error ? 'error' : 'success');
});

// ---- Profile editor -------------------------------------------------------
let currentProfile = null;
let profileTries = 0;

async function enterProfile() {
  currentProfile = await getProfile();
  if (!currentProfile) {
    // Profile row can lag a moment right after first signup — retry a few
    // times, but don't leave the page blank forever if it truly can't load.
    profileTries += 1;
    if (profileTries < 4) { setTimeout(enterProfile, 800); return; }
    hide(profileShell);
    show(authShell);
    setMsg('signin-msg',
      'You’re signed in, but your profile couldn’t load. The database access ' +
      'grants may be missing — see SETUP-CHAT.md (the "grant … to authenticated" step).',
      'error');
    return;
  }
  profileTries = 0;
  hide(authShell);
  document.getElementById('username-input').value = currentProfile.username || '';
  document.getElementById('description-input').value = currentProfile.description || '';
  if (currentProfile.avatar_url) {
    document.getElementById('profile-avatar').src = currentProfile.avatar_url;
  }

  // Account info (read-only)
  const session = await getSession();
  const email = session && session.user ? session.user.email : '';
  document.getElementById('acc-email').textContent = email || '—';
  document.getElementById('acc-since').textContent = currentProfile.created_at
    ? new Date(currentProfile.created_at).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  document.getElementById('acc-role').textContent =
    currentProfile.role === 'owner' ? 'Owner' : 'Customer';

  show(profileShell);
}

document.getElementById('save-profile').addEventListener('click', async () => {
  const username = document.getElementById('username-input').value.trim();
  const description = document.getElementById('description-input').value.trim() || null;
  if (username.length < 2) return setMsg('profile-msg', 'Please enter a display name.');
  setMsg('profile-msg', 'Saving…', 'info');
  const { error } = await supabase
    .from('profiles')
    .update({ username, description })
    .eq('id', currentProfile.id);
  if (!error) { currentProfile.username = username; currentProfile.description = description; }
  setMsg('profile-msg', error ? error.message : 'Saved!', error ? 'error' : 'success');
});

// ---- Change password ------------------------------------------------------
document.getElementById('change-password').addEventListener('click', async () => {
  const pw = document.getElementById('new-password').value;
  const confirm = document.getElementById('confirm-password').value;
  if (pw.length < 6) return setMsg('password-msg', 'Password must be at least 6 characters.');
  if (pw !== confirm) return setMsg('password-msg', 'Those passwords don’t match.');

  setMsg('password-msg', 'Updating…', 'info');
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return setMsg('password-msg', error.message);
  document.getElementById('new-password').value = '';
  document.getElementById('confirm-password').value = '';
  setMsg('password-msg', 'Password updated!', 'success');
});

document.getElementById('avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) return setMsg('profile-msg', 'Image must be under 3 MB.');

  setMsg('profile-msg', 'Uploading picture…', 'info');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${currentProfile.id}/avatar.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, cacheControl: '3600' });
  if (upErr) return setMsg('profile-msg', upErr.message);

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = pub.publicUrl + '?v=' + Date.now(); // bust cache
  const { error: updErr } = await supabase
    .from('profiles').update({ avatar_url: url }).eq('id', currentProfile.id);
  if (updErr) return setMsg('profile-msg', updErr.message);

  document.getElementById('profile-avatar').src = url;
  currentProfile.avatar_url = url;
  setMsg('profile-msg', 'Picture updated!', 'success');
});

document.getElementById('signout-btn').addEventListener('click', async () => {
  await signOut();
  window.location.reload();
});
