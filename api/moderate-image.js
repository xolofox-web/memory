// api/moderate-image.js
// Vercel Serverless Function (Node.js).
// Implementasi sistem analisis gambar Afterclass (lihat dokumen "AFTERCLASS — AI IMAGE
// ANALYSIS SYSTEM"): identifikasi gambar, deteksi konten terlarang kategori A-K,
// pemeriksaan privasi, kualitas gambar, OCR, dan penilaian AMAN / PERLU_REVIEW / DITOLAK.

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

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(part => typeof part.text === 'string' ? part.text : '').join('\n').trim();
}

function parseJsonObject(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first < 0 || last <= first) throw new Error('AI tidak mengembalikan JSON yang valid.');
    return JSON.parse(cleaned.slice(first, last + 1));
  }
}

// Mengubah keputusan AI (bahasa spesifikasi: AMAN / PERLU_REVIEW / DITOLAK) menjadi status
// internal yang dipakai di seluruh pipeline (approved / review / rejected). Nilai yang tidak
// dikenali sengaja jatuh ke 'review', bukan 'approved', supaya tetap diperiksa admin.
function mapDecisionToStatus(decision) {
  const normalized = String(decision || '').trim().toUpperCase();
  if (normalized === 'AMAN' || normalized === 'APPROVE' || normalized === 'APPROVED') return 'approved';
  if (normalized === 'DITOLAK' || normalized === 'REJECT' || normalized === 'REJECTED') return 'rejected';
  return 'review';
}

function field(value, fallback = 'Tidak dapat dipastikan.') {
  return (typeof value === 'string' && value.trim()) ? value.trim() : fallback;
}

// Menyusun laporan sesuai format pada bagian 10 spesifikasi: Informasi Gambar,
// Hasil Moderasi, Pemeriksaan Tambahan.
function makeReport(ai) {
  const sections = [
    ['INFORMASI GAMBAR', [
      ['Jenis gambar', field(ai.image_type)],
      ['Deskripsi visual', field(ai.description)],
      ['Objek utama', field(ai.main_objects)],
      ['Perkiraan jumlah orang', field(ai.person_count)],
      ['Aktivitas', field(ai.activities)],
      ['Lingkungan/Lokasi', field(ai.location)],
      ['Kondisi & situasi', field(ai.condition)],
      ['Objek pendukung', field(ai.supporting_objects)],
      ['Teks terdeteksi', field(ai.detected_text, 'Tidak ada teks.')],
      ['Konteks', field(ai.context)],
    ]],
    ['HASIL MODERASI', [
      ['Status kelayakan', field(ai.decision, 'Tidak diketahui')],
      ['Kategori pelanggaran', field(ai.violation_categories, 'Tidak ditemukan')],
      ['Tingkat risiko', field(ai.risk_level, 'Tidak diketahui')],
      ['Tingkat keyakinan', field(ai.confidence_level, 'Tidak diketahui')],
      ['Alasan keputusan', field(ai.reason, 'Tidak ada alasan spesifik.')],
    ]],
    ['PEMERIKSAAN TAMBAHAN', [
      ['Pemeriksaan privasi', field(ai.privacy_check)],
      ['Deteksi teks (OCR)', field(ai.text_check)],
      ['Pemeriksaan konten sensitif', field(ai.sensitive_content_check)],
      ['Pemeriksaan kualitas gambar', field(ai.quality_check)],
      ['Catatan tambahan', field(ai.additional_notes, 'Tidak ada.')],
    ]],
  ];

  return sections
    .map(([title, rows]) => `=== ${title} ===\n` + rows.map(([label, value]) => `${label}: ${value}`).join('\n'))
    .join('\n\n');
}

async function checkSightengine(buffer, mimeType) {
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mimeType }), 'upload');
  form.append('models', 'nudity-2.0,gore-2.0,wad,offensive,scam,text,properties');
  form.append('api_user', process.env.MODERATION_API_USER);
  form.append('api_secret', process.env.MODERATION_API_SECRET);

  const response = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.status !== 'success') throw new Error('Pemeriksaan visual eksternal gagal.');

  const nudity = data.nudity || {};

  // Filter cepat sebelum analisis kontekstual Gemini. Karena platform ini dipakai siswa,
  // threshold untuk ketelanjangan/pose sugestif sengaja dibuat sangat ketat.
  if (
    hasScoreAbove(nudity.sexual_activity, 0.10) ||
    hasScoreAbove(nudity.sexual_display, 0.10) ||
    hasScoreAbove(nudity.erotica, 0.10) ||
    hasScoreAbove(nudity.exposed_genitals, 0.05) ||
    hasScoreAbove(nudity.exposed_breasts, 0.05) ||
    hasScoreAbove(nudity.exposed_buttocks, 0.05) ||
    hasScoreAbove(nudity.very_suggestive, 0.10) ||
    hasScoreAbove(nudity.suggestive, 0.40)
  ) {
    return { status: 'rejected', reason: 'Terdeteksi konten seksual, ketelanjangan, atau pose/pakaian yang tidak pantas untuk lingkungan sekolah.' };
  }

  const issues = [];
  if (hasScoreAbove(data.gore?.prob, 0.30)) return { status: 'rejected', reason: 'Terdeteksi kekerasan ekstrem atau gore.' };
  if (hasScoreAbove(data.weapon?.prob, 0.60) || hasScoreAbove(data.drugs?.prob, 0.60) || hasScoreAbove(data.alcohol?.prob, 0.70)) issues.push('Terdapat objek berbahaya/terlarang.');
  if (hasScoreAbove(data.offensive?.prob, 0.40) || hasScoreAbove(data.offensive?.nazi, 0.20)) issues.push('Terdapat indikasi konten ofensif/SARA.');
  if (hasScoreAbove(data.scam?.prob, 0.50)) issues.push('Terdapat indikasi penipuan/spam.');

  const recognizedText = Array.isArray(data.text) ? data.text.map(item => String(item?.text || '')).join(' ') : '';
  const phonePattern = /(?:\+62|62|0)8[1-9][0-9]{6,11}/;
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  if (phonePattern.test(recognizedText) || emailPattern.test(recognizedText)) issues.push('Terdapat data pribadi (No HP/Email).');

  return issues.length ? { status: 'review', reason: issues.join(' ') } : { status: 'approved', reason: '' };
}

async function analyzeWithGemini(buffer, mimeType) {
  const models = [process.env.GEMINI_MODEL || 'gemini-3.8-flash', 'gemini-3.5-flash'];
  const base64 = buffer.toString('base64');

  const prompt = `
Anda adalah sistem AI analisis dan moderasi gambar untuk Afterclass, platform dokumentasi dan
kenangan sekolah (tempat menyimpan momen, kegiatan, dan pengalaman bersama teman, guru, dan
lingkungan sekolah).

TUJUAN
Periksa, identifikasi, dan analisis gambar secara menyeluruh, objektif, dan akurat sebelum
dipublikasikan. Jangan mengambil keputusan hanya berdasarkan satu objek atau bagian kecil gambar.
Jangan mengarang informasi yang tidak dapat dipastikan dari tampilan gambar.

KONTEN YANG DIPERBOLEHKAN (jangan ditolak hanya karena ini)
Dokumentasi sekolah yang wajar: foto bersama teman/sahabat/satu angkatan, kegiatan belajar
mengajar, upacara, lomba, ekstrakurikuler, organisasi, perpisahan/wisuda/kelulusan, study tour,
foto guru/staf, fasilitas sekolah, hasil karya/tugas/proyek, olahraga (termasuk kontak fisik yang
wajar), seni/musik/pentas (termasuk kostum pertunjukan yang pantas), praktikum laboratorium,
perkemahan, momen lucu/berkesan, poster/ilustrasi/desain kreatif terkait sekolah.
Jangan menolak foto hanya karena: kualitas kamera sederhana, pencahayaan kurang sempurna,
komposisi tidak profesional, banyak orang dalam frame, ekspresi wajah beragam, atau aktivitas
fisik yang normal.

KONTEN YANG DILARANG (REJECT jika jelas terbukti; pertimbangkan konteks sebelum memutuskan)
A. Seksual: pornografi, ketelanjangan eksplisit, aktivitas/eksploitasi/pelecehan seksual, konten
   seksual anak di bawah umur, pakaian/pose sangat terbuka atau sugestif yang tidak pantas untuk
   lingkungan sekolah.
B. Kekerasan: pembunuhan, penyiksaan, mutilasi, darah/luka ekstrem, kekerasan fisik nyata,
   ancaman, tindakan menyakiti diri sendiri.
C. Narkotika/zat terlarang: penggunaan, transaksi, atau promosi narkoba/zat berbahaya.
D. Senjata/bahan berbahaya: senjata api/tajam atau bahan peledak dalam konteks ancaman/kriminal
   (bukan sekadar properti, kostum, atau alat praktikum yang wajar).
E. SARA & diskriminasi: rasisme, penghinaan agama/suku, simbol kebencian, propaganda
   diskriminatif.
F. Bullying/pelecehan: perundungan, penghinaan, intimidasi, penyebaran foto untuk mempermalukan
   seseorang.
G. Aktivitas ilegal/kriminal: penipuan, pemerasan, pencurian, pemalsuan dokumen, propaganda
   terorisme.
H. Privasi: KTP/kartu identitas/KK, nomor telepon, alamat, kata sandi, atau data sensitif lain
   yang terbaca jelas di gambar.
I. Manipulasi: deepfake atau editan yang jelas ditujukan untuk menipu, melecehkan, atau merusak
   reputasi seseorang.
J. Spam: iklan/promosi tidak berkaitan dengan sekolah, tautan/QR mencurigakan.
K. Hak cipta: penggunaan jelas karya/logo pihak lain tanpa izin sebagai inti dari gambar.

Jangan langsung menolak hanya karena ada senjata, obat-obatan, simbol, atau objek tertentu
terlihat sebagai properti/latar belakang — pertimbangkan konteks dan tujuannya.

PRIVASI
Periksa apakah ada informasi pribadi yang terbaca (dokumen identitas, nomor telepon, alamat,
kata sandi, dsb). JANGAN mencoba mengidentifikasi nama, alamat, akun media sosial, atau identitas
asli seseorang hanya dari wajahnya — cukup laporkan apakah wajah terlihat, tanpa menebak
identitasnya.

KUALITAS GAMBAR
Catat ketajaman, resolusi, pencahayaan, keburaman, kerusakan, orientasi, dan rasio aspek.
Kualitas teknis yang rendah TIDAK BOLEH menjadi alasan penolakan, kecuali gambar benar-benar
rusak/tidak dapat dianalisis sama sekali.

TEKS DALAM GAMBAR (OCR)
Jika ada tulisan, baca dan nilai berdasarkan konteksnya (bukan sekadar kata per kata): apakah
mengandung ujaran kebencian, ancaman, penghinaan, promosi aktivitas ilegal, data pribadi,
penipuan, tautan berbahaya, atau konten seksual.

SISTEM PENILAIAN (decision)
- "AMAN": tidak ditemukan pelanggaran yang terindikasi.
- "PERLU_REVIEW": ada indikasi yang belum pasti dan perlu diperiksa admin (termasuk kasus
  ambigu, resolusi rendah, atau teks promosi kecil).
- "DITOLAK": ditemukan pelanggaran yang jelas sesuai kategori A-K di atas.
Gunakan tingkat keyakinan yang sesuai dengan bukti visual yang benar-benar ada; jangan menyatakan
sesuatu sebagai fakta bila gambar tidak memberi cukup bukti.

ATURAN PENGAMBILAN KEPUTUSAN
Jangan memutuskan berdasarkan dugaan semata. Jangan menolak dokumentasi sekolah yang normal.
Jangan menganggap semua foto yang menampilkan manusia sebagai konten sensitif. Jangan beri status
AMAN jika ada pelanggaran yang jelas. Gunakan PERLU_REVIEW untuk kasus yang meragukan. Alasan
keputusan harus jelas dan mudah dipahami pengguna.

Kembalikan HANYA satu objek JSON valid (tanpa markdown, tanpa teks lain) persis dengan struktur
berikut:
{
  "decision": "AMAN | PERLU_REVIEW | DITOLAK",
  "reason": "alasan singkat & jelas untuk pengguna (sebutkan pelanggaran spesifik jika DITOLAK)",
  "violation_categories": "nama kategori pelanggaran yang relevan (mis. 'Kekerasan, SARA'), atau 'Tidak ditemukan' jika tidak ada",
  "risk_level": "Rendah | Sedang | Tinggi",
  "confidence_level": "Tinggi | Sedang | Rendah",
  "image_type": "jenis gambar (foto asli/ilustrasi/poster/screenshot/edit, dst.)",
  "description": "deskripsi visual singkat",
  "main_objects": "objek utama yang terlihat",
  "person_count": "perkiraan jumlah orang, atau 'Tidak ada orang'",
  "activities": "aktivitas/kegiatan yang terlihat",
  "location": "lingkungan/lokasi yang terlihat",
  "condition": "kondisi & situasi umum dalam gambar",
  "supporting_objects": "objek pendukung yang relevan",
  "detected_text": "teks yang terbaca di gambar, atau 'Tidak ada teks'",
  "context": "konteks umum keseluruhan gambar",
  "privacy_check": "temuan privasi (data pribadi/dokumen identitas terbaca atau tidak)",
  "text_check": "hasil analisis teks terdeteksi (aman/berisiko dan alasannya)",
  "sensitive_content_check": "ringkasan pemeriksaan konten sensitif",
  "quality_check": "ringkasan kualitas teknis gambar",
  "additional_notes": "catatan tambahan yang relevan, jika ada"
}`;

  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 3072, responseMimeType: 'application/json' }
  });

  let lastError = null;

  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody
      });

      const responseText = await response.text();
      let payload = null;
      try { payload = responseText ? JSON.parse(responseText) : null; } catch { payload = null; }

      if (!response.ok) {
        const upstreamMessage = payload?.error?.message || 'Server sibuk.';
        lastError = new Error(`HTTP ${response.status}: ${upstreamMessage}`);
        continue; // Coba model fallback berikutnya
      }

      if (!payload) throw new Error('Respons JSON tidak valid.');
      const rawText = extractGeminiText(payload);
      if (!rawText) throw new Error('Tidak ada teks analisis.');

      const ai = parseJsonObject(rawText);
      const status = mapDecisionToStatus(ai.decision);

      return {
        status,
        reason: (typeof ai.reason === 'string' && ai.reason.trim()) ? ai.reason.trim() : 'Perlu pemeriksaan.',
        report: makeReport(ai),
        riskLevel: typeof ai.risk_level === 'string' ? ai.risk_level : 'Tidak diketahui',
        confidenceLevel: typeof ai.confidence_level === 'string' ? ai.confidence_level : 'Tidak diketahui',
        violationCategories: typeof ai.violation_categories === 'string' ? ai.violation_categories : 'Tidak ditemukan',
      };
    } catch (error) { lastError = error; }
  }
  throw new Error(`Semua model AI gagal. ${lastError?.message || ''}`);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!process.env.MODERATION_API_USER || !process.env.MODERATION_API_SECRET || !process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Konfigurasi server belum lengkap.' });
  }

  try {
    const { imageBase64, mimeType } = req.body || {};
    if (typeof imageBase64 !== 'string' || imageBase64.length === 0 || imageBase64.length > MAX_BASE64_LENGTH || !ALLOWED_MIME_TYPES.has(mimeType)) {
      return res.status(400).json({ error: 'File tidak valid atau terlalu besar.' });
    }

    const buffer = Buffer.from(imageBase64, 'base64');
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Ukuran maksimal 3 MB.' });

    // 1. Cek Sightengine (Deteksi Visual Cepat)
    const sightengine = await checkSightengine(buffer, mimeType);
    if (sightengine.status === 'rejected') {
      return res.status(200).json({
        status: 'rejected',
        reason: sightengine.reason,
        report: `=== HASIL MODERASI ===\nStatus kelayakan: DITOLAK (pemeriksaan visual otomatis)\nAlasan keputusan: ${sightengine.reason}`,
      });
    }

    // 2. Cek Gemini (Deteksi Konteks & AI, mengikuti spesifikasi Afterclass)
    let gemini;
    try {
      gemini = await analyzeWithGemini(buffer, mimeType);
    } catch (aiError) {
      // FAIL-CLOSED: JIKA AI ERROR/MATI, TOLAK! JANGAN DILOLOSKAN KE REVIEW.
      console.warn('Gemini gagal, menolak unggahan:', aiError.message);
      return res.status(503).json({
        error: 'Sistem pemeriksaan AI sedang sibuk. Demi keamanan platform, foto Anda tidak diunggah. Silakan coba beberapa saat lagi.'
      });
    }

    if (gemini.status === 'rejected') return res.status(200).json(gemini);

    if (sightengine.status === 'review' || gemini.status === 'review') {
      const reasons = [sightengine.reason, gemini.reason].filter(Boolean);
      return res.status(200).json({
        ...gemini,
        status: 'review',
        reason: reasons.join(' ') || 'Memerlukan pemeriksaan admin.',
      });
    }

    return res.status(200).json({ ...gemini, status: 'approved', reason: '' });
  } catch (error) {
    console.error('Moderation failed:', error);
    // Jika error internal, tolak unggahan.
    return res.status(503).json({ error: 'Pemeriksaan gambar gagal. Foto tidak diunggah.' });
  }
};
