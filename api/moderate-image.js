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

  // Filter ketat konten seksual
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

  // Filter kekerasan ekstrem
  if (hasScoreAbove(data.gore?.prob, 0.40)) {
    return { status: 'rejected', reason: 'Terdeteksi kekerasan ekstrem atau gore.' };
  }

  return { status: 'approved' };
}

// 2. ANALISIS SOP (OpenAI GPT-4o-mini Vision)
async function analyzeWithOpenAI(buffer, mimeType) {
  const base64Image = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  // Prompt Raksasa Sesuai SOP Afterclass
  const systemPrompt = `
Anda adalah sistem AI analisis dan moderasi gambar untuk Afterclass (platform kenangan sekolah).
Tugas Anda: Periksa, identifikasi, dan analisis gambar secara menyeluruh, objektif, dan akurat.

[ATURAN KONTEN YANG DIPERBOLEHKAN]
1. Foto bersama teman, kelas, angkatan.
2. Kegiatan belajar, upacara, lomba, ekstrakurikuler.
3. Wisuda, perpisahan, study tour.
4. Foto guru/staf, fasilitas sekolah.
5. Hasil karya, olahraga, seni, momen lucu (selama sopan).
Jangan tolak foto hanya karena kualitas kamera sederhana, pencahayaan kurang, atau komposisi kurang profesional.

[ATURAN KONTEN TERLARANG - KATEGORI A-K]
A. Seksual: Pornografi, ketelanjangan, pose sugestif tidak pantas.
B. Kekerasan: Darah, luka ekstrem, pembunuhan, menyakiti diri.
C. Narkoba: Penggunaan/transaksi zat terlarang.
D. Senjata: Senjata api/tajam dalam konteks ancaman/kriminal (properti/praktikum aman).
E. SARA: Rasisme, penghinaan agama, simbol kebencian.
F. Bullying: Perundungan, intimidasi, mempermalukan orang.
G. Kriminal: Penipuan, pemerasan, pencurian.
H. Privasi: KTP, KK, No HP, alamat, data sensitif terbaca jelas.
I. Manipulasi: Deepfake, editan untuk menipu/melecehkan.
J. Spam: Iklan, QR code mencurigakan.
K. Hak Cipta: Penggunaan logo/karya orang lain tanpa izin sebagai inti gambar.

[PEMERIKSAAN TAMBAHAN]
- Privasi: Periksa teks/data pribadi. JANGAN identifikasi wajah/nama asli.
- Kualitas: Catat ketajaman, pencahayaan (jangan tolak jika hanya buram biasa).
- OCR: Baca teks. Apakah ada ujaran kebencian, data pribadi, atau spam?
- Konteks Sekolah: Pakaian olahraga, pentas seni, atau pose lucu wajar diperbolehkan.

[SISTEM PENILAIAN]
- "AMAN": Tidak ada pelanggaran.
- "PERLU_REVIEW": Ada indikasi ambigu/meragukan.
- "DITOLAK": Jelas melanggar aturan A-K.

Kembalikan HANYA format JSON valid berikut (tanpa markdown):
{
  "decision": "AMAN | PERLU_REVIEW | DITOLAK",
  "reason": "Alasan singkat untuk user (jika ditolak, sebutkan kategorinya)",
  "image_type": "Foto asli/Ilustrasi/Poster/dll",
  "description": "Deskripsi visual singkat",
  "main_objects": "Objek utama",
  "person_count": "Perkiraan jumlah orang atau 'Tidak ada'",
  "activities": "Aktivitas yang terlihat",
  "location": "Lingkungan/lokasi",
  "context": "Konteks keseluruhan",
  "privacy_check": "Temuan privasi atau 'Aman'",
  "text_check": "Hasil baca teks/OCR atau 'Tidak ada teks'",
  "quality_check": "Ringkasan kualitas gambar"
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Model Vision yang pintar & murah
        response_format: { type: "json_object" }, // Paksa output JSON
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: [
              { type: "text", text: "Analisis gambar ini sesuai SOP." },
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

    // Terjemahkan keputusan AI ke sistem Afterclass
    let status = 'review';
    if (aiResult.decision === 'AMAN') status = 'approved';
    if (aiResult.decision === 'DITOLAK') status = 'rejected';

    // Susun Laporan Rapi Sesuai SOP (Bagian 10)
    const report = `
=== INFORMASI GAMBAR ===
Jenis Gambar: ${aiResult.image_type || '-'}
Deskripsi: ${aiResult.description || '-'}
Objek Utama: ${aiResult.main_objects || '-'}
Jumlah Orang: ${aiResult.person_count || '-'}
Aktivitas: ${aiResult.activities || '-'}
Lokasi: ${aiResult.location || '-'}
Konteks: ${aiResult.context || '-'}

=== HASIL MODERASI ===
Status Kelayakan: ${aiResult.decision}
Alasan: ${aiResult.reason}

=== PEMERIKSAAN TAMBAHAN ===
Privasi: ${aiResult.privacy_check || '-'}
Teks (OCR): ${aiResult.text_check || '-'}
Kualitas: ${aiResult.quality_check || '-'}
    `.trim();

    return {
      status: status,
      reason: aiResult.reason || 'Selesai dianalisis.',
      report: report
    };

  } catch (error) {
    console.warn('OpenAI Vision gagal / sibuk:', error.message);
    // ANTI-STUCK: Jika AI error, jangan tolak! Masukin ke review.
    return {
      status: 'review',
      reason: 'Sistem AI sedang sibuk, foto akan diperiksa manual oleh admin.',
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
        report: `Ditolak oleh pemeriksaan visual otomatis.`
      });
    }

    // 2. Cek pakai OpenAI (Analisis Mendalam & Laporan)
    const openaiCheck = await analyzeWithOpenAI(buffer, mimeType);

    // Kalau OpenAI nolak
    if (openaiCheck.status === 'rejected') {
       return res.status(200).json(openaiCheck);
    }

    // Kalau OpenAI ragu atau sibuk
    if (openaiCheck.status === 'review') {
      return res.status(200).json(openaiCheck);
    }

    // Kalau AMAN
    return res.status(200).json({ 
      status: 'approved', 
      reason: '', 
      report: openaiCheck.report 
    });

  } catch (error) {
    console.error('Moderation failed:', error);
    return res.status(200).json({ status: 'review', reason: 'Gangguan sistem, masuk antrean admin.', report: '-' });
  }
};