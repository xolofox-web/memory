// api/moderate-image.js
// Vercel Serverless Function (Node.js).

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

function makeReport(ai) {
  const fields = [
    ['Jenis gambar', ai.image_type], ['Deskripsi gambar', ai.description],
    ['Objek utama', ai.main_objects], ['Aktivitas', ai.activities],
    ['Konteks', ai.context], ['Analisis visual', ai.visual_analysis],
    ['Analisis konten', ai.content_analysis], ['Analisis privasi', ai.privacy_analysis],
    ['Hasil OCR', ai.ocr_text], ['Temuan penting', ai.findings],
    ['Tingkat keyakinan', ai.confidence]
  ];
  return fields.map(([label, value]) => `${label}: ${value || 'Tidak dapat dipastikan.'}`).join('\n');
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
  
  // DIPERKETAT MAKSIMAL: Deteksi kulit/belahan dada/pose sugestif
  if (
    hasScoreAbove(nudity.sexual_activity, 0.10) ||
    hasScoreAbove(nudity.sexual_display, 0.10) ||
    hasScoreAbove(nudity.erotica, 0.10) ||
    hasScoreAbove(nudity.exposed_genitals, 0.05) ||
    hasScoreAbove(nudity.exposed_breasts, 0.05) || // Sangat sensitif
    hasScoreAbove(nudity.exposed_buttocks, 0.05) ||
    hasScoreAbove(nudity.very_suggestive, 0.10) || // Sangat sensitif
    hasScoreAbove(nudity.suggestive, 0.40)         // Diturunkan drastis
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
  
  // PROMPT BARU: Memasukkan seluruh aturan ketat dari Anda
  const prompt = `
Anda adalah sistem analisis dan moderasi gambar AI untuk Afterclass (Platform Kenangan Sekolah).
Tugas Anda adalah memeriksa gambar dan memberikan keputusan: APPROVE, REVIEW, atau REJECT.

ATURAN KETAT (REJECT JIKA MELANGGAR):
1. Pornografi, ketelanjangan eksplisit, eksploitasi seksual.
2. Konten vulgar, tidak senonoh, pose sugestif, pakaian terlalu terbuka (memperlihatkan belahan dada, perut, atau paha atas secara berlebihan) yang TIDAK PANTAS untuk lingkungan sekolah.
3. Kekerasan ekstrem, darah, gore, mutilasi, perundungan (bullying), ancaman.
4. Narkoba, senjata api, senjata tajam dalam konteks kriminal/ancaman.
5. SARA, rasisme, ujaran kebencian, propaganda terorisme.
6. Deepfake, manipulasi gambar untuk menipu/melecehkan.
7. Penyebaran data pribadi (KTP, alamat, nomor telepon, email).

ATURAN TOLERANSI (APPROVE ATAU REVIEW):
- Foto kegiatan sekolah normal (belajar, olahraga, ekstrakurikuler, study tour, wisuda) HARUS APPROVE selama pakaian wajar dan sopan.
- Jika gambar agak ambigu, resolusi rendah, atau ada teks promosi kecil, pilih REVIEW.
- Jangan menolak foto hanya karena kualitas kamera sederhana.

PENTING: Fokus utama adalah menolak gambar yang tidak pantas (vulgar/seksi) dan melanggar aturan sekolah.

Kembalikan HANYA JSON valid dengan bentuk:
{
  "decision": "APPROVE | REVIEW | REJECT",
  "reason": "alasan singkat dan jelas (jika reject, sebutkan pelanggarannya)",
  "image_type": "jenis gambar",
  "description": "deskripsi visual",
  "main_objects": "objek utama",
  "activities": "aktivitas",
  "context": "konteks",
  "visual_analysis": "analisis visual",
  "content_analysis": "analisis konten & risiko",
  "privacy_analysis": "temuan privasi",
  "ocr_text": "teks terbaca",
  "findings": "temuan penting",
  "confidence": "tinggi, sedang, rendah"
}`;

  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
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
      const decision = String(ai.decision || '').toUpperCase();
      
      return {
        status: decision === 'APPROVE' ? 'approved' : decision === 'REJECT' ? 'rejected' : 'review',
        reason: typeof ai.reason === 'string' ? ai.reason : 'Perlu pemeriksaan.',
        report: makeReport(ai)
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
      return res.status(200).json({ status: 'rejected', reason: sightengine.reason, report: 'Ditolak keamanan visual.' });
    }

    // 2. Cek Gemini (Deteksi Konteks & AI)
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
      return res.status(200).json({ status: 'review', reason: reasons.join(' ') || 'Memerlukan pemeriksaan admin.', report: gemini.report });
    }

    return res.status(200).json({ status: 'approved', reason: '', report: gemini.report });
  } catch (error) {
    console.error('Moderation failed:', error);
    // Jika error internal, tolak unggahan.
    return res.status(503).json({ error: 'Pemeriksaan gambar gagal. Foto tidak diunggah.' });
  }
};