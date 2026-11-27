// js/main.js

const CLASS_CODE = 'SMPITBCA2023';

const PHOTO_PAGE_SIZE = 9;
const GB_PAGE_SIZE    = 6;
const WALL_PAGE_SIZE  = 6;
const DIR_PAGE_SIZE   = 12;

const galleryState = { page: 0, hasMore: true, loading: false, filter: 'all', search: '', sort: 'newest' };
const gbState      = { page: 0, hasMore: true, loading: false };
const wallState    = { page: 0, hasMore: true, loading: false };
const dirState     = { page: 0, hasMore: true, loading: false, name: '', className: '' };

const UPLOAD_LIMITS = { MAX_FILES: 20, MAX_SIZE_MB: 10, MAX_WIDTH: 1600, QUALITY: 0.82 };
const uploadState = { selectedFiles: [] };

const photoDownloadMap = new Map(); // id -> { url, title }

let galleryImages = []; // [{url, alt}] untuk lightbox
const GB_COOLDOWN_MS = 60_000;
const GB_MIN_FILL_MS = 3_000;
const GB_START_KEY = 'gb:formStart';
const GB_LAST_KEY  = 'gb:lastSubmit';

/* ========================================================
   UTIL
   ======================================================== */
function debounce(fn, wait = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}

/* ========================================================
   LIGHTBOX (global)
   ======================================================== */
const Lightbox = {
  images: [], index: 0, initialized: false,
  init() {
    if (this.initialized) return;
    this.initialized = true;
    const lb = document.getElementById('lightbox');
    document.getElementById('lightboxClose')?.addEventListener('click', () => this.close());
    document.getElementById('lightboxPrev')?.addEventListener('click', (e) => { e.stopPropagation(); this.prev(); });
    document.getElementById('lightboxNext')?.addEventListener('click', (e) => { e.stopPropagation(); this.next(); });
    lb?.addEventListener('click', (e) => { if (e.target === lb) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (!lb || !lb.classList.contains('active')) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft') this.prev();
      else if (e.key === 'ArrowRight') this.next();
    });
    let startX = 0;
    lb?.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    lb?.addEventListener('touchend', (e) => {
      const delta = e.changedTouches[0].clientX - startX;
      if (Math.abs(delta) > 50) delta > 0 ? this.prev() : this.next();
    });
  },
  open(images, index = 0) {
    this.init();
    this.images = images || [];
    this.index = Math.max(0, Math.min(index, this.images.length - 1));
    this.render();
    document.getElementById('lightbox')?.classList.add('active');
    document.body.style.overflow = 'hidden';
  },
  render() {
    const img = document.getElementById('lightboxImg');
    const counter = document.getElementById('lightboxCounter');
    const prevBtn = document.getElementById('lightboxPrev');
    const nextBtn = document.getElementById('lightboxNext');
    const src = this.images[this.index];
    if (!img || !src) return;
    img.src = typeof src === 'string' ? src : src.url;
    img.alt = typeof src === 'string' ? 'Foto' : (src.alt || 'Foto');
    if (counter) counter.textContent = `${this.index + 1} / ${this.images.length}`;
    const single = this.images.length <= 1;
    if (prevBtn) prevBtn.style.display = single ? 'none' : '';
    if (nextBtn) nextBtn.style.display = single ? 'none' : '';
  },
  prev() { if (this.images.length <= 1) return; this.index = (this.index - 1 + this.images.length) % this.images.length; this.render(); },
  next() { if (this.images.length <= 1) return; this.index = (this.index + 1) % this.images.length; this.render(); },
  close() {
    document.getElementById('lightbox')?.classList.remove('active');
    document.body.style.overflow = '';
  }
};

window.openLightbox = (imagesOrSrc, index = 0) => {
  if (Array.isArray(imagesOrSrc)) return Lightbox.open(imagesOrSrc, index);
  return Lightbox.open([imagesOrSrc], 0);
};
window.closeLightbox = () => Lightbox.close();

/* ========================================================
   DOWNLOAD FOTO — dengan state feedback
   ======================================================== */
window.downloadPhoto = async (url, title = 'foto', btnEl = null) => {
  if (!url) return;

  const originalHTML = btnEl ? btnEl.innerHTML : '';
  const setBtn = (state, html) => {
    if (!btnEl) return;
    btnEl.disabled = state === 'loading';
    btnEl.classList.remove('is-loading', 'is-success', 'is-error');
    if (state !== 'idle') btnEl.classList.add(`is-${state}`);
    if (html !== undefined) btnEl.innerHTML = html;
    if (window.lucide) lucide.createIcons();
  };

  // Batalkan timer restore sebelumnya (jika ada)
  if (btnEl && btnEl._restoreTimer) {
    clearTimeout(btnEl._restoreTimer);
    btnEl._restoreTimer = null;
  }

  setBtn('loading', '<i data-lucide="loader-2" class="spin"></i><span>Mengunduh...</span>');

  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();

    const typeToExt = {
      'image/jpeg': 'jpg', 'image/jpg': 'jpg',
      'image/png':  'png', 'image/webp': 'webp',
      'image/gif':  'gif', 'image/svg+xml': 'svg',
    };
    const ext = typeToExt[blob.type] || 'jpg';

    const safeName = (title || 'foto')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'foto';

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${safeName}.${ext}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);

    setBtn('success', '<i data-lucide="check"></i><span>Berhasil</span>');
    showToast('Foto berhasil diunduh!');
  } catch (err) {
    console.error('Download error:', err);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.download = `${(title || 'foto').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setBtn('success', '<i data-lucide="external-link"></i><span>Tab Dibuka</span>');
      showToast('Foto dibuka di tab baru. Klik kanan → Simpan gambar.', 'error');
    } catch (e) {
      setBtn('error', '<i data-lucide="alert-circle"></i><span>Gagal</span>');
      showToast('Gagal mengunduh foto.', 'error');
    }
  } finally {
    if (btnEl) {
      btnEl._restoreTimer = setTimeout(() => {
        btnEl._restoreTimer = null;
        if (!btnEl.disabled) setBtn('idle', originalHTML);
      }, 2000);
    }
  }
};

window.downloadCurrentLightbox = (btnEl = null) => {
  const img = document.getElementById('lightboxImg');
  if (!img || !img.src) return;
  const btn = btnEl || document.querySelector('.lightbox-download');
  downloadPhoto(img.src, img.alt || 'foto', btn);
};

/* ========================================================
   IMAGE COMPRESSION
   ======================================================== */
async function compressImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('File bukan gambar.');
  if (file.size > UPLOAD_LIMITS.MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`${file.name} melebihi ${UPLOAD_LIMITS.MAX_SIZE_MB} MB.`);
  }
  if (file.type === 'image/gif') return file;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > UPLOAD_LIMITS.MAX_WIDTH) {
        height = Math.round((height * UPLOAD_LIMITS.MAX_WIDTH) / width);
        width = UPLOAD_LIMITS.MAX_WIDTH;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Gagal kompres gambar.'));
          const name = file.name.replace(/\.\w+$/, '.jpg');
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        UPLOAD_LIMITS.QUALITY
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar tidak dapat dibaca.')); };
    img.src = url;
  });
}

function setUploadProgress(loaded, total) {
  const wrap = document.getElementById('uploadProgress');
  const fill = document.getElementById('uploadProgressFill');
  const text = document.getElementById('uploadProgressText');
  if (!wrap || !fill || !text) return;
  wrap.hidden = false;
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  fill.style.width = `${pct}%`;
  text.textContent = `${loaded} / ${total} foto (${pct}%)`;
}
function hideUploadProgress() {
  const wrap = document.getElementById('uploadProgress');
  const fill = document.getElementById('uploadProgressFill');
  if (wrap) wrap.hidden = true;
  if (fill) fill.style.width = '0%';
}

/* ========================================================
   UPLOAD UI (dropzone + preview)
   ======================================================== */
function initUploadUI() {
  const dropzone = document.getElementById('upDropzone');
  const fileInput = document.getElementById('upFile');
  const preview = document.getElementById('upPreview');
  if (!dropzone || !fileInput || !preview) return;

  const renderPreview = () => {
    preview.innerHTML = '';
    if (uploadState.selectedFiles.length === 0) { preview.hidden = true; return; }
    preview.hidden = false;
    uploadState.selectedFiles.forEach((file, i) => {
      const item = document.createElement('div');
      item.className = 'preview-item';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      const badge = document.createElement('span');
      badge.className = 'preview-badge';
      badge.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preview-remove';
      btn.setAttribute('aria-label', 'Hapus');
      btn.innerHTML = '<i data-lucide="x"></i>';
      btn.onclick = () => {
        URL.revokeObjectURL(img.src);
        uploadState.selectedFiles.splice(i, 1);
        renderPreview();
      };
      item.appendChild(img);
      item.appendChild(badge);
      item.appendChild(btn);
      preview.appendChild(item);
    });
    if (window.lucide) lucide.createIcons();
  };

  const addFiles = (list) => {
    const incoming = Array.from(list).filter((f) => f.type.startsWith('image/'));
    const remaining = UPLOAD_LIMITS.MAX_FILES - uploadState.selectedFiles.length;
    if (incoming.length > remaining) {
      showToast(`Maksimal ${UPLOAD_LIMITS.MAX_FILES} file. ${incoming.length - remaining} file diabaikan.`, 'error');
    }
    uploadState.selectedFiles.push(...incoming.slice(0, Math.max(0, remaining)));
    renderPreview();
  };

  dropzone.onclick = () => fileInput.click();
  fileInput.onchange = (e) => { addFiles(e.target.files); fileInput.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); });
  });
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  });

  window.__resetUploadUI = () => {
    uploadState.selectedFiles = [];
    renderPreview();
  };
  window.__renderUploadPreview = renderPreview;
}

/* ========================================================
   GALLERY — server-side pagination + filter + search + sort
   ======================================================== */
async function fetchPhotosPage() {
  const from = galleryState.page * PHOTO_PAGE_SIZE;
  const to = from + PHOTO_PAGE_SIZE - 1;

  let query = supabaseClient
    .from('photos')
    .select('*', { count: 'exact' })
    .eq('moderation_status', 'approved');

  if (galleryState.filter !== 'all') query = query.eq('category', galleryState.filter);
  if (galleryState.search) {
    const s = galleryState.search.replace(/[%,()]/g, '');
    query = query.or(`title.ilike.%${s}%,description.ilike.%${s}%`);
  }

  if (galleryState.sort === 'oldest') query = query.order('created_at', { ascending: true });
  else if (galleryState.sort === 'title') query = query.order('title', { ascending: true });
  else query = query.order('created_at', { ascending: false });

  const { data, count, error } = await query.range(from, to);
  if (error) throw error;
  return { data: data || [], total: count || 0 };
}

async function renderGallery({ reset = false } = {}) {
  const grid = document.getElementById('galleryGrid');
  const empty = document.getElementById('galleryEmpty');
  const wrap = document.getElementById('loadMoreWrap');
  const countEl = document.getElementById('galleryResultCount');
  if (!grid) return;

  if (reset) {
    galleryState.page = 0;
    galleryState.hasMore = true;
    grid.innerHTML = '';
    galleryImages = [];
  }
  if (galleryState.loading || !galleryState.hasMore) return;
  galleryState.loading = true;
  if (countEl) countEl.textContent = 'Memuat foto...';

  try {
    const { data, total } = await fetchPhotosPage();
    const user = await getCurrentUser();

    if (reset && data.length === 0) {
      empty.hidden = false;
      wrap.hidden = true;
      if (countEl) countEl.textContent = '0 foto';
      return;
    }
    empty.hidden = true;

    const catLabels = {
      angkatan: 'Foto Angkatan', kegiatan: 'Kegiatan Khusus',
      kebersamaan: 'Kebersamaan', kelas: 'Dokumentasi Kelas'
    };

    data.forEach((p) => {
      const imgUrl = getPhotoUrl(p.storage_path);
      const isOwner = user && user.id === p.user_id;
      const kegiatanName = p.title.includes(' - ') ? p.title.split(' - ')[0] : p.title;

      // Simpan info untuk tombol download
      photoDownloadMap.set(p.id, { url: imgUrl, title: p.title });

      const article = document.createElement('article');
      article.className = 'gallery-card reveal visible';
      article.dataset.cat = p.category;
      article.dataset.userPhoto = p.id;
      article.innerHTML = `
        <div class="gallery-media">
          <img src="${imgUrl}" alt="${escapeHtml(p.title)}" loading="lazy">
          <div class="photo-actions">
            <button class="photo-action-btn" data-download-id="${p.id}"
                    title="Unduh Foto" aria-label="Unduh Foto">
              <i data-lucide="download"></i>
              <span>Unduh</span>
            </button>
            ${isOwner ? `
            <button class="photo-action-btn photo-action-btn--danger"
                    onclick="event.stopPropagation(); hapusFoto('${p.id}', '${p.storage_path}')"
                    title="Hapus Foto" aria-label="Hapus Foto">
              <i data-lucide="trash-2"></i>
            </button>` : ''}
          </div>
        </div>
        <div class="gallery-info">
          <div class="photo-category">${catLabels[p.category] || 'Foto'}</div>
          <h3 class="gallery-title">${escapeHtml(p.title)}</h3>
          <div class="gallery-meta">Kegiatan: ${escapeHtml(kegiatanName)}</div>
          <p class="gallery-desc">${escapeHtml(p.description)}</p>
        </div>`;
      grid.appendChild(article);
      galleryImages.push({ url: imgUrl, alt: p.title });
    });

    // Bind klik lightbox dengan index global
    Array.from(grid.querySelectorAll('.gallery-media img')).forEach((img) => {
      const globalIdx = galleryImages.findIndex((g) => g.url === img.src);
      img.onclick = () => window.openLightbox(galleryImages, globalIdx);
    });

    // Bind tombol download (event delegation) — pass button ref agar ada feedback
    grid.querySelectorAll('[data-download-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const info = photoDownloadMap.get(btn.dataset.downloadId);
        if (info) downloadPhoto(info.url, info.title, btn);
      });
    });

    galleryState.page += 1;
    galleryState.hasMore = galleryState.page * PHOTO_PAGE_SIZE < total;

    if (countEl) countEl.textContent = `${total.toLocaleString('id-ID')} foto ditemukan`;
    if (wrap) wrap.hidden = !galleryState.hasMore;

    if (document.getElementById('statPhotos')) {
      document.getElementById('statPhotos').textContent = total.toLocaleString('id-ID');
    }
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Gagal memuat foto:', err);
    showToast('Gagal memuat galeri.', 'error');
  } finally {
    galleryState.loading = false;
  }
}

function syncGalleryURL() {
  const p = new URLSearchParams();
  if (galleryState.filter !== 'all') p.set('cat', galleryState.filter);
  if (galleryState.search) p.set('q', galleryState.search);
  if (galleryState.sort !== 'newest') p.set('sort', galleryState.sort);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `#gallery?${qs}` : '#gallery');
}

function readGalleryFromURL() {
  const hash = location.hash || '';
  const idx = hash.indexOf('?');
  if (idx < 0) return;
  const p = new URLSearchParams(hash.slice(idx + 1));
  galleryState.filter = p.get('cat') || 'all';
  galleryState.search = p.get('q') || '';
  galleryState.sort   = p.get('sort') || 'newest';

  document.querySelectorAll('.filter').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === galleryState.filter);
  });
  const searchEl = document.getElementById('gallerySearch');
  if (searchEl) searchEl.value = galleryState.search;
  const sortEl = document.getElementById('gallerySort');
  if (sortEl) sortEl.value = galleryState.sort;
  const clearBtn = document.getElementById('gallerySearchClear');
  if (clearBtn) clearBtn.hidden = !galleryState.search;
}

function setupGalleryEvents() {
  document.querySelectorAll('.filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      galleryState.filter = btn.dataset.filter;
      syncGalleryURL();
      renderGallery({ reset: true });
    });
  });

  document.getElementById('gallerySearch')?.addEventListener('input', debounce((e) => {
    galleryState.search = e.target.value.trim();
    const clearBtn = document.getElementById('gallerySearchClear');
    if (clearBtn) clearBtn.hidden = !galleryState.search;
    syncGalleryURL();
    renderGallery({ reset: true });
  }, 300));

  document.getElementById('gallerySearchClear')?.addEventListener('click', () => {
    const inp = document.getElementById('gallerySearch');
    if (inp) inp.value = '';
    galleryState.search = '';
    const clearBtn = document.getElementById('gallerySearchClear');
    if (clearBtn) clearBtn.hidden = true;
    syncGalleryURL();
    renderGallery({ reset: true });
  });

  document.getElementById('gallerySort')?.addEventListener('change', (e) => {
    galleryState.sort = e.target.value;
    syncGalleryURL();
    renderGallery({ reset: true });
  });

  document.getElementById('loadMoreBtn')?.addEventListener('click', () => renderGallery());
}

/* ========================================================
   GUESTBOOK — pagination + anti-spam
   ======================================================== */
function markGuestbookStart() {
  sessionStorage.setItem(GB_START_KEY, String(Date.now()));
}
function markGuestbookSuccess() {
  localStorage.setItem(GB_LAST_KEY, String(Date.now()));
  sessionStorage.removeItem(GB_START_KEY);
}
function validateGuestbook({ name, email, message, honeypot }) {
  if (honeypot && honeypot.trim() !== '') throw new Error('Permintaan terdeteksi sebagai spam.');

  const start = Number(sessionStorage.getItem(GB_START_KEY) || 0);
  if (!start || Date.now() - start < GB_MIN_FILL_MS) throw new Error('Form terkirim terlalu cepat. Coba lagi.');

  const last = Number(localStorage.getItem(GB_LAST_KEY) || 0);
  if (Date.now() - last < GB_COOLDOWN_MS) {
    const wait = Math.ceil((GB_COOLDOWN_MS - (Date.now() - last)) / 1000);
    throw new Error(`Tunggu ${wait} detik sebelum mengirim lagi.`);
  }

  const cleanName = (name || '').trim();
  const cleanEmail = (email || '').trim();
  const cleanMsg = (message || '').trim();

  if (cleanName.length < 3) throw new Error('Nama minimal 3 karakter.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('Format email tidak valid.');
  if (cleanMsg.length < 10) throw new Error('Pesan minimal 10 karakter.');
  if (cleanMsg.length > 500) throw new Error('Pesan maksimal 500 karakter.');

  const urlMatches = cleanMsg.match(/https?:\/\/|www\./gi) || [];
  if (urlMatches.length > 1) throw new Error('Pesan tidak boleh mengandung banyak link.');
  const capsRatio = cleanMsg.replace(/[^A-Z]/g, '').length / Math.max(cleanMsg.length, 1);
  if (capsRatio > 0.7 && cleanMsg.length > 20) throw new Error('Pesan terlalu banyak huruf kapital.');

  return { name: cleanName, email: cleanEmail, message: cleanMsg };
}

async function fetchGuestbookPage() {
  const from = gbState.page * GB_PAGE_SIZE;
  const to = from + GB_PAGE_SIZE - 1;
  const { data, count, error } = await supabaseClient
    .from('guestbook')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { data: data || [], total: count || 0 };
}

async function renderGuestbook({ reset = false } = {}) {
  const list = document.getElementById('gbList');
  const wrap = document.getElementById('gbLoadMoreWrap');
  if (!list) return;

  if (reset) {
    gbState.page = 0;
    gbState.hasMore = true;
    list.innerHTML = '';
  }
  if (gbState.loading || !gbState.hasMore) return;
  gbState.loading = true;

  if (reset) list.innerHTML = '<p style="text-align:center; color:#64748b;">Memuat pesan...</p>';

  try {
    const { data, total } = await fetchGuestbookPage();
    if (reset) list.innerHTML = '';

    if (reset && data.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; background: #f8fafc; border-radius: 12px; border: 1px dashed #cbd5e1; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <i data-lucide="message-square-dashed" style="width: 48px; height: 48px; color: #94a3b8; margin-bottom: 16px;"></i>
          <h3 style="color: #0f172a; font-size: 16px; margin-bottom: 8px; font-weight: 600;">Belum ada pesan</h3>
          <p style="color: #64748b; font-size: 14px;">Jadilah yang pertama meninggalkan jejak di sini!</p>
        </div>`;
      if (window.lucide) lucide.createIcons();
      if (wrap) wrap.hidden = true;
      return;
    }

    data.forEach((gb) => {
      list.insertAdjacentHTML('beforeend', `
        <div class="gb-item">
          <div class="gb-head">
            <div class="avatar">${escapeHtml(gb.name.charAt(0).toUpperCase())}</div>
            <div>
              <div class="gb-name">${escapeHtml(gb.name)}</div>
              <div class="gb-date">${formatDateTime(new Date(gb.created_at))}</div>
            </div>
          </div>
          <p class="gb-text">${escapeHtml(gb.message)}</p>
        </div>`);
    });

    gbState.page += 1;
    gbState.hasMore = gbState.page * GB_PAGE_SIZE < total;
    if (wrap) wrap.hidden = !gbState.hasMore;
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Gagal memuat guestbook:', err);
    list.innerHTML = '<p style="text-align:center; color:red;">Gagal memuat pesan.</p>';
  } finally {
    gbState.loading = false;
  }
}

function setupGuestbookHandlers() {
  markGuestbookStart();
  document.getElementById('gbForm')?.addEventListener('focusin', markGuestbookStart, { once: true });

  document.getElementById('gbForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const clean = validateGuestbook({
        name: document.getElementById('gbName').value,
        email: document.getElementById('gbEmail').value,
        message: document.getElementById('gbMessage').value,
        honeypot: document.getElementById('gbWebsite')?.value || ''
      });
      await submitGuestbook(clean);
      markGuestbookSuccess();
      e.target.reset();
      markGuestbookStart();
      await renderGuestbook({ reset: true });
      showToast('Pesan berhasil dikirim!');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('gbLoadMoreBtn')?.addEventListener('click', () => renderGuestbook());
}

/* ========================================================
   MEMORY WALL — pagination
   ======================================================== */
async function fetchWallPage() {
  const from = wallState.page * WALL_PAGE_SIZE;
  const to = from + WALL_PAGE_SIZE - 1;
  const { data, count, error } = await supabaseClient
    .from('memory_wall')
    .select('*, profiles(full_name), wall_likes(id)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { data: data || [], total: count || 0 };
}

async function renderMemoryWall({ reset = false } = {}) {
  const wall = document.getElementById('wallGrid');
  const wrap = document.getElementById('wallLoadMoreWrap');
  if (!wall) return;

  if (reset) {
    wallState.page = 0;
    wallState.hasMore = true;
    wall.innerHTML = '';
  }
  if (wallState.loading || !wallState.hasMore) return;
  wallState.loading = true;

  if (reset) wall.innerHTML = '<p>Memuat cerita...</p>';

  try {
    const { data: posts, total } = await fetchWallPage();
    if (reset) wall.innerHTML = '';

    if (document.getElementById('statWall')) {
      document.getElementById('statWall').textContent = total.toLocaleString('id-ID');
    }

    if (reset && posts.length === 0) {
      wall.innerHTML = '<p style="color: var(--text-muted)">Belum ada cerita di Memory Wall. Jadilah yang pertama!</p>';
      if (wrap) wrap.hidden = true;
      return;
    }

    const user = await getCurrentUser();
    posts.forEach((p) => {
      const authorName = p.profiles?.full_name || 'Anonim';
      const likesCount = p.wall_likes ? p.wall_likes.length : 0;
      const isOwner = user && user.id === p.user_id;
      wall.insertAdjacentHTML('beforeend', `
        <article class="wall-card reveal visible">
          <p class="wall-text" id="wall-text-${p.id}">${escapeHtml(p.content)}</p>
          <div class="wall-author">
            <div class="avatar">${escapeHtml(authorName.charAt(0).toUpperCase())}</div>
            <div class="wall-author-info">
              <div class="wall-author-name">${escapeHtml(authorName)}</div>
              <div class="wall-author-meta">Anggota</div>
            </div>
            <div class="wall-footer-actions">
              <button class="reaction-btn" onclick="toggleLike('${p.id}')">
                <i data-lucide="heart"></i> <span>${likesCount}</span>
              </button>
              ${isOwner ? `
              <div class="wall-actions">
                <button class="wall-action-btn" onclick="editWall('${p.id}')" title="Edit Cerita"><i data-lucide="edit-2"></i></button>
                <button class="wall-action-btn text-danger" onclick="hapusWall('${p.id}')" title="Hapus Cerita"><i data-lucide="trash-2"></i></button>
              </div>` : ''}
            </div>
          </div>
        </article>`);
    });

    wallState.page += 1;
    wallState.hasMore = wallState.page * WALL_PAGE_SIZE < total;
    if (wrap) wrap.hidden = !wallState.hasMore;
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error Memory Wall:', err);
    wall.innerHTML = '<p>Gagal memuat Memory Wall. Cek Console (F12).</p>';
  } finally {
    wallState.loading = false;
  }
}

/* ========================================================
   DIRECTORY — pagination + filter
   ======================================================== */
async function fetchDirectoryPage() {
  const from = dirState.page * DIR_PAGE_SIZE;
  const to = from + DIR_PAGE_SIZE - 1;
  let q = supabaseClient
    .from('profiles')
    .select('id, full_name, class_name, bio, avatar_url, instagram', { count: 'exact' })
    .eq('is_public', true);
  if (dirState.name) q = q.ilike('full_name', `%${dirState.name}%`);
  if (dirState.className) q = q.eq('class_name', dirState.className);
  const { data, count, error } = await q
    .order('full_name', { ascending: true })
    .range(from, to);
  if (error) throw error;
  return { data: data || [], total: count || 0 };
}

function renderDirCard(p) {
  const initial = (p.full_name || '?').charAt(0).toUpperCase();
  const avatar = p.avatar_url
    ? `<img src="${p.avatar_url}" alt="${escapeHtml(p.full_name || '')}" loading="lazy">`
    : initial;
  const ig = p.instagram
    ? `<a class="directory-ig" href="https://instagram.com/${encodeURIComponent(p.instagram.replace(/^@/, ''))}" target="_blank" rel="noopener">
         <i data-lucide="instagram"></i> @${escapeHtml(p.instagram.replace(/^@/, ''))}
       </a>` : '';
  return `
    <article class="directory-card">
      <div class="directory-avatar">${avatar}</div>
      <div class="directory-name">${escapeHtml(p.full_name || 'Tanpa Nama')}</div>
      ${p.class_name ? `<span class="directory-class">${escapeHtml(p.class_name)}</span>` : ''}
      ${p.bio ? `<p class="directory-bio">${escapeHtml(p.bio)}</p>` : ''}
      ${ig}
    </article>`;
}

async function renderDirectory({ reset = false } = {}) {
  const grid = document.getElementById('directoryGrid');
  const empty = document.getElementById('directoryEmpty');
  const wrap = document.getElementById('dirLoadMoreWrap');
  if (!grid) return;

  const user = await getCurrentUser();
  if (!user) {
    grid.innerHTML = '';
    if (empty) empty.hidden = false;
    if (wrap) wrap.hidden = true;
    return;
  }

  if (reset) {
    dirState.page = 0;
    dirState.hasMore = true;
    grid.innerHTML = '';
  }
  if (dirState.loading || !dirState.hasMore) return;
  dirState.loading = true;

  try {
    const { data, total } = await fetchDirectoryPage();

    if (reset && data.length === 0) {
      empty.hidden = false;
      wrap.hidden = true;
      return;
    }
    empty.hidden = true;

    const fragment = document.createElement('div');
    fragment.innerHTML = data.map(renderDirCard).join('');
    while (fragment.firstChild) grid.appendChild(fragment.firstChild);

    dirState.page += 1;
    dirState.hasMore = dirState.page * DIR_PAGE_SIZE < total;
    if (wrap) wrap.hidden = !dirState.hasMore;
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Directory error:', err);
    if (empty) empty.hidden = false;
  } finally {
    dirState.loading = false;
  }
}

async function populateDirClassFilter() {
  const select = document.getElementById('dirClassFilter');
  if (!select) return;
  try {
    const { data } = await supabaseClient
      .from('profiles')
      .select('class_name')
      .eq('is_public', true)
      .not('class_name', 'is', null);
    const unique = [...new Set((data || []).map((r) => r.class_name).filter(Boolean))].sort();
    unique.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      select.appendChild(opt);
    });
  } catch (e) { console.warn('Gagal memuat filter kelas', e); }
}

function setupDirectoryHandlers() {
  document.getElementById('dirSearch')?.addEventListener('input', debounce((e) => {
    dirState.name = e.target.value.trim();
    renderDirectory({ reset: true });
  }, 300));

  document.getElementById('dirClassFilter')?.addEventListener('change', (e) => {
    dirState.className = e.target.value;
    renderDirectory({ reset: true });
  });

  document.getElementById('dirLoadMoreBtn')?.addEventListener('click', () => renderDirectory());
}

/* ========================================================
   AUTH / WALL / PHOTO HANDLERS (dipakai dari HTML)
   ======================================================== */
function refreshUI(user) {
  const loggedIn = !!user;
  document.getElementById('authButtons').hidden = loggedIn;
  document.getElementById('userMenu').hidden = !loggedIn;
  document.getElementById('btnAddPhoto').hidden = !loggedIn;
  document.getElementById('btnAddWall').hidden = !loggedIn;
  if (loggedIn) {
    const name = user.user_metadata?.full_name || user.email;
    document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
    document.getElementById('userName').textContent = name;
  }
}

function setupAuthHandlers() {
  document.getElementById('btnLogin')?.addEventListener('click', () => { switchAuthTab('login'); openModal('authModal'); });
  document.getElementById('btnRegister')?.addEventListener('click', () => { switchAuthTab('register'); openModal('authModal'); });

  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await loginMember(document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
      closeModal('authModal');
      e.target.reset();
      showToast('Berhasil masuk!');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      if (document.getElementById('regCode').value.trim() !== CLASS_CODE) throw new Error('Kode angkatan salah.');
      await registerMember(
        document.getElementById('regName').value,
        document.getElementById('regEmail').value,
        document.getElementById('regPassword').value
      );
      closeModal('authModal');
      e.target.reset();
      showToast('Pendaftaran berhasil!');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await logout();
    showToast('Kamu sudah keluar.');
  });
}

function setupUploadHandlers() {
  initUploadUI();

  document.getElementById('btnAddPhoto')?.addEventListener('click', () => {
    document.getElementById('upDate').value = new Date().toISOString().slice(0, 10);
    window.__resetUploadUI?.();
    hideUploadProgress();
    openModal('uploadModal');
  });

  document.getElementById('uploadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('uploadBtn');
    const btnText = document.getElementById('uploadBtnText');
    const original = btnText.textContent;

    const files = uploadState.selectedFiles;
    if (files.length === 0) {
      showToast('Pilih minimal satu foto.', 'error');
      return;
    }

    const meta = {
      title: document.getElementById('upTitle').value.trim(),
      category: document.getElementById('upCategory').value,
      description: document.getElementById('upDesc').value.trim(),
      date: document.getElementById('upDate').value
    };

    btn.disabled = true;
    btnText.textContent = 'Mengompres...';
    let success = 0, failed = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        btnText.textContent = `Mengunggah ${i + 1}/${files.length}...`;
        try {
          const compressed = await compressImage(files[i]);
          await addPhoto({ ...meta, file: compressed });
          success++;
        } catch (err) {
          failed++;
          console.error(`Gagal upload ${files[i].name}:`, err);
        }
        setUploadProgress(i + 1, files.length);
      }

      if (success > 0) {
        closeModal('uploadModal');
        e.target.reset();
        window.__resetUploadUI?.();
        hideUploadProgress();
        await renderGallery({ reset: true });
        showToast(
          failed === 0 ? `${success} foto berhasil diunggah!`
                       : `${success} foto berhasil, ${failed} gagal.`,
          failed === 0 ? 'success' : 'error'
        );
      } else {
        showToast('Semua foto gagal diunggah. Coba lagi.', 'error');
      }
    } finally {
      btn.disabled = false;
      btnText.textContent = original;
      if (window.lucide) lucide.createIcons();
    }
  });
}

function setupWallHandlers() {
  document.getElementById('btnAddWall')?.addEventListener('click', () => {
    document.getElementById('wallForm').reset();
    document.getElementById('wallId').value = '';
    document.getElementById('wallSubmitText').textContent = 'Kirim Cerita';
    document.getElementById('wallModalTitle').textContent = 'Bagikan Cerita Kenangan';
    openModal('wallModal');
  });

  document.getElementById('wallForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Memproses...';
    if (window.lucide) lucide.createIcons();

    const wallId = document.getElementById('wallId').value;
    const content = document.getElementById('wallContent').value;

    try {
      if (wallId) {
        await updateWallPost(wallId, content);
        showToast('Cerita berhasil diperbarui!');
      } else {
        await submitWallPost(content);
        showToast('Cerita berhasil dibagikan!');
      }
      closeModal('wallModal');
      e.target.reset();
      await renderMemoryWall({ reset: true });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
      if (window.lucide) lucide.createIcons();
    }
  });
}

window.editWall = (id) => {
  const content = document.getElementById(`wall-text-${id}`).textContent;
  document.getElementById('wallId').value = id;
  document.getElementById('wallContent').value = content;
  document.getElementById('wallSubmitText').textContent = 'Simpan Perubahan';
  document.getElementById('wallModalTitle').textContent = 'Edit Cerita Kenangan';
  openModal('wallModal');
};

window.hapusWall = async (id) => {
  if (confirm('Hapus cerita ini? Tindakan tidak bisa dibatalkan.')) {
    try {
      await deleteWallPost(id);
      await renderMemoryWall({ reset: true });
      showToast('Cerita dihapus.');
    } catch (err) { showToast(err.message, 'error'); }
  }
};

window.hapusFoto = async (id, path) => {
  if (confirm('Hapus foto ini? Tindakan tidak bisa dibatalkan.')) {
    try {
      await deletePhoto(id, path);
      await renderGallery({ reset: true });
      showToast('Foto dihapus.');
    } catch (err) { showToast(err.message, 'error'); }
  }
};

/* ========================================================
   MISC UI (scroll top, lazy, stats, enhance static cards)
   ======================================================== */
function setupScrollTopButton() {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('show', window.scrollY > 300);
  });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function setupLazyLoading() {
  document.querySelectorAll('img:not([loading])').forEach((img) => {
    img.setAttribute('loading', 'lazy');
  });
}

/* ========================================================
   ENHANCE STATIC GALLERY CARDS
   Menambahkan tombol download ke setiap .gallery-card yang
   ditulis langsung di HTML (bukan dari renderGallery).
   ======================================================== */
function enhanceStaticGalleryCards() {
  document.querySelectorAll('.gallery-card').forEach((card) => {
    if (card.querySelector('.photo-actions')) return;
    const media = card.querySelector('.gallery-media');
    const img = card.querySelector('.gallery-media img');
    if (!media || !img) return;

    const url = img.getAttribute('src');
    const titleEl = card.querySelector('.gallery-title');
    const title = titleEl?.textContent?.trim() || img.alt || 'foto';

    const actions = document.createElement('div');
    actions.className = 'photo-actions';
    actions.innerHTML = `
      <button class="photo-action-btn" title="Unduh Foto" aria-label="Unduh Foto">
        <i data-lucide="download"></i>
        <span>Unduh</span>
      </button>`;

    const btn = actions.querySelector('button');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadPhoto(url, title, btn);
    });
    media.appendChild(actions);
  });
  if (window.lucide) lucide.createIcons();
}

function animateValue(id, start, end, duration) {
  const obj = document.getElementById(id);
  if (!obj) return;
  let startTs = null;
  const step = (ts) => {
    if (!startTs) startTs = ts;
    const p = Math.min((ts - startTs) / duration, 1);
    obj.textContent = Math.floor(p * (end - start) + start).toLocaleString('id-ID');
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setupStatsAnimation() {
  setTimeout(() => {
    const sp = document.getElementById('statPhotos');
    const sw = document.getElementById('statWall');
    const sa = document.getElementById('statAnggota');
    const st = document.getElementById('statTahun');
    if (sp) animateValue('statPhotos', 0, parseInt(sp.textContent.replace(/\D/g, '') || 0), 1500);
    if (sw) animateValue('statWall', 0, parseInt(sw.textContent.replace(/\D/g, '') || 0), 1500);
    if (sa) animateValue('statAnggota', 0, 167, 1500);
    if (st) animateValue('statTahun', 0, 3, 1500);
  }, 800);
}

/* ========================================================
   BOOT
   ======================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof initUI === 'function') initUI();

  const user = await getCurrentUser();
  refreshUI(user);

  setupAuthHandlers();
  setupGalleryEvents();
  setupUploadHandlers();
  setupWallHandlers();
  setupGuestbookHandlers();
  setupDirectoryHandlers();
  setupScrollTopButton();
  setupLazyLoading();
  enhanceStaticGalleryCards();

  readGalleryFromURL();

  await Promise.all([
    renderGallery({ reset: true }),
    renderGuestbook({ reset: true }),
    renderMemoryWall({ reset: true })
  ]);

  if (user) {
    populateDirClassFilter();
    renderDirectory({ reset: true });
  } else {
    const empty = document.getElementById('directoryEmpty');
    if (empty) empty.hidden = false;
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    refreshUI(session?.user ?? null);
    if (_event === 'SIGNED_IN') {
      populateDirClassFilter();
      renderDirectory({ reset: true });
    } else if (_event === 'SIGNED_OUT') {
      const grid = document.getElementById('directoryGrid');
      if (grid) grid.innerHTML = '';
      const empty = document.getElementById('directoryEmpty');
      if (empty) empty.hidden = false;
    }
    renderGallery({ reset: true });
    renderMemoryWall({ reset: true });
  });

  setupStatsAnimation();
  if (window.lucide) lucide.createIcons();
});