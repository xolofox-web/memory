// api/moderate-image.js
// Vercel Serverless Function (Node.js).
// Implementasi sistem analisis gambar Afterclass (Sightengine + OpenAI Vision).

const MAX_BASE64_LENGTH = 4_000_000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function score(value) {
  const candidate = value && typeof value === 'object' ? value.prob : value;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function hasScoreAbove(value, threshold) {
  const parsed = score(value);
  return parsed !== null && parsed >= threshold;
}

// 1. FILTER CEPAT (Sightengine) - Menolak konten parah secara instan
async function checkSightengine(buffer, mimeType) {
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mimeType }), 'upload');
  form.append('models', 'nudity-2.0,gore-2.0,wad,offensive,scam,text,properties');
  form.append('api_user', process.env.MODERATION_API_USER);
  form.append('api_secret', process.env.MODERATION_API_SECRET);

  const response = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form });
  const data = await response.json().catch(() => null);
  
  if (!response.ok || !data || data.status !== 'success') {
    console.warn('Sightengine error, melanjutkan ke AI.');
    return { status: 'skip' }; // Skip, biar OpenAI yang nilai
  }

  const nudity = data.nudity || {};

  // Filter ketat konten seksual (SOP: Pornografi dan Konten Seksual)
  if (
    hasScoreAbove(nudity.sexual_activity, 0.10) ||
    hasScoreAbove(nudity.sexual_display, 0.10) ||
    hasScoreAbove(nudity.erotica, 0.10) ||
    hasScoreAbove(nudity.exposed_genitals, 0.05) ||
    hasScoreAbove(nudity.exposed_breasts, 0.05) ||
    hasScoreAbove(nudity.exposed_buttocks, 0.05)
  ) {
    return { status: 'rejected', reason: 'Terdeteksi konten seksual/ketelanjangan.' };
  }

  // Filter kekerasan ekstrem (SOP: Kekerasan dan Konten Ekstrem)
  if (hasScoreAbove(data.gore?.prob, 0.40)) {
    return { status: 'rejected', reason: 'Terdeteksi kekerasan ekstrem atau gore.' };
  }

  return { status: 'approved' };
}

// 2. ANALISIS SOP (OpenAI GPT-4o-mini Vision)
async function analyzeWithOpenAI(buffer, mimeType) {
  const base64Image = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  // Prompt Raksasa Sesuai SOP Afterclass Terbaru
  const systemPrompt = `
Anda adalah sistem AI analisis dan moderasi gambar otomatis untuk Afterclass (platform dokumentasi kenangan sekolah tingkat SMP).
Tugas Anda: Melakukan analisis mendalam terhadap gambar, objektif, akurat, dan sesuai dengan lingkungan pendidikan, usia siswa, norma kesopanan, keamanan, dan kenyamanan bersama.

[ATURAN KONTEN YANG DIPERBOLEHKAN (APPROVED)]
AI WAJIB mengizinkan foto/gambar yang mengandung unsur positif, edukatif, dokumentatif, kreatif, dan berkaitan dengan kehidupan sekolah:
1. Dokumentasi Sekolah: Ruang kelas, belajar, ujian, diskusi, upacara, OSIS, perpustakaan, lingkungan sekolah.
2. Foto Bersama: Teman sekelas, angkatan, sahabat, guru/staf, perpisahan, dokumentasi kelas.
3. Kegiatan Sekolah: Study tour, Pramuka, ekstrakurikuler, lomba, olahraga, pentas seni, hari nasional, kegiatan sosial.
4. Aktivitas Siswa: Bermain wajar, olahraga, membaca, karya seni, musik, foto bersama normal.
5. Pakaian: Seragam sekolah/olahraga, pakaian sopan, kostum pentas sesuai usia.
6. Gambar Digital: Ilustrasi, poster sekolah, desain angkatan/kelas, karya fotografi, dekorasi.
7. Dokumentasi Umum: Pemandangan, fasilitas sekolah, perjalanan, momen kebersamaan positif.
CATATAN: JANGAN menolak gambar hanya karena resolusi rendah, pencahayaan buruk, kualitas kamera, atau komposisi kurang sempurna. Foto siswa (wajah, tubuh, seragam, olahraga) secara normal TIDAK BOLEH otomatis ditolak.

[ATURAN KONTEN YANG TIDAK DIPERBOLEHKAN (REJECTED)]
AI WAJIB menolak gambar yang mengandung unsur berikut:
A. Pornografi & Seksual: Ketelanjangan, aktivitas/pose seksual, eksploitasi bagian tubuh, ilustrasi seksual anak.
B. Eksploitasi Anak: Segala bentuk eksploitasi/pelecehan seksual anak, manipulasi foto anak untuk tujuan seksual.
C. Kekerasan Ekstrem: Pembunuhan, penyiksaan, mutilasi, gore, perkelahian berat, ajakan kekerasan.
D. Narkoba: Penggunaan/transaksi narkotika, penyalahgunaan obat, promosi zat terlarang.
E. Rokok & Vape: Aktivitas merokok/vape, promosi rokok/nikotin.
F. Bullying & Pelecehan: Foto mempermalukan siswa, penghinaan fisik, perundungan, intimidasi, ancaman.
G. SARA & Ujaran Kebencian: Rasisme, penghinaan agama, diskriminasi, simbol kebencian, propaganda permusuhan.
H. Senjata & Berbahaya: Senjata api/tajam (konteks ancaman), bom, kriminal, vandalisme, ajakan ilegal.
I. Privasi & Data Pribadi: KTP, KK, alamat rumah, no HP, password, dokumen rahasia, data siswa tanpa izin.
J. Penipuan & Manipulasi: Bukti bayar palsu, dokumen palsu, phishing, deepfake pelecehan, instruksi berbahaya.
K. Lainnya: Vulgar, simbol teroris, promosi menyakiti diri, spam/iklan, konten ilegal.

[ANALISIS KONTEKS MENDALAM]
Periksa objek, aktivitas, pakaian, lingkungan, ekspresi, interaksi, tulisan/simbol, unsur seksual/kekerasan, privasi, manipulasi, dan kesesuaian SMP.
Pahami perbedaan dokumentasi normal vs konten pelanggaran. Jangan membuat asumsi tanpa bukti visual.

[SISTEM PENILAIAN - HANYA PILIH SALAH SATU]
- "APPROVED": Gambar aman, tidak melanggar privasi/keamanan, sesuai dokumentasi Afterclass.
- "REJECTED": Gambar terbukti melanggar, berbahaya, ilegal, atau hasil analisis TIDAK CUKUP MEYAKINKAN untuk memastikan keamanan gambar (Fail-Safe).

Kembalikan HANYA format JSON valid berikut (tanpa markdown):
{
  "status": "APPROVED | REJECTED",
  "kategori": "Kategori hasil pemeriksaan (misal: Dokumentasi Sekolah, Pornografi, dll)",
  "deskripsi": "Penjelasan objektif mengenai isi gambar",
  "temuan": "Unsur yang terdeteksi",
  "alasan": "Dasar keputusan (jika ditolak, jelaskan pelanggarannya)",
  "confidence": "Tingkat keyakinan hasil analisis (misal: 95%)"
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" }, // Paksa output JSON
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: [
              { type: "text", text: "Analisis gambar ini sesuai SOP Afterclass. Tentukan APPROVED atau REJECTED." },
              { type: "image_url", image_url: { url: dataUrl } }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 1000
      })
    });

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);

    const data = await response.json();
    const aiResult = JSON.parse(data.choices[0].message.content);

    // Paksa keputusan hanya APPROVED atau REJECTED
    let finalStatus = 'rejected'; // Default ke rejected (Fail-safe)
    if (aiResult.status && aiResult.status.toUpperCase() === 'APPROVED') {
      finalStatus = 'approved';
    }

    // Susun Laporan Rapi Sesuai SOP Bagian 6
    const report = `
=== HASIL ANALISIS GAMBAR ===
Status Kelayakan: ${finalStatus.toUpperCase()}
Kategori: ${aiResult.kategori || '-'}
Deskripsi: ${aiResult.deskripsi || '-'}
Temuan: ${aiResult.temuan || '-'}
Alasan: ${aiResult.alasan || '-'}
Confidence: ${aiResult.confidence || '-'}
    `.trim();

    return {
      status: finalStatus,
      reason: aiResult.alasan || (finalStatus === 'approved' ? 'Selesai dianalisis.' : 'Gambar tidak memenuhi standar keamanan.'),
      report: report
    };

  } catch (error) {
    console.warn('OpenAI Vision gagal / sibuk:', error.message);
    // SOP: Jika AI tidak bisa memastikan/error, otomatis REJECTED.
    return {
      status: 'rejected',
      reason: 'Sistem AI gagal memverifikasi keamanan gambar. Tindakan pencegahan: Ditolak.',
      report: 'Pemeriksaan AI terlewati karena kendala teknis.'
    };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  
  if (!process.env.MODERATION_API_USER || !process.env.MODERATION_API_SECRET || !process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Konfigurasi server belum lengkap.' });
  }

  try {
    const { imageBase64, mimeType } = req.body || {};
    if (typeof imageBase64 !== 'string' || imageBase64.length === 0 || imageBase64.length > MAX_BASE64_LENGTH || !ALLOWED_MIME_TYPES.has(mimeType)) {
      return res.status(400).json({ error: 'File tidak valid atau terlalu besar.' });
    }

    const buffer = Buffer.from(imageBase64, 'base64');
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Ukuran maksimal 3 MB.' });

    // 1. Cek pakai Sightengine (Pemeriksaan Visual Cepat)
    const sightengine = await checkSightengine(buffer, mimeType);
    if (sightengine.status === 'rejected') {
      return res.status(200).json({
        status: 'rejected',
        reason: sightengine.reason,
        report: `=== HASIL ANALISIS GAMBAR ===\nStatus Kelayakan: REJECTED\nAlasan: Ditolak oleh pemeriksaan visual otomatis (Sightengine).`
      });
    }

    // 2. Cek pakai OpenAI (Analisis Mendalam & Laporan)
    const openaiCheck = await analyzeWithOpenAI(buffer, mimeType);

    // Langsung return hasil (APPROVED atau REJECTED)
    return res.status(200).json(openaiCheck);

  } catch (error) {
    console.error('Moderation failed:', error);
    // SOP: Gangguan sistem = REJECTED
    return res.status(200).json({ 
      status: 'rejected', 
      reason: 'Gangguan sistem keamanan. Gambar ditolak secara otomatis.', 
      report: '=== HASIL ANALISIS GAMBAR ===\nStatus Kelayakan: REJECTED\nAlasan: Gangguan sistem internal.' 
    });
  }
};