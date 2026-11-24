// js/admin.js

// 1. Inisialisasi Supabase Client
// Ganti dengan URL dan ANON KEY milikmu
const SUPABASE_URL = 'https://dcjysruwpqhvlzmckmgr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjanlzcnV3cHFodmx6bWNrbWdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNzI1MDAsImV4cCI6MjExMDk0ODUwMH0.8npaV4ksWLEhaImkJgAufCN2SIiTB0-6j-e-d4vGkUU';
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const tableBody = document.querySelector('#photoTable tbody');

/**
 * Mengambil foto dengan status 'review' dan menampilkannya di tabel
 */
async function fetchPendingPhotos() {
  // Ambil data dari tabel 'photos' di mana statusnya 'review'
  const { data: photos, error } = await supabase
    .from('photos')
    .select('id, title, category, storage_path, moderation_status')
    .eq('moderation_status', 'review'); // Filter hanya yang perlu di-review

  if (error) {
    console.error('Gagal mengambil data:', error.message);
    alert('Gagal memuat data foto.');
    return;
  }

  // Kosongkan tabel sebelum mengisi data baru
  tableBody.innerHTML = '';

  if (photos.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="5">Tidak ada foto yang menunggu persetujuan.</td></tr>';
    return;
  }

  // Loop melalui setiap foto dan buat baris tabel
  photos.forEach(photo => {
    // Dapatkan URL publik foto dari storage_path
    const { data: publicUrlData } = supabase
      .storage
      .from('photos')
      .getPublicUrl(photo.storage_path);

    const imageUrl = publicUrlData.publicUrl;

    // Buat elemen baris (tr)
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${imageUrl}" alt="${photo.title}"></td>
      <td>${photo.title}</td>
      <td>${photo.category}</td>
      <td><span class="status-review">${photo.moderation_status}</span></td>
      <td>
        <button class="btn-approve" data-id="${photo.id}">Setujui</button>
      </td>
    `;

    // Tambahkan event listener ke tombol "Setujui"
    const approveButton = row.querySelector('.btn-approve');
    approveButton.addEventListener('click', () => approvePhoto(photo.id));

    tableBody.appendChild(row);
  });
}

/**
 * Mengubah status foto menjadi 'approved' berdasarkan ID
 * @param {string} photoId - ID foto yang akan disetujui
 */
async function approvePhoto(photoId) {
  if (!confirm('Apakah Anda yakin ingin menyetujui foto ini?')) {
    return;
  }

  // Query UPDATE ke Supabase: set status jadi 'approved' di mana id = photoId
  const { error } = await supabase
    .from('photos')
    .update({ moderation_status: 'approved' }) // Ubah statusnya
    .eq('id', photoId); // Berdasarkan ID foto

  if (error) {
    console.error('Gagal menyetujui foto:', error.message);
    alert('Terjadi kesalahan saat menyetujui foto.');
  } else {
    alert('Foto berhasil disetujui!');
    // Muat ulang daftar foto untuk me-refresh tabel
    fetchPendingPhotos();
  }
}

// Panggil fungsi untuk memuat data saat halaman pertama kali dibuka
document.addEventListener('DOMContentLoaded', fetchPendingPhotos);