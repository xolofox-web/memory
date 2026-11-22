// js/main.js
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Inisialisasi UI Dasar (Ikon, Modal, Filter, Mobile Nav)
  if (typeof initUI === 'function') initUI();

  // 2. Cek Sesi User Saat Ini
  const user = await getCurrentUser();
  refreshUI(user);

  // 3. Dengarkan Perubahan Auth (Login/Logout)
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    refreshUI(session?.user ?? null);
    renderGallery(); // Reload galeri karena tombol hapus mungkin berubah
  });

  // 4. Render Data dari Supabase
  await renderGallery();
  await renderGuestbook();
  await renderMemoryWall();

  // ==========================================
  // BAGIAN EVENT LISTENER (AUTH & CRUD)
  // ==========================================

  // --- LOGIN ---
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const email = document.getElementById('loginEmail').value;
      const pass = document.getElementById('loginPassword').value;
      await loginMember(email, pass);
      closeModal('authModal');
      e.target.reset();
      showToast('Berhasil masuk!');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // --- REGISTER ---
  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const name = document.getElementById('regName').value;
      const email = document.getElementById('regEmail').value;
      const pass = document.getElementById('regPassword').value;
      await registerMember(name, email, pass);
      closeModal('authModal');
      e.target.reset();
      showToast('Pendaftaran berhasil!');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // --- LOGOUT ---
  document.getElementById('btnLogout').addEventListener('click', async () => {
    await logout();
    showToast('Kamu sudah keluar.');
  });

  // --- TAMBAH FOTO (Buka Modal) ---
  document.getElementById('btnAddPhoto').addEventListener('click', () => {
    document.getElementById('upDate').value = new Date().toISOString().slice(0, 10);
    openModal('uploadModal');
  });

  // --- TAMBAH FOTO (Submit) ---
  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await addPhoto({
        file: document.getElementById('upFile').files[0],
        title: document.getElementById('upTitle').value,
        category: document.getElementById('upCategory').value,
        description: document.getElementById('upDesc').value,
        date: document.getElementById('upDate').value
      });
      closeModal('uploadModal');
      e.target.reset();
      document.getElementById('upPreview').hidden = true;
      await renderGallery();
      showToast('Foto berhasil diunggah!');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // --- GUESTBOOK (Submit) ---
  document.getElementById('gbForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await submitGuestbook({
        name: document.getElementById('gbName').value,
        email: document.getElementById('gbEmail').value,
        message: document.getElementById('gbMessage').value
      });
      e.target.reset();
      await renderGuestbook();
      showToast('Pesan berhasil dikirim!');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
});

// ==========================================
// FUNGSI RENDER & UI
// ==========================================

function refreshUI(user) {
  const loggedIn = !!user;
  document.getElementById('authButtons').hidden = loggedIn;
  document.getElementById('userMenu').hidden = !loggedIn;
  document.getElementById('btnAddPhoto').hidden = !loggedIn;
  
  if (loggedIn) {
    const name = user.user_metadata?.full_name || user.email;
    document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
    document.getElementById('userName').textContent = name;
  }
}

async function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  grid.innerHTML = '<p>Memuat galeri...</p>';
  
  const { data, error } = await supabaseClient
    .from('photos')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return grid.innerHTML = 'Gagal memuat foto.';
  
  grid.innerHTML = '';
  const user = await getCurrentUser();

  data.forEach(p => {
    const imgUrl = getPhotoUrl(p.storage_path);
    const isOwner = user && user.id === p.user_id;
    
    grid.innerHTML += `
      <article class="gallery-card reveal visible" data-cat="${p.category}">
        <div class="gallery-media">
          <span class="gallery-badge">${labelOf(p.category)}</span>
          <img src="${imgUrl}" alt="${p.title}">
          ${isOwner ? `<button class="photo-delete-btn" onclick="hapusFoto('${p.id}', '${p.storage_path}')"><i data-lucide="trash-2"></i></button>` : ''}
        </div>
        <div class="gallery-info">
          <div class="gallery-date"><i data-lucide="calendar"></i> ${formatDate(p.photo_date)}</div>
          <h3 class="gallery-title">${p.title}</h3>
          <p class="gallery-desc">${p.description}</p>
        </div>
      </article>`;
  });
  
  if (window.lucide) lucide.createIcons();
  applyFilter(); // Terapkan filter jika sedang aktif
}

async function renderGuestbook() {
  const list = document.getElementById('gbList');
  list.innerHTML = '<p>Memuat pesan...</p>';
  
  const data = await fetchGuestbook();
  list.innerHTML = '';
  
  data.forEach(gb => {
    list.innerHTML += `
      <div class="gb-item">
        <div class="gb-head">
          <div class="avatar">${gb.name.charAt(0).toUpperCase()}</div>
          <div>
            <div class="gb-name">${gb.name}</div>
            <div class="gb-date">${formatDateTime(new Date(gb.created_at))}</div>
          </div>
        </div>
        <p class="gb-text">${gb.message}</p>
      </div>`;
  });
}

async function renderMemoryWall() {
  const wall = document.getElementById('wallGrid');
  wall.innerHTML = '<p>Memuat cerita...</p>';
  
  try {
    const posts = await fetchWallPosts();
    wall.innerHTML = '';
    posts.forEach(p => {
      wall.innerHTML += `
        <article class="wall-card reveal visible">
          <p class="wall-text">${p.content}</p>
          <div class="wall-author">
            <div class="avatar">${p.profiles.full_name.charAt(0).toUpperCase()}</div>
            <div class="wall-author-info">
              <div class="wall-author-name">${p.profiles.full_name}</div>
            </div>
            <button class="reaction-btn" onclick="toggleLike('${p.id}')">
              <i data-lucide="heart"></i> <span>${p.wall_likes.length}</span>
            </button>
          </div>
        </article>`;
    });
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    wall.innerHTML = 'Gagal memuat Memory Wall.';
  }
}

// Helper untuk hapus foto dari HTML
window.hapusFoto = async (id, path) => {
  if (confirm('Hapus foto ini?')) {
    try {
      await deletePhoto(id, path);
      await renderGallery();
      showToast('Foto dihapus.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
};