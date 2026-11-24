// api/moderate-image.js
// Vercel Serverless Function (Node.js).
// Implementasi sistem analisis gambar Afterclass (Sightengine + OpenAI).

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

async function checkSightengine(buffer, mimeType) {
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mimeType }), 'upload');
  form.append('models', 'nudity-2.0,gore-2.0,wad,offensive,scam,text,properties');
  form.append('api_user', process.env.MODERATION_API_USER);
  form.append('api_secret', process.env.MODERATION_API_SECRET);

  const response = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form });
  const data = await response.json().catch(() => null);
  
  if (!response.ok || !data || data.status !== 'success') {
    console.warn('Sightengine error');
    return { status: 'review', reason: 'Pemeriksaan visual otomatis terlewati.' };
  }

  const nudity = data.nudity || {};

  // Filter ketat untuk konten seksual (karena platform sekolah)
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
    return { status: 'rejected', reason: 'Terdeteksi konten seksual, ketelanjangan, atau pose/pakaian yang tidak pantas.' };
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

// FUNGSI BARU: Moderasi pakai OpenAI
async function moderateWithOpenAI(buffer, mimeType) {
  try {
    const base64Image = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: [
          {
            type: "image_url",
            image_url: { url: dataUrl }
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}`);
    }

    const data = await response.json();
    const result = data.results[0];

    // Jika OpenAI mendeteksi pelanggaran
    if (result.flagged) {
      const categories = Object.keys(result.categories)
        .filter(cat => result.categories[cat])
        .join(', ');
        
      return {
        status: 'rejected',
        reason: `Sistem AI mendeteksi konten yang melanggar aturan: ${categories}.`,
        report: JSON.stringify(result.category_scores, null, 2)
      };
    }

    // Jika aman
    return { 
      status: 'approved', 
      reason: '', 
      report: 'Lolos moderasi AI (OpenAI).' 
    };

  } catch (error) {
    console.warn('OpenAI gagal / sibuk:', error.message);
    // KUNCI ANTI-STUCK: Kalau OpenAI error, jangan tolak! Masukin ke review.
    return {
      status: 'review',
      reason: 'Sistem AI sedang sibuk, foto akan diperiksa manual oleh admin.',
      report: 'Pemeriksaan AI terlewati.'
    };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  
  // Pastikan API Key OpenAI udah dimasukin di Vercel
  if (!process.env.MODERATION_API_USER || !process.env.MODERATION_API_SECRET || !process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Konfigurasi server belum lengkap (API Key OpenAI belum ada).' });
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

    // 2. Cek pakai OpenAI (Moderasi AI)
    const openaiCheck = await moderateWithOpenAI(buffer, mimeType);

    // Kalau OpenAI nolak
    if (openaiCheck.status === 'rejected') {
       return res.status(200).json(openaiCheck);
    }

    // Kalau salah satu bilang review (termasuk kalau OpenAI lagi sibuk)
    if (sightengine.status === 'review' || openaiCheck.status === 'review') {
      return res.status(200).json({
        status: 'review',
        reason: openaiCheck.reason || sightengine.reason || 'Memerlukan pemeriksaan admin.',
        report: openaiCheck.report
      });
    }

    // Kalau lolos semua
    return res.status(200).json({ status: 'approved', reason: '', report: 'Lolos semua pemeriksaan.' });

  } catch (error) {
    console.error('Moderation failed:', error);
    // Kalau error fatal di server, tetap anggap review biar user nggak error merah
    return res.status(200).json({ status: 'review', reason: 'Gangguan sistem, masuk antrean admin.', report: '-' });
  }
};