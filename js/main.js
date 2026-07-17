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

// Pricing: "Request this tier" opens a popup asking how to contact Louis.
// If they pick the website chat, the tier is remembered so the chat page can
// pre-fill their first message.
const tierModal = document.getElementById('tier-modal');
if (tierModal) {
  const tierTitle = document.getElementById('tier-modal-title');
  const chatLink = document.getElementById('tier-chat-link');
  let currentTier = '';

  document.querySelectorAll('.request-tier').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentTier = btn.dataset.tier || '';
      tierTitle.textContent = currentTier ? 'Request: ' + currentTier : 'Request a commission';
      tierModal.hidden = false;
    });
  });

  chatLink.addEventListener('click', () => {
    try { localStorage.setItem('requested-tier', currentTier); } catch (e) { /* ignore */ }
  });

  const closeTierModal = () => { tierModal.hidden = true; };
  document.getElementById('tier-close').addEventListener('click', closeTierModal);
  tierModal.addEventListener('click', (e) => { if (e.target === tierModal) closeTierModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTierModal(); });
}

// Portfolio gallery rendering lives in js/portfolio.js (it merges the legacy
// data/portfolio.json pieces with owner-uploaded ones from Supabase).
