// ============================================================================
// Shared Supabase connection + helpers for the account/chat pages.
//
// SETUP: after you create your free Supabase project (see SETUP-CHAT.md),
// paste your Project URL and anon (public) key below, replacing the two
// PASTE_YOUR_... placeholders. Nothing else in this file needs changing.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jbpvmrshmjxatuzgkqyp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpicHZtcnNobWp4YXR1emdrcXlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxOTE5MTIsImV4cCI6MjA5OTc2NzkxMn0.9kvDvh1iwxKHniKV-kVA-GwzXPb4Z07pa7zwNHzwwdA';

// True once real keys have been pasted in.
export function isConfigured() {
  return (
    SUPABASE_URL.startsWith('http') &&
    !SUPABASE_ANON_KEY.startsWith('PASTE_') &&
    SUPABASE_ANON_KEY.length > 20
  );
}

// Only create a real client when configured, so the pages don't crash before
// setup is done.
export const supabase = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// Shows a friendly banner at the top of a page when Supabase isn't set up yet.
export function showNotConfiguredBanner(target) {
  const el = document.createElement('div');
  el.className = 'notice-banner';
  el.innerHTML =
    '<strong>Chat isn’t connected yet.</strong> ' +
    'Follow <code>SETUP-CHAT.md</code> to create a free Supabase project and ' +
    'paste your keys into <code>js/supabase-client.js</code>. ' +
    'Until then, accounts and chat won’t work.';
  (target || document.body).prepend(el);
}

// Current logged-in session (or null).
export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

// The logged-in user's profile row (username, avatar, role, banned) or null.
export async function getProfile() {
  if (!supabase) return null;
  const session = await getSession();
  if (!session) return null;
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();
  return data || null;
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}
