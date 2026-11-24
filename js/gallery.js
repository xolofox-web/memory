// js/gallery.js

// ============================================================
// KONFIGURASI API MODERASI GAMBAR (SIGHTENGINE)
// ============================================================
const MODERATION_API_USER = '667285265';
const MODERATION_API_SECRET = '6DYV2E7skykpjgNmSXt5vjhngvLoLaKw';

// ============================================================
// DAFTAR UNSUR YANG DITERIMA OLEH SISTEM (WHITELIST)
// ============================================================
const ALLOWED_ELEMENTS = [
  "Foto bersama teman sekelas maupun teman satu angkatan.",
  "Foto kegiatan belajar mengajar di dalam kelas.",
  "Dokumentasi kegiatan sekolah dan acara tertentu.",
  "Foto kegiatan ekstrakurikuler dan organisasi sekolah.",
  "Foto perpisahan, kelulusan, dan wisuda.",
  "Foto kegiatan olahraga, perlombaan, dan pertandingan.",
  "Foto study tour, perjalanan sekolah, dan kunjungan edukasi.",
  "Foto guru, wali kelas, dan staf sekolah dengan izin yang sesuai.",
  "Foto kenangan bersama teman, sahabat, dan kelompok belajar.",
  "Foto kegiatan pentas seni, pertunjukan, dan kreativitas siswa.",
  "Foto hasil karya, tugas, proyek, dan aktivitas pembelajaran.",
  "Foto lingkungan sekolah, ruang kelas, lapangan, dan fasilitas sekolah.",
  "Foto kegiatan sosial, kerja bakti, dan gotong royong.",
  "Foto momen lucu, unik, dan berkesan selama masa sekolah.",
  "Desain poster, ilustrasi, karya digital, dan gambar kreatif buatan sendiri.",
  "Foto dokumentasi pribadi yang pantas dan tidak melanggar privasi.",
  "Gambar atau ilustrasi yang berkaitan dengan pendidikan.",
  "Berbagai dokumentasi positif lainnya yang layak dijadikan kenangan."
];

// KAMUS KATA TERLARANG (Spam, Promosi, Judi, & Penipuan)
const BANNED_WORDS = [
  'promo', 'diskon', 'beli', 'harga', 'rp', 'wa.me', 'http', 'www', 'link', 
  'judi', 'slot', 'gacor', 'maxwin', 'togel', 'casino', 'taruhan', 
  'jual', 'premium', 'murah', 'order', 'klik', 'daftar', 'agen', 'reseller',
  'transfer', 'rekening', 'bayar', 'ovo', 'gopay', 'dana', 'qris', 'bit.ly'
];

async function addPhoto({ file, title, category, description, date }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Silakan login dulu.');

  // --- 1. CEK KEAMANAN GAMBAR (AI MODERATION) ---
  if (typeof showToast === 'function') showToast('Sedang memeriksa keamanan foto...', '');
  
  const checkResult = await checkImageSafety(file);
  if (!checkResult.safe) {
    throw new Error(checkResult.reason); // Menampilkan alasan penolakan
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
    
    // Model AI yang diaktifkan
    formData.append('models', 'nudity-2.0,gore-2.0,wad,offensive,scam,text');
    formData.append('api_user', MODERATION_API_USER);
    formData.append('api_secret', MODERATION_API_SECRET);

    const response = await fetch('https://api.sightengine.com/1.0/check.json', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();

    if (data.status === 'failure') {
      console.error('Moderation API Error:', data.error);
      return { safe: false, reason: 'Sistem moderasi sedang gangguan. Coba lagi nanti.' };
    }

    // --- LOGIKA PENOLAKAN ---
    
    // 1. Pornografi
    if (data.nudity.sexual_activity > 0.5 || data.nudity.sexual_display > 0.5 || data.nudity.erotica > 0.5) {
      return { safe: false, reason: 'Foto ditolak: Mengandung unsur pornografi atau ketelanjangan.' };
    }

    // 2. Kekerasan / Gore
    if (data.gore && data.gore.prob > 0.5) {
      return { safe: false, reason: 'Foto ditolak: Mengandung kekerasan ekstrem, darah, atau gore.' };
    }

    // 3. Narkoba / Senjata / Miras
    if (data.weapon > 0.5 || data.alcohol > 0.5 || data.drugs > 0.5) {
      return { safe: false, reason: 'Foto ditolak: Mengandung senjata, narkoba, atau minuman keras.' };
    }

    // 4. SARA / Ofensif
    if (data.offensive && (data.offensive.prob > 0.4 || data.offensive.nazi > 0.4 || data.offensive.confederate > 0.4)) {
      return { safe: false, reason: 'Foto ditolak: Mengandung unsur SARA, perundungan, atau simbol terlarang.' };
    }

    // 5. Spam / Iklan / Penipuan
    if (data.scam && data.scam.prob > 0.3) {
       return { safe: false, reason: 'Foto ditolak: Terdeteksi sebagai iklan, spam, atau penipuan.' };
    }

    // 6. Baca Teks (Judi/Promosi/Data Pribadi)
    if (data.text && data.text.length > 0) {
      const detectedText = data.text.map(t => t.text.toLowerCase()).join(' ');
      
      for (const word of BANNED_WORDS) {
        if (detectedText.includes(word)) {
          return { safe: false, reason: `Foto ditolak: Terdapat teks promosi/judi ("${word}").` };
        }
      }

      const phoneRegex = /(\+62|62|0)8[1-9][0-9]{6,9}/g;
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      
      if (phoneRegex.test(detectedText) || emailRegex.test(detectedText)) {
        return { safe: false, reason: 'Foto ditolak: Mengandung data pribadi (Nomor HP/Email) tanpa izin.' };
      }
    }

    return { safe: true, reason: '' }; 
  } catch (err) {
    console.error('Error saat moderasi:', err);
    return { safe: false, reason: 'Gagal memverifikasi gambar. Periksa koneksi internet.' };
  }
}

function getPhotoUrl(storagePath) {
  const { data } = supabaseClient.storage.from('photos').getPublicUrl(storagePath);
  return data.publicUrl;
}

async function deletePhoto(id, storagePath) {
  await supabaseClient.storage.from('photos').remove([storagePath]);
  const { error } = await supabaseClient.from('photos').delete().eq('id', id);
  if (error) throw error;
}