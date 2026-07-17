// Portfolio gallery: merges owner-uploaded pieces from Supabase (newest first)
// with the legacy pieces in data/portfolio.json. When the owner is signed in,
// an "Add a new piece" form appears and each uploaded piece gets a remove
// button — updates go live instantly, no deploy needed.
import { supabase, isConfigured, getProfile } from './supabase-client.js';

const gallery = document.getElementById('gallery');
const addSection = document.getElementById('portfolio-add');
let isOwner = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function setMsg(text, kind = 'error') {
  const el = document.getElementById('piece-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'form-msg' + (text ? ' ' + kind : '');
}

// Open the shared lightbox (its close handlers live in main.js).
function openLightbox(imgSrc, title, meta) {
  const lb = document.querySelector('.lightbox');
  if (!lb) return;
  lb.querySelector('img').src = imgSrc;
  lb.querySelector('img').alt = title;
  lb.querySelector('figcaption').innerHTML =
    '<strong>' + esc(title) + '</strong>' + (meta ? '<span>' + esc(meta) + '</span>' : '');
  lb.classList.add('open');
}

function pieceFigure(p, i) {
  const fig = document.createElement('figure');
  fig.className = 'gallery-item reveal shown' +
    (i % 3 === 1 ? ' reveal-d1' : i % 3 === 2 ? ' reveal-d2' : '');
  const meta = [p.detail, p.year].filter(Boolean).join(' · ');
  fig.innerHTML =
    '<img src="' + esc(p.image) + '" alt="' + esc(p.title) + '" loading="lazy">' +
    '<figcaption><strong>' + esc(p.title) + '</strong>' +
    (meta ? '<span>' + esc(meta) + '</span>' : '') + '</figcaption>';

  // owner can remove pieces they uploaded via the site (not legacy JSON ones)
  if (p.id && isOwner) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'piece-del';
    del.title = 'Remove this piece';
    del.textContent = '✕';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Remove "' + p.title + '" from the portfolio?')) return;
      const { error } = await supabase.from('portfolio').delete().eq('id', p.id);
      if (error) return alert(error.message);
      loadGallery();
    });
    fig.appendChild(del);
  }

  fig.addEventListener('click', () => openLightbox(p.image, p.title, meta));
  return fig;
}

async function loadGallery() {
  if (!gallery) return;
  const pieces = [];

  // owner-uploaded pieces first (newest work up top)
  if (isConfigured() && supabase) {
    const { data } = await supabase
      .from('portfolio').select('*').order('created_at', { ascending: false });
    (data || []).forEach((p) => pieces.push({
      id: p.id, image: p.image_url, title: p.title, detail: p.detail, year: p.year,
    }));
  }

  // legacy pieces from the JSON file. Their image paths start with "/", which
  // breaks under a sub-path host (GitHub Pages) — make them relative.
  try {
    const res = await fetch('data/portfolio.json');
    if (res.ok) {
      const data = await res.json();
      ((data && data.pieces) || []).forEach((p) => pieces.push({
        image: String(p.image || '').replace(/^\//, ''),
        title: p.title || 'Hair design', detail: p.detail, year: p.year,
      }));
    }
  } catch (e) { /* legacy file missing is fine */ }

  gallery.innerHTML = '';
  if (!pieces.length) {
    gallery.innerHTML = '<p class="gallery-empty">No pieces yet — check back soon.</p>';
    return;
  }
  pieces.forEach((p, i) => gallery.appendChild(pieceFigure(p, i)));
}

// ---- Owner: add a new piece ------------------------------------------------
function wireAddForm() {
  const form = document.getElementById('piece-form');
  const fileInput = document.getElementById('piece-file');
  const fileName = document.getElementById('piece-file-name');

  fileInput.addEventListener('change', () => {
    fileName.textContent = fileInput.files[0] ? fileInput.files[0].name : '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('piece-title').value.trim();
    const detail = document.getElementById('piece-detail').value.trim() || null;
    const year = document.getElementById('piece-year').value.trim() || null;
    const file = fileInput.files[0];

    if (!title) return setMsg('Please give the piece a title.');
    if (!file) return setMsg('Please choose an image.');
    if (!file.type.startsWith('image/')) return setMsg('That file isn\'t an image.');
    if (file.size > 10 * 1024 * 1024) return setMsg('Image must be under 10 MB.');

    setMsg('Uploading…', 'info');
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
    const path = 'pieces/' + Date.now() + '-' + safe;
    const { error: upErr } = await supabase.storage
      .from('portfolio-images').upload(path, file, { contentType: file.type });
    if (upErr) return setMsg(upErr.message);

    const { data: pub } = supabase.storage.from('portfolio-images').getPublicUrl(path);
    const { error } = await supabase.from('portfolio')
      .insert({ title, detail, year, image_url: pub.publicUrl });
    if (error) {
      return setMsg(/portfolio/.test(error.message)
        ? 'The portfolio table is missing — run the newest schema.sql in Supabase first.'
        : error.message);
    }

    form.reset();
    fileName.textContent = '';
    setMsg('Added! ✨', 'success');
    setTimeout(() => setMsg(''), 1500);
    loadGallery();
  });
}

// ---- Boot ------------------------------------------------------------------
(async () => {
  if (isConfigured() && supabase) {
    const me = await getProfile();
    isOwner = !!me && me.role === 'owner';
    if (isOwner && addSection) {
      addSection.hidden = false;
      wireAddForm();
    }
  }
  await loadGallery();
})();
