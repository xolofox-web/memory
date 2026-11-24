// js/gallery.js

// ============================================================
// KONFIGURASI API MODERASI GAMBAR (SIGHTENGINE)
// Daftar gratis di: https://sightengine.com
// ============================================================
const MODERATION_API_USER = '667285265';
const MODERATION_API_SECRET = '6DYV2E7skykpjgNmSXt5vjhngvLoLaKw';


async function addPhoto({ file, title, category, description, date }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Silakan login dulu.');

  // --- 1. CEK KEAMANAN GAMBAR (AI MODERATION) ---
  // Jika API key belum diganti, lewati moderasi (untuk testing)
  if (MODERATION_API_USER !== 'GANTI_DENGAN_API_USER_SIGHTENGINE') {
    if (typeof showToast === 'function') showToast('Sedang memeriksa keamanan foto...', '');
    
    const isSafe = await checkImageSafety(file);
    if (!isSafe) {
      throw new Error('Foto ditolak! Sistem mendeteksi unsur pornografi, judi, atau promosi terlarang.');
    }
  } else {
    console.warn('Moderasi AI dilewati: Silakan isi API Key Sightengine di gallery.js');
  }

  // --- 2. UPLOAD KE SUPABASE STORAGE ---
  const fileExt = file.name.split('.').pop();
  const fileName = `${user.id}/${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabaseClient.storage
    .from('photos')
    .upload(fileName, file, { cacheControl: '3600', upsert: false });
  if (uploadError) throw uploadError;

  // --- 3. SIMPAN METADATA KE DATABASE ---
  const { data, error } = await supabaseClient
    .from('photos')
    .insert({
      user_id: user.id,
      title,
      category,
      description,
      photo_date: date,
      storage_path: fileName
    })
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

// ============================================================
// FUNGSI MODERASI GAMBAR (SIGHTENGINE API)
// ============================================================
async function checkImageSafety(file) {
  try {
    const formData = new FormData();
    formData.append('media', file);
    // Model AI yang akan digunakan untuk mendeteksi
    // nudity (porno), gambling (judi), offensive (SARA), wad (senjata/narkoba/miras)
    formData.append('models', 'nudity-2.0,gambling,offensive,wad');
    formData.append('api_user', MODERATION_API_USER);
    formData.append('api_secret', MODERATION_API_SECRET);

    const response = await fetch('https://api.sightengine.com/1.0/check.json', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();

    // Jika API gagal merespons atau kuota habis
    if (data.status === 'failure') {
      console.error('Moderation API Error:', data.error);
      return false; // Tolak demi keamanan jika API error
    }

    // --- LOGIKA PENOLAKAN (THRESHOLD 0.5 / 50%) ---
    
    // 1. Cek Porno/Nudity
    if (data.nudity.sexual_activity > 0.5 || data.nudity.sexual_display > 0.5 || data.nudity.erotica > 0.5) {
      console.warn('Ditolak: Unsur Porno');
      return false;
    }

    // 2. Cek Judi (Slot, Kartu, Roulette, Banner)
    if (data.gambling > 0.5) {
      console.warn('Ditolak: Unsur Judi');
      return false;
    }

    // 3. Cek Senjata, Narkoba, Miras
    if (data.weapon > 0.5 || data.alcohol > 0.5 || data.drugs > 0.5) {
      console.warn('Ditolak: Unsur Berbahaya (Senjata/Miras/Narkoba)');
      return false;
    }

    // 4. Cek Ofensif (Simbol terlarang, vulgar)
    if (data.offensive.prob > 0.5) {
      console.warn('Ditolak: Unsur Ofensif');
      return false;
    }

    return true; // Lolos moderasi
  } catch (err) {
    console.error('Error saat moderasi:', err);
    return false; // Tolak jika koneksi error
  }
}

function getPhotoUrl(storagePath) {
  const { data } = supabaseClient.storage.from('photos').getPublicUrl(storagePath);
  return data.publicUrl;
}

async function deletePhoto(id, storagePath) {
  // Hapus dari Storage
  await supabaseClient.storage.from('photos').remove([storagePath]);
  // Hapus dari tabel
  const { error } = await supabaseClient.from('photos').delete().eq('id', id);
  if (error) throw error;
}