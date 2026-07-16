// Louis · UGC portfolio — small interactions

// Mobile nav toggle
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
  navLinks.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// Scroll reveal — observe existing + newly added .reveal elements
let revealObserver = null;

if ('IntersectionObserver' in window) {
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('shown');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
}

function observeReveal(el) {
  if (revealObserver) revealObserver.observe(el);
  else el.classList.add('shown');
}

document.querySelectorAll('.reveal').forEach(observeReveal);

// Lightbox (portfolio page)
const lightbox = document.querySelector('.lightbox');
let openLightbox = null;

if (lightbox) {
  const lightboxImg = lightbox.querySelector('img');
  const lightboxCaption = lightbox.querySelector('figcaption');
  const closeBtn = lightbox.querySelector('.lightbox-close');

  const close = () => lightbox.classList.remove('open');

  openLightbox = (item) => {
    const img = item.querySelector('img');
    const caption = item.querySelector('figcaption');
    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt;
    lightboxCaption.innerHTML = caption ? caption.innerHTML : '';
    lightbox.classList.add('open');
  };

  closeBtn.addEventListener('click', close);
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

// Portfolio gallery — render from data/portfolio.json
const gallery = document.getElementById('gallery');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

if (gallery) {
  fetch('data/portfolio.json')
    .then((res) => {
      if (!res.ok) throw new Error('Could not load portfolio data');
      return res.json();
    })
    .then((data) => {
      const pieces = (data && data.pieces) || [];
      gallery.innerHTML = '';

      if (!pieces.length) {
        gallery.innerHTML = '<p class="gallery-empty">No pieces yet — check back soon.</p>';
        return;
      }

      pieces.forEach((piece, i) => {
        const fig = document.createElement('figure');
        fig.className = 'gallery-item reveal' + (i % 3 === 1 ? ' reveal-d1' : i % 3 === 2 ? ' reveal-d2' : '');

        const meta = [piece.detail, piece.year].filter(Boolean).join(' · ');
        fig.innerHTML =
          '<img src="' + escapeHtml(piece.image) + '" alt="' + escapeHtml(piece.title || 'Hair design') + '">' +
          '<figcaption><strong>' + escapeHtml(piece.title || '') + '</strong>' +
          (meta ? '<span>' + escapeHtml(meta) + '</span>' : '') + '</figcaption>';

        if (openLightbox) fig.addEventListener('click', () => openLightbox(fig));
        gallery.appendChild(fig);
        observeReveal(fig);
      });
    })
    .catch(() => {
      gallery.innerHTML = '<p class="gallery-empty">Couldn\'t load the portfolio right now. Please try again later.</p>';
    });
}
