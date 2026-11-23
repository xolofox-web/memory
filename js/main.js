// js/main.js
const CLASS_CODE = 'SMPITBCA2023';
let isRenderingGallery = false;

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof initUI === 'function') initUI();

  const user = await getCurrentUser();
  refreshUI(user);

  await renderGallery();
  await renderGuestbook();
  await renderMemoryWall();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    refreshUI(session?.user ?? null);
    if (_event === 'SIGNED_IN' || _event === 'SIGNED_OUT') {
      renderGallery(); 
      renderMemoryWall();
    }
  });

  document.getElementById('btnLogin').addEventListener('click', () => { switchAuthTab('login'); openModal('authModal'); });
  document.getElementById('btnRegister').addEventListener('click', () => { switchAuthTab('register'); openModal('authModal'); });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
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

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      if (document.getElementById('regCode').value.trim() !== CLASS_CODE) throw new Error('Kode angkatan salah.');
      await registerMember(document.getElementById('regName').value, document.getElementById('regEmail').value, document.getElementById('regPassword').value);
      closeModal('authModal');
      e.target.reset();
      showToast('Pendaftaran berhasil!');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btnLogout').addEventListener('click', async () => { await logout(); showToast('Kamu sudah keluar.'); });

  document.getElementById('btnAddPhoto').addEventListener('click', () => {
    document.getElementById('upDate').value = new Date().toISOString().slice(0, 10);
    openModal('uploadModal');
  });

  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Mengunggah...'; if(window.lucide) lucide.createIcons();
    try {
      await addPhoto({
        file: document.getElementById('upFile').files[0], title: document.getElementById('upTitle').value,
        category: document.getElementById('upCategory').value, description: document.getElementById('upDesc').value, date: document.getElementById('upDate').value
      });
      closeModal('uploadModal'); e.target.reset(); document.getElementById('upPreview').hidden = true;
      await renderGallery(); showToast('Foto berhasil diunggah!');
    } catch (err) { showToast(err.message, 'error'); } 
    finally { btn.disabled = false; btn.innerHTML = originalText; if(window.lucide) lucide.createIcons(); }
  });

  // --- MEMORY WALL: BUKA MODAL (TAMBAH BARU) ---
  document.getElementById('btnAddWall').addEventListener('click', () => {
    document.getElementById('wallForm').reset();
    document.getElementById('wallId').value = ''; 
    document.getElementById('wallSubmitText').textContent = 'Kirim Cerita';
    document.getElementById('wallModalTitle').textContent = 'Bagikan Cerita Kenangan';
    openModal('wallModal');
  });

  // --- MEMORY WALL: SUBMIT (TAMBAH ATAU EDIT) ---
  document.getElementById('wallForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Memproses...'; if(window.lucide) lucide.createIcons();
    
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
      await renderMemoryWall(); 
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.innerHTML = originalText; if(window.lucide) lucide.createIcons();
    }
  });

  document.getElementById('gbForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await submitGuestbook({ name: document.getElementById('gbName').value, email: document.getElementById('gbEmail').value, message: document.getElementById('gbMessage').value });
      e.target.reset(); await renderGuestbook(); showToast('Pesan berhasil dikirim!');
    } catch (err) { showToast(err.message, 'error'); } finally { btn.disabled = false; }
  });
});

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

async function renderGallery() {
  if (isRenderingGallery) return;
  isRenderingGallery = true;
  const grid = document.getElementById('galleryGrid');
  grid.querySelectorAll('[data-user-photo]').forEach(el => el.remove());

  try {
    const { data, error } = await supabaseClient.from('photos').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const user = await getCurrentUser();

    const totalPhotos = data.length + 6;
    if (document.getElementById('statPhotos')) document.getElementById('statPhotos').textContent = totalPhotos.toLocaleString('id-ID');

    data.forEach(p => {
      const imgUrl = getPhotoUrl(p.storage_path);
      const isOwner = user && user.id === p.user_id;
      const article = document.createElement('article');
      article.className = 'gallery-card reveal visible';
      article.dataset.cat = p.category;
      article.dataset.userPhoto = p.id;
      article.innerHTML = `
        <div class="gallery-media">
          <span class="gallery-badge">${labelOf(p.category)}</span>
          <img src="${imgUrl}" alt="${escapeHtml(p.title)}">
          ${isOwner ? `<button class="photo-delete-btn" onclick="hapusFoto('${p.id}', '${p.storage_path}')"><i data-lucide="trash-2"></i></button>` : ''}
        </div>
        <div class="gallery-info">
          <div class="gallery-date"><i data-lucide="calendar"></i> ${formatDate(p.photo_date)}</div>
          <h3 class="gallery-title">${escapeHtml(p.title)}</h3>
          <p class="gallery-desc">${escapeHtml(p.description)}</p>
        </div>`;
      grid.appendChild(article);
    });
    if (window.lucide) lucide.createIcons();
    applyFilter(); 
  } catch (err) { console.error('Gagal memuat foto:', err.message); } 
  finally { isRenderingGallery = false; }
}

async function renderGuestbook() {
  const list = document.getElementById('gbList');
  list.innerHTML = '<p>Memuat pesan...</p>';
  try {
    const data = await fetchGuestbook();
    list.innerHTML = '';
    data.forEach(gb => {
      list.innerHTML += `
        <div class="gb-item">
          <div class="gb-head">
            <div class="avatar">${escapeHtml(gb.name.charAt(0).toUpperCase())}</div>
            <div><div class="gb-name">${escapeHtml(gb.name)}</div><div class="gb-date">${formatDateTime(new Date(gb.created_at))}</div></div>
          </div>
          <p class="gb-text">${escapeHtml(gb.message)}</p>
        </div>`;
    });
  } catch (err) { list.innerHTML = '<p>Gagal memuat pesan.</p>'; }
}

async function renderMemoryWall() {
  const wall = document.getElementById('wallGrid');
  wall.innerHTML = '<p>Memuat cerita...</p>';
  
  try {
    const posts = await fetchWallPosts();
    if (document.getElementById('statWall')) document.getElementById('statWall').textContent = (posts ? posts.length : 0).toLocaleString('id-ID');

    if (!posts || posts.length === 0) {
      wall.innerHTML = '<p style="color: var(--text-muted)">Belum ada cerita di Memory Wall. Jadilah yang pertama!</p>';
      return;
    }

    const user = await getCurrentUser();
    wall.innerHTML = '';
    
    posts.forEach(p => {
      const authorName = p.profiles?.full_name || 'Anonim';
      const likesCount = p.wall_likes ? p.wall_likes.length : 0;
      const isOwner = user && user.id === p.user_id;
      
      wall.innerHTML += `
        <article class="wall-card reveal visible">
          
          ${isOwner ? `
          <div class="wall-actions">
            <button class="wall-action-btn" onclick="editWall('${p.id}')" title="Edit Cerita">
              <i data-lucide="edit-2"></i>
            </button>
            <button class="wall-action-btn text-danger" onclick="hapusWall('${p.id}')" title="Hapus Cerita">
              <i data-lucide="trash-2"></i>
            </button>
          </div>` : ''}

          <p class="wall-text" id="wall-text-${p.id}">${escapeHtml(p.content)}</p>
          <div class="wall-author">
            <div class="avatar">${escapeHtml(authorName.charAt(0).toUpperCase())}</div>
            <div class="wall-author-info">
              <div class="wall-author-name">${escapeHtml(authorName)}</div>
              <div class="wall-author-meta">Anggota</div>
            </div>
            <button class="reaction-btn" onclick="toggleLike('${p.id}')">
              <i data-lucide="heart"></i> <span>${likesCount}</span>
            </button>
          </div>
        </article>`;
    });
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error("Error Memory Wall:", err);
    wall.innerHTML = '<p>Gagal memuat Memory Wall. Cek Console (F12).</p>';
  }
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
      await renderMemoryWall();
      showToast('Cerita dihapus.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
};

window.hapusFoto = async (id, path) => {
  if (confirm('Hapus foto ini? Tindakan tidak bisa dibatalkan.')) {
    try {
      await deletePhoto(id, path);
      await renderGallery();
      showToast('Foto dihapus.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
};