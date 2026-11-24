// api/moderate-image.js
// Vercel Serverless Function (Node.js).
// Set MODERATION_API_USER, MODERATION_API_SECRET, dan GEMINI_API_KEY
// melalui Project Settings > Environment Variables. Jangan commit secret ke Git.

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
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first < 0 || last <= first) throw new Error('AI tidak mengembalikan JSON yang valid.');
    return JSON.parse(cleaned.slice(first, last + 1));
  }
}

function makeReport(ai) {
  const fields = [
    ['Jenis gambar', ai.image_type],
    ['Deskripsi gambar', ai.description],
    ['Objek utama', ai.main_objects],
    ['Aktivitas', ai.activities],
    ['Konteks', ai.context],
    ['Analisis visual', ai.visual_analysis],
    ['Analisis konten', ai.content_analysis],
    ['Analisis privasi', ai.privacy_analysis],
    ['Hasil OCR', ai.ocr_text],
    ['Temuan penting', ai.findings],
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

  const response = await fetch('https://api.sightengine.com/1.0/check.json', {
    method: 'POST',
    body: form
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.status !== 'success') {
    throw new Error('Pemeriksaan visual eksternal gagal.');
  }

  const nudity = data.nudity || {};
  const issues = [];

  // Tolak konten eksplisit. Konten sugestif yang meragukan masuk review.
  if (
    hasScoreAbove(nudity.sexual_activity, 0.20) ||
    hasScoreAbove(nudity.sexual_display, 0.20) ||
    hasScoreAbove(nudity.erotica, 0.20) ||
    hasScoreAbove(nudity.exposed_genitals, 0.10) ||
    hasScoreAbove(nudity.exposed_breasts, 0.20) ||
    hasScoreAbove(nudity.exposed_buttocks, 0.20)
  ) {
    return { status: 'rejected', reason: 'Terdeteksi konten seksual atau ketelanjangan.' };
  }

  if (
    hasScoreAbove(nudity.very_suggestive, 0.35) ||
    hasScoreAbove(nudity.suggestive, 0.65)
  ) {
    issues.push('Konten visual berpotensi sugestif dan perlu ditinjau.');
  }

  if (hasScoreAbove(data.gore?.prob, 0.40)) {
    return { status: 'rejected', reason: 'Terdeteksi kekerasan ekstrem atau gore.' };
  }

  if (
    hasScoreAbove(data.weapon?.prob, 0.75) ||
    hasScoreAbove(data.drugs?.prob, 0.75) ||
    hasScoreAbove(data.alcohol?.prob, 0.85)
  ) {
    issues.push('Terdapat objek yang perlu ditinjau berdasarkan konteks.');
  }

  if (
    hasScoreAbove(data.offensive?.prob, 0.50) ||
    hasScoreAbove(data.offensive?.nazi, 0.30)
  ) {
    issues.push('Terdapat indikasi konten ofensif atau simbol kebencian.');
  }

  if (hasScoreAbove(data.scam?.prob, 0.70)) {
    issues.push('Terdapat indikasi penipuan atau promosi mencurigakan.');
  }

  const recognizedText = Array.isArray(data.text)
    ? data.text.map(item => String(item?.text || '')).join(' ')
    : '';

  const phonePattern = /(?:\+62|62|0)8[1-9][0-9]{6,11}/;
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  if (phonePattern.test(recognizedText) || emailPattern.test(recognizedText)) {
    issues.push('Terdapat nomor telepon atau alamat email yang perlu diperiksa.');
  }

  return issues.length
    ? { status: 'review', reason: issues.join(' ') }
    : { status: 'approved', reason: '' };
}

async function analyzeWithGemini(buffer, mimeType) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const base64 = buffer.toString('base64');

  const prompt = `
Anda adalah sistem analisis dan moderasi gambar untuk Afterclass, platform kenangan sekolah.
Analisis gambar berdasarkan bukti visual, bukan dugaan. Jangan mengidentifikasi orang dari wajah,
jangan menebak umur, identitas, lokasi spesifik, atau hubungan antarorang.

Periksa konteks sekolah, konten seksual/ketelanjangan, unsur sugestif, kekerasan/gore,
narkoba, senjata dalam konteks berbahaya, kebencian, bullying, kriminalitas, privasi,
manipulasi/deepfake, spam, dan teks yang terlihat.

Penting:
- Bedakan dokumentasi sekolah normal dari konten yang benar-benar bermasalah.
- Pakaian terbuka atau pose sugestif harus dinilai secara kontekstual; bila tidak eksplisit
  tetapi berpotensi tidak pantas untuk platform sekolah, pilih REVIEW.
- Konten seksual eksplisit, ketelanjangan eksplisit, eksploitasi seksual, kekerasan ekstrem,
  atau konten berbahaya yang jelas harus REJECT.
- Jika gambar ambigu, tidak jelas, atau tidak cukup bukti, pilih REVIEW, bukan APPROVE.
- Foto biasa yang pantas dan tidak menunjukkan pelanggaran dapat APPROVE.
- Jangan mengarang teks OCR atau detail yang tidak terlihat.

Kembalikan HANYA JSON valid dengan bentuk:
{
  "decision": "APPROVE | REVIEW | REJECT",
  "reason": "alasan singkat",
  "image_type": "jenis gambar",
  "description": "deskripsi visual",
  "main_objects": "objek utama",
  "activities": "aktivitas yang terlihat",
  "context": "konteks yang dapat disimpulkan",
  "visual_analysis": "analisis visual",
  "content_analysis": "analisis konten dan risiko",
  "privacy_analysis": "temuan privasi",
  "ocr_text": "teks yang benar-benar terbaca atau tidak ada",
  "findings": "temuan penting",
  "confidence": "tinggi, sedang, atau rendah"
}
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    // Simpan kode HTTP dan pesan resmi Google di Vercel Runtime Logs,
    // tanpa mencetak URL request yang berisi API key.
    const upstreamMessage =
      payload?.error?.message ||
      payload?.message ||
      (responseText ? responseText.slice(0, 500) : 'Respons kosong dari Gemini');

    console.error('Gemini API request failed:', {
      httpStatus: response.status,
      statusText: response.statusText,
      model,
      message: upstreamMessage
    });

    throw new Error(`Gemini API HTTP ${response.status}: ${upstreamMessage}`);
  }

  if (!payload) {
    throw new Error('Gemini mengembalikan respons JSON yang tidak valid.');
  }

  const rawText = extractGeminiText(payload);
  if (!rawText) {
    const finishReason = payload?.candidates?.[0]?.finishReason;
    const blockReason = payload?.promptFeedback?.blockReason;
    console.error('Gemini returned no text:', { model, finishReason, blockReason });
    throw new Error(
      `Gemini tidak memberikan teks analisis (finishReason=${finishReason || 'unknown'}, blockReason=${blockReason || 'none'}).`
    );
  }

  const ai = parseJsonObject(rawText);
  const decision = String(ai.decision || '').toUpperCase();
  if (!['APPROVE', 'REVIEW', 'REJECT'].includes(decision)) {
    throw new Error('Keputusan AI tidak valid.');
  }

  return {
    status: decision.toLowerCase() === 'approve'
      ? 'approved'
      : decision.toLowerCase() === 'reject' ? 'rejected' : 'review',
    reason: typeof ai.reason === 'string' ? ai.reason : 'Perlu pemeriksaan lebih lanjut.',
    report: makeReport(ai)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!process.env.MODERATION_API_USER ||
      !process.env.MODERATION_API_SECRET ||
      !process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Konfigurasi moderasi server belum lengkap.' });
  }

  try {
    const { imageBase64, mimeType } = req.body || {};

    if (typeof imageBase64 !== 'string' ||
        imageBase64.length === 0 ||
        imageBase64.length > MAX_BASE64_LENGTH ||
        !ALLOWED_MIME_TYPES.has(mimeType)) {
      return res.status(400).json({ error: 'File gambar tidak valid atau terlalu besar.' });
    }

    const buffer = Buffer.from(imageBase64, 'base64');
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) {
      return res.status(400).json({ error: 'Ukuran gambar maksimal 3 MB.' });
    }

    // Jalankan pemeriksaan Sightengine terlebih dahulu.
    const sightengine = await checkSightengine(buffer, mimeType);
    if (sightengine.status === 'rejected') {
      return res.status(200).json({
        status: 'rejected',
        reason: sightengine.reason,
        report: 'Gambar ditolak oleh pemeriksaan keamanan visual.'
      });
    }

    // Gemini wajib memberikan keputusan valid; jika gagal, request masuk REVIEW.
    const gemini = await analyzeWithGemini(buffer, mimeType);

    if (gemini.status === 'rejected') {
      return res.status(200).json(gemini);
    }

    if (sightengine.status === 'review' || gemini.status === 'review') {
      const reasons = [sightengine.reason, gemini.reason].filter(Boolean);
      return res.status(200).json({
        status: 'review',
        reason: reasons.join(' ') || 'Gambar memerlukan pemeriksaan administrator.',
        report: gemini.report
      });
    }

    return res.status(200).json({
      status: 'approved',
      reason: '',
      report: gemini.report
    });
  } catch (error) {
    console.error('Image moderation failed:', error);
    // Fail closed: error tidak pernah dianggap aman.
    return res.status(503).json({
      status: 'review',
      error: 'Pemeriksaan gambar gagal. Silakan coba lagi nanti.'
    });
  }
};
