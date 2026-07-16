// Vouches wall: public list of customer reviews (1–5 stars + comment).
// Anyone can read; signed-in users can post/edit/remove their own single vouch.
// The owner can remove any vouch. Access is enforced by Row Level Security.
import {
  supabase, isConfigured, showNotConfiguredBanner, getProfile,
} from './supabase-client.js';

const summaryEl   = document.getElementById('vouch-summary');
const avgEl       = document.getElementById('vouch-avg');
const avgStarsEl  = document.getElementById('vouch-avg-stars');
const countEl     = document.getElementById('vouch-count');
const signinCard  = document.getElementById('vouch-signin');
const form        = document.getElementById('vouch-form');
const formTitle   = document.getElementById('vouch-form-title');
const picker      = document.getElementById('star-picker');
const commentEl   = document.getElementById('vouch-comment');
const submitBtn   = document.getElementById('vouch-submit');
const deleteBtn   = document.getElementById('vouch-delete');
const wallEl      = document.getElementById('vouch-wall');
const emptyEl     = document.getElementById('vouch-empty');

let me = null;         // my profile row, or null if signed out
let myVouch = null;    // my existing vouch row, or null
let rating = 0;        // currently selected star rating in the form

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}
function stars(n) {
  const full = Math.round(n);
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}
function setMsg(text, kind = 'error') {
  const el = document.getElementById('vouch-msg');
  el.textContent = text || '';
  el.className = 'form-msg' + (text ? ' ' + kind : '');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (!isConfigured()) {
  showNotConfiguredBanner(document.querySelector('.page'));
  signinCard.hidden = false;
} else {
  boot();
}

async function boot() {
  me = await getProfile();
  if (me) {
    form.hidden = false;
    wirePicker();
    wireForm();
  } else {
    signinCard.hidden = false;
  }
  await loadWall();
}

// ---------------------------------------------------------------------------
// The wall
// ---------------------------------------------------------------------------
async function loadWall() {
  const { data, error } = await supabase
    .from('vouches')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    wallEl.innerHTML = '';
    emptyEl.hidden = false;
    emptyEl.textContent = 'Couldn\'t load vouches right now. Please try again later.';
    return;
  }

  const vouches = data || [];

  // Pull out my own vouch (if any) so the form reflects edit mode.
  myVouch = me ? vouches.find((v) => v.author_id === me.id) || null : null;
  if (me) reflectMyVouch();

  renderSummary(vouches);
  renderCards(vouches);
}

function renderSummary(vouches) {
  if (!vouches.length) {
    summaryEl.hidden = true;
    return;
  }
  const avg = vouches.reduce((s, v) => s + v.rating, 0) / vouches.length;
  avgEl.textContent = avg.toFixed(1);
  avgStarsEl.textContent = stars(avg);
  countEl.textContent =
    vouches.length + (vouches.length === 1 ? ' vouch' : ' vouches');
  summaryEl.hidden = false;
}

function renderCards(vouches) {
  if (!vouches.length) {
    wallEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  const canModerate = me && me.role === 'owner';

  wallEl.innerHTML = vouches.map((v) => {
    const mine = me && v.author_id === me.id;
    const avatar = v.author_avatar || 'assets/avatar.svg';
    const delBtn = (mine || canModerate)
      ? '<button class="vouch-del link-btn danger" data-id="' + esc(v.id) + '" type="button">Remove</button>'
      : '';
    return (
      '<article class="vouch-card cloud-card">' +
        '<div class="vouch-card-head">' +
          '<img class="vouch-avatar" src="' + esc(avatar) + '" alt="" ' +
            'onerror="this.src=\'assets/avatar.svg\'">' +
          '<div class="vouch-who">' +
            '<strong>' + esc(v.author_name) + (mine ? ' <span class="vouch-you">(you)</span>' : '') + '</strong>' +
            '<span class="vouch-date">' + esc(fmtDate(v.created_at)) + '</span>' +
          '</div>' +
          '<span class="vouch-stars" aria-label="' + v.rating + ' out of 5 stars">' +
            esc(stars(v.rating)) + '</span>' +
        '</div>' +
        '<p class="vouch-comment">' + esc(v.comment) + '</p>' +
        delBtn +
      '</article>'
    );
  }).join('');

  wallEl.querySelectorAll('.vouch-del').forEach((btn) => {
    btn.addEventListener('click', () => removeVouch(btn.dataset.id));
  });
}

// ---------------------------------------------------------------------------
// Star picker
// ---------------------------------------------------------------------------
function paintStars(n) {
  picker.querySelectorAll('.star-btn').forEach((b) => {
    const on = Number(b.dataset.value) <= n;
    b.textContent = on ? '★' : '☆';
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(Number(b.dataset.value) === rating));
  });
}
function wirePicker() {
  const btns = picker.querySelectorAll('.star-btn');
  btns.forEach((b) => {
    b.addEventListener('mouseenter', () => paintStars(Number(b.dataset.value)));
    b.addEventListener('click', () => {
      rating = Number(b.dataset.value);
      paintStars(rating);
    });
  });
  picker.addEventListener('mouseleave', () => paintStars(rating));
}

// ---------------------------------------------------------------------------
// Form: create / update / delete my vouch
// ---------------------------------------------------------------------------
function reflectMyVouch() {
  if (myVouch) {
    formTitle.textContent = 'Your vouch';
    rating = myVouch.rating;
    commentEl.value = myVouch.comment;
    submitBtn.textContent = 'Update vouch';
    deleteBtn.hidden = false;
  } else {
    formTitle.textContent = 'Leave a vouch';
    rating = 0;
    commentEl.value = '';
    submitBtn.textContent = 'Post vouch';
    deleteBtn.hidden = true;
  }
  paintStars(rating);
}

function wireForm() {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const comment = commentEl.value.trim();
    if (rating < 1) return setMsg('Please tap a star rating first.');
    if (comment.length < 2) return setMsg('Please write a short comment.');

    submitBtn.disabled = true;
    setMsg('Saving…', 'info');

    const row = {
      author_id: me.id,
      author_name: me.username || 'Customer',
      author_avatar: me.avatar_url || null,
      rating,
      comment,
      updated_at: new Date().toISOString(),
    };

    // One vouch per person: upsert on author_id creates or updates.
    const { error } = await supabase
      .from('vouches')
      .upsert(row, { onConflict: 'author_id' });

    submitBtn.disabled = false;
    if (error) {
      setMsg(error.message || 'Could not save your vouch.');
      return;
    }
    setMsg('Thanks for the vouch! 💙', 'success');
    await loadWall();
  });

  deleteBtn.addEventListener('click', () => {
    if (myVouch) removeVouch(myVouch.id);
  });
}

async function removeVouch(id) {
  const { error } = await supabase.from('vouches').delete().eq('id', id);
  if (error) {
    setMsg(error.message || 'Could not remove the vouch.');
    return;
  }
  setMsg('', 'info');
  await loadWall();
}
