// js/gallery.js
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * Menambahkan foto yang baru di-upload ke dalam DOM (HTML) 
 * sesuai dengan kategori yang dipilih.
 */
function appendPhotoToDOM(photo) {
  // Mapping kategori dari database ke ID Grid dan Nama Tampilan di HTML
  const gridMap = {
    'angkatan': { id: 'galleryGridAngkatan', name: 'Foto Angkatan' },
    'kegiatan': { id: 'galleryGridKegiatan', name: 'Kegiatan Khusus' },
    'kebersamaan': { id: 'galleryGridKebersamaan', name: 'Kebersamaan' },
    'kelas': { id: 'galleryGridKelas', name: 'Dokumentasi Kelas' }
  };

  // Cari target grid berdasarkan kategori. Jika tidak ada, fallback ke kegiatan.
  const target = gridMap[photo.category] || gridMap['kegiatan']; 
  const grid = document.getElementById(target.id);
  
  if (!grid) return; // Jika grid tidak ditemukan di halaman, hentikan proses

  const url = getPhotoUrl(photo.storage_path);
  
  // Mengambil nama kegiatan dari judul (teks sebelum tanda '-')
  const kegiatanName = photo.title.includes(' - ') ? photo.title.split(' - ')[0] : photo.title;

  // Membuat HTML card baru yang sesuai dengan struktur CSS Minimalis
  const cardHTML = `
    <article class="gallery-card reveal" data-cat="${photo.category}">
      <div class="gallery-media">
        <img src="${url}" alt="${photo.title}" onclick="openLightbox(this.src)">
      </div>
      <div class="gallery-info">
        <div class="photo-category">${target.name}</div>
        <h3 class="gallery-title">${photo.title}</h3>
        <div class="gallery-meta">Kegiatan: ${kegiatanName}</div>
        <p class="gallery-desc">${photo.description || 'Tidak ada deskripsi.'}</p>
      </div>
    </article>
  `;

  // Tambahkan ke bagian paling atas grid agar foto terbaru langsung terlihat
  grid.insertAdjacentHTML('afterbegin', cardHTML);
  
  // Inisialisasi ulang ikon Lucide jika ada
  if (typeof lucide !== 'undefined') lucide.createIcons();
  
  // Update angka statistik foto di bagian atas halaman
  const statPhotos = document.getElementById('statPhotos');
  if (statPhotos) {
    statPhotos.innerText = parseInt(statPhotos.innerText || 0) + 1;
  }
}

/**
 * Fungsi utama untuk mengunggah foto ke Supabase
 */
async function addPhoto({ file, title, category, description, date }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Silakan login dulu.');

  if (!(file instanceof File)) throw new Error('File foto tidak valid.');

  let preparedFile;
  try {
    preparedFile = await prepareImageForUpload(file);
  } catch (err) {
    throw new Error('Gagal memproses file. Pastikan foto tersimpan di memori HP dan coba pilih ulang.');
  }

  if (typeof showToast === 'function') showToast('Mengunggah foto...', '');

  const extension = getSafeImageExtension(preparedFile.type);
  const fileName = `${user.id}/${crypto.randomUUID()}.${extension}`;

  // 1. Upload ke Supabase Storage
  const { error: uploadError } = await supabaseClient.storage
    .from('photos')
    .upload(fileName, preparedFile, { cacheControl: '3600', upsert: false, contentType: preparedFile.type });

  if (uploadError) throw uploadError;

  // 2. Simpan ke Database
  try {
    const { data, error } = await supabaseClient
      .from('photos')
      .insert({
        user_id: user.id,
        title,
        category,
        description,
        photo_date: date,
        storage_path: fileName,
        analysis_report: 'Sistem AI dinonaktifkan. Foto langsung disetujui.',
        moderation_status: 'approved' // Langsung approved tanpa AI
      })
      .select()
      .single();

    if (error) throw error;

    // 3. TAMPILKAN FOTO BARU KE DALAM HTML SECARA OTOMATIS
    appendPhotoToDOM(data);

    return data;
  } catch (error) {
    // Hapus file dari storage jika gagal menyimpan ke database
    await supabaseClient.storage.from('photos').remove([fileName]);
    throw error;
  }
}

/**
 * (Opsional) Mengambil semua foto dari database dan menampilkannya ke halaman.
 * Berguna jika Anda ingin website sepenuhnya dinamis (menggantikan foto statis di HTML).
 */
async function loadAllPhotos() {
  const { data, error } = await supabaseClient
    .from('photos')
    .select('*')
    .eq('moderation_status', 'approved')
    .order('photo_date', { ascending: false }); // Urutkan dari yang terbaru

  if (error) {
    console.error('Gagal memuat foto:', error);
    return;
  }

  if (data && data.length > 0) {
    // Kosongkan grid statis (jika Anda ingin 100% data dari DB)
    // ['galleryGridAngkatan', 'galleryGridKegiatan', 'galleryGridKebersamaan', 'galleryGridKelas'].forEach(id => {
    //   const el = document.getElementById(id);
    //   if (el) el.innerHTML = '';
    // });

    // Render dari foto terlama ke terbaru agar saat dimasukkan ke 'afterbegin', urutannya benar
    const reversedData = [...data].reverse();
    reversedData.forEach(photo => {
      appendPhotoToDOM(photo);
    });
  }
}

// Panggil loadAllPhotos() saat halaman dimuat (Buka komentar di bawah jika ingin data 100% dari DB)
// document.addEventListener('DOMContentLoaded', loadAllPhotos);

// ==========================================
// FUNGSI PENDUKUNG (Kompresi & Hapus)
// ==========================================

async function prepareImageForUpload(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) throw new Error('Format harus JPG, PNG, atau WEBP.');
  if (file.size <= MAX_IMAGE_BYTES) return file;

  let imageUrl;
  try {
    imageUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = imageUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Foto tidak dapat dibaca.'));
    });

    const maxDimension = 2400;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Browser tidak mendukung.');

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('Foto gagal dikompres.');
    
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }
}

function getSafeImageExtension(mimeType) {
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const extension = extensions[mimeType];
  if (!extension) throw new Error('Format foto tidak didukung.');
  return extension;
}

function getPhotoUrl(storagePath) {
  const { data } = supabaseClient.storage.from('photos').getPublicUrl(storagePath);
  return data.publicUrl;
}

async function deletePhoto(id, storagePath) {
  const { error: storageError } = await supabaseClient.storage.from('photos').remove([storagePath]);
  if (storageError) throw storageError;
  const { error } = await supabaseClient.from('photos').delete().eq('id', id);
  if (error) throw error;
}