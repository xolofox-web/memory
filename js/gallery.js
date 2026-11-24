// js/gallery.js

// ============================================================
// KONFIGURASI API (SIGHTENGINE & GEMINI AI)
// ============================================================
const MODERATION_API_USER = '667285265';
const MODERATION_API_SECRET = '6DYV2E7skykpjgNmSXt5vjhngvLoLaKw';

// PENTING: Dapatkan API Key Gemini gratis di https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = 'AQ.Ab8RN6LWKz4oNGc5FR4MXeoRmh_VLIhpMjzrRRZg1UXpD8O8NA'; 

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
  'transfer', 'rekening', 'bayar', 'ovo', 'gopay', 'dana', 'qris', 'bit.ly',
  'zyxell', 'capcut', 'alight'
];

async function addPhoto({ file, title, category, description, date }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Silakan login dulu.');

  // --- LANGKAH 1: CEK KEPATUHAN DASAR (SIGHTENGINE) ---
  if (typeof showToast === 'function') showToast('Memeriksa keamanan foto...', '');
  const safetyCheck = await checkImageSafety(file);
  if (!safetyCheck.safe) {
    throw new Error(safetyCheck.reason);
  }

  // --- LANGKAH 2: ANALISIS MENDALAM (GEMINI AI) ---
  if (typeof showToast === 'function') showToast('Menganalisis konteks gambar (AI)...', '');
  const geminiResult = await analyzeImageWithGemini(file);
  
  // Jika Gemini menilai foto ini melanggar konteks sekolah
  if (geminiResult.status === 'rejected') {
    throw new Error(`Foto ditolak oleh AI: ${geminiResult.reason}`);
  }

  // --- LANGKAH 3: UPLOAD KE SUPABASE STORAGE ---
  const fileExt = file.name.split('.').pop();
  const fileName = `${user.id}/${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabaseClient.storage
    .from('photos')
    .upload(fileName, file, { cacheControl: '3600', upsert: false });
  if (uploadError) throw uploadError;

  // --- LANGKAH 4: SIMPAN METADATA & LAPORAN KE DATABASE ---
  const { data, error } = await supabaseClient
    .from('photos')
    .insert({
      user_id: user.id,
      title,
      category,
      description,
      photo_date: date,
      storage_path: fileName,
      analysis_report: geminiResult.report, // Menyimpan laporan teks panjang
      moderation_status: geminiResult.status // 'approved' atau 'review'
    })
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

// ============================================================
// FUNGSI ANALISIS MENDALAM (GEMINI AI)
// ============================================================
async function analyzeImageWithGemini(file) {
  if (GEMINI_API_KEY === 'GANTI_DENGAN_API_KEY_GEMINI_ANDA') {
    console.warn('Peringatan: API Key Gemini belum diisi. Analisis mendalam dilewati.');
    return { status: 'approved', reason: '', report: 'Analisis AI dilewati (API Key kosong).' };
  }

  try {
    // Konversi gambar ke Base64
    const reader = new FileReader();
    const base64Promise = new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const base64Data = await base64Promise;

    // PROMPT SESUAI PERMINTAAN ANDA
    const promptText = `
      AFTERCLASS — IMAGE ANALYSIS
      Lakukan analisis mendalam terhadap gambar yang diunggah pengguna. Periksa seluruh elemen visual secara objektif, detail, dan menyeluruh.

      Aspek yang harus dianalisis:
      1. Identifikasi Gambar (Jenis, objek utama, jumlah orang, lingkungan, aktivitas)
      2. Analisis Visual (Pencahayaan, ketajaman, komposisi, detail mencurigakan)
      3. Analisis Konten (Unsur seksual, kekerasan, narkoba, senjata, SARA, bullying, ilegal, vulgar, deepfake, spam)
      4. Analisis Privasi (Dokumen, nomor telepon, alamat, info pribadi, data sensitif)
      5. Analisis Teks (Identifikasi seluruh tulisan, periksa kata/simbol, konteks teks)
      6. Analisis Konteks (Hubungan dengan kegiatan sekolah, tujuan foto)

      FORMAT HASIL ANALISIS (Wajib ikuti format ini):
      - Jenis gambar: 
      - Deskripsi gambar: 
      - Objek utama: 
      - Aktivitas: 
      - Konteks: 
      - Analisis visual: 
      - Analisis konten: 
      - Analisis privasi: 
      - Hasil OCR: 
      - Temuan penting: 
      - Tingkat keyakinan analisis: 

      INSTRUKSI UTAMA:
      Analisis berdasarkan bukti visual. Jangan mengarang. Jika tidak jelas, nyatakan tidak dapat dipastikan.
      Jangan langsung memberikan keputusan menerima atau menolak. Berikan laporan objektif.
      
      DI BAGIAN PALING BAWAH LAPORAN, tambahkan baris ini:
      STATUS_AI: [TULIS "REJECT" JIKA ADA UNSUR PORNOGRAFI/VULGAR/JUDI/KEKERASAN/SARA/PROMOSI/SPAM. TULIS "APPROVE" JIKA AMAN UNTUK LINGKUNGAN SEKOLAH]
      REASON_AI: [Alasan singkat jika REJECT]
    `;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptText },
            { inline_data: { mime_type: file.type, data: base64Data } }
          ]
        }]
      })
    });

    const result = await response.json();
    
    // Error handling jika Gemini gagal merespons
    if (!result.candidates || !result.candidates[0].content) {
      throw new Error("Format respons Gemini tidak valid.");
    }

    const textResponse = result.candidates[0].content.parts[0].text;
    console.log("=== LAPORAN ANALISIS GEMINI ===");
    console.log(textResponse);

    // Parsing Status dari Laporan Gemini
    let status = 'approved';
    let reason = '';
    
    if (textResponse.includes('STATUS_AI: REJECT')) {
      status = 'rejected';
      const matchReason = textResponse.match(/REASON_AI: (.*)/);
      reason = matchReason ? matchReason[1].trim() : 'Melanggar aturan komunitas sekolah.';
    }

    return { status, reason, report: textResponse };

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    // Jika API error, kita kembalikan status review (bisa diubah jadi rejected jika ingin ketat)
    return { status: 'review', reason: 'Sistem analisis sedang sibuk.', report: 'Gagal menganalisis konteks gambar.' };
  }
}

// ============================================================
// FUNGSI MODERASI CEPAT (SIGHTENGINE API)
// ============================================================
async function checkImageSafety(file) {
  try {
    const formData = new FormData();
    formData.append('media', file);
    formData.append('models', 'nudity-2.0,gore-2.0,wad,offensive,scam,text,properties');
    formData.append('api_user', MODERATION_API_USER);
    formData.append('api_secret', MODERATION_API_SECRET);

    const response = await fetch('https://api.sightengine.com/1.0/check.json', {
      method: 'POST', body: formData
    });
    
    const data = await response.json();

    if (data.status === 'failure') {
      return { safe: false, reason: 'Sistem moderasi sedang gangguan. Coba lagi nanti.' };
    }

    // --- PEMERIKSAAN VISUAL (SANGAT KETAT) ---
    
    // 1. Pornografi / Vulgar (Threshold 0.2)
    if (data.nudity.sexual_activity > 0.2 || data.nudity.sexual_display > 0.2 || data.nudity.erotica > 0.2) {
      return { safe: false, reason: 'Foto ditolak: Terdeteksi unsur pornografi atau pakaian tidak senonoh.' };
    }

    // 2. Kekerasan / Gore
    if (data.gore && data.gore.prob > 0.4) {
      return { safe: false, reason: 'Foto ditolak: Mengandung kekerasan ekstrem atau darah.' };
    }

    // 3. Senjata / Narkoba / Miras
    if (data.weapon > 0.4 || data.alcohol > 0.4 || data.drugs > 0.4) {
      return { safe: false, reason: 'Foto ditolak: Mengandung senjata, narkoba, atau miras.' };
    }

    // 4. SARA / Ofensif
    if (data.offensive && (data.offensive.prob > 0.3 || data.offensive.nazi > 0.3)) {
      return { safe: false, reason: 'Foto ditolak: Mengandung unsur SARA atau simbol terlarang.' };
    }

    // 5. Spam / Iklan (Sangat Sensitif)
    if (data.scam && data.scam.prob > 0.1) {
       return { safe: false, reason: 'Foto ditolak: Terdeteksi sebagai banner iklan atau promosi.' };
    }

    // --- PEMERIKSAAN TEKS (OCR) ---
    if (data.text && data.text.length > 0) {
      // A. Kepadatan Teks (Banner)
      if (data.properties && data.properties.width && data.properties.height) {
        let totalTextArea = 0;
        data.text.forEach(t => { totalTextArea += (t.x2 - t.x1) * (t.y2 - t.y1); });
        const imageArea = data.properties.width * data.properties.height;
        if ((totalTextArea / imageArea) > 0.3) {
          return { safe: false, reason: 'Foto ditolak: Terdeteksi sebagai poster/banner berisi banyak teks.' };
        }
      }

      // B. Kata Terlarang
      const detectedText = data.text.map(t => t.text.toLowerCase()).join(' ');
      for (const word of BANNED_WORDS) {
        const regex = new RegExp(`\\b${word}\\b`, 'i'); 
        if (regex.test(detectedText)) {
          return { safe: false, reason: `Foto ditolak: Terdapat teks promosi/iklan ("${word}").` };
        }
      }

      // C. Data Pribadi (PII)
      const phoneRegex = /(\+62|62|0)8[1-9][0-9]{6,9}/g;
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      if (phoneRegex.test(detectedText) || emailRegex.test(detectedText)) {
        return { safe: false, reason: 'Foto ditolak: Mengandung data pribadi (Nomor HP/Email).' };
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