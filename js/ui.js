/* ============================================================
   UI UTILITIES — Memories of School
   File: js/ui.js
   ============================================================ */

/* ------------------------------------------------------------
   1. TOAST NOTIFICATION
   ------------------------------------------------------------ */
let _toastTimer = null;

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    t.className = 'toast' + (type ? ' ' + type : '');
  }, 3000);
}

/* ------------------------------------------------------------
   2. ESCAPE HTML (anti XSS)
   ------------------------------------------------------------ */
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}

/* ------------------------------------------------------------
   3. FORMAT TANGGAL
   ------------------------------------------------------------ */
function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

function formatDateTime(date = new Date()) {
  return date.toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric'
  }) + ' · ' + date.toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit'
  });
}

/* ------------------------------------------------------------
   4. LABEL KATEGORI
   ------------------------------------------------------------ */
function labelOf(cat) {
  const labels = {
    'angkatan': 'Foto Angkatan',
    'kegiatan': 'Kegiatan Khusus',
    'kebersamaan': 'Kebersamaan',
    'kelas': 'Dokumentasi Kelas'
  };
  return labels[cat] || cat;
}

/* ------------------------------------------------------------
   5. MODAL CONTROL
   ------------------------------------------------------------ */
function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  if (window.lucide) lucide.createIcons();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.querySelectorAll('.modal-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  if (loginForm) loginForm.hidden = !isLogin;
  if (registerForm) registerForm.hidden = isLogin;
}

/* ------------------------------------------------------------
   6. FILTER GALLERY (Diperbarui Agar Sinkron dengan Load More)
   ------------------------------------------------------------ */
let currentFilter = 'all';

function setFilter(cat) {
  currentFilter = cat;
  document.querySelectorAll('.filter').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === cat)
  );
  applyFilter();
}

function applyFilter() {
  // 1. Tampilkan / Sembunyikan seluruh grup kategori (termasuk judulnya)
  document.querySelectorAll('.category-group').forEach(group => {
    const show = currentFilter === 'all' || group.dataset.cat === currentFilter;
    group.style.display = show ? 'block' : 'none';
  });

  // 2. Atur Load More (Lihat Foto Selanjutnya)
  const loadMoreContainer = document.querySelector('.load-more-container');
  
  if (currentFilter === 'all') {
    // Jika "Semua Foto", panggil initLoadMore() dari main.js agar memotong maksimal 6 foto
    if (typeof initLoadMore === 'function') {
      initLoadMore();
    } else if (loadMoreContainer) {
      loadMoreContainer.style.display = 'block';
    }
  } else {
    // Jika memilih kategori spesifik, sembunyikan tombol Load More
    if (loadMoreContainer) {
      loadMoreContainer.style.display = 'none';
    }
    // Munculkan SEMUA foto di kategori tersebut (hilangkan efek sembunyi dari Load More)
    document.querySelectorAll('.gallery-card').forEach(card => {
      card.style.removeProperty('display');
    });
  }
}

/* ------------------------------------------------------------
   7. MOBILE NAV
   ------------------------------------------------------------ */
function initMobileNav() {
  const navLinks = document.getElementById('navLinks');
  const toggle = document.getElementById('mobileToggle');
  if (!navLinks || !toggle) return;

  toggle.addEventListener('click', () => navLinks.classList.toggle('open'));
  navLinks.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => navLinks.classList.remove('open'))
  );
}

/* ------------------------------------------------------------
   8. FILTER BUTTONS
   ------------------------------------------------------------ */
function initFilters() {
  document.querySelectorAll('.filter').forEach(btn => {
    btn.addEventListener('click', () => setFilter(btn.dataset.filter));
  });
}

/* ------------------------------------------------------------
   9. REVEAL ON SCROLL
   ------------------------------------------------------------ */
function initReveal() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

/* ------------------------------------------------------------
   10. REACTION BUTTONS (Memory Wall ❤️)
   ------------------------------------------------------------ */
function initReactions() {
  document.querySelectorAll('[data-reaction]').forEach(btn => {
    btn.addEventListener('click', () => {
      const span = btn.querySelector('span');
      const n = parseInt(span.textContent, 10);
      btn.classList.toggle('liked');
      span.textContent = btn.classList.contains('liked') ? n + 1 : n - 1;
    });
  });
}

/* ------------------------------------------------------------
   11. MODAL CLOSE LISTENERS
   ------------------------------------------------------------ */
function initModalCloseListeners() {
  document.querySelectorAll('[data-close-modal]').forEach(el => {
    el.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) closeModal(modal.id);
    });
  });

  document.querySelectorAll('.modal-tab').forEach(t => {
    t.addEventListener('click', () => switchAuthTab(t.dataset.tab));
  });

  document.querySelectorAll('[data-switch]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab(a.dataset.switch);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal:not([hidden])').forEach(m =>
        closeModal(m.id)
      );
    }
  });
}

/* ------------------------------------------------------------
   12. RENDER ULANG IKON LUCIDE
   ------------------------------------------------------------ */
function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

/* ------------------------------------------------------------
   13. INIT SEMUA UI
   ------------------------------------------------------------ */
function initUI() {
  refreshIcons();
  initMobileNav();
  initFilters();
  initReveal();
  initReactions();
  initModalCloseListeners();
}