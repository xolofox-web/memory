// js/gallery.js
// Moderation berjalan di backend. Jangan simpan API key/secret di file frontend.

const IMAGE_MODERATION_ENDPOINT = '/api/moderate-image';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // Batas aman untuk request serverless.

async function addPhoto({ file, title, category, description, date }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Silakan login dulu.');

  if (!(file instanceof File)) {
    throw new Error('File foto tidak valid.');
  }

  const preparedFile = await prepareImageForUpload(file);

  if (typeof showToast === 'function') {
    showToast('Memeriksa keamanan foto...', '');
  }

  // Hanya status APPROVED yang boleh melanjutkan proses upload.
  // REVIEW, REJECTED, respons tidak dikenal, dan error semuanya dihentikan.
  const moderation = await moderateImage(preparedFile);

  if (moderation.status !== 'approved') {
    const message = moderation.status === 'review'
      ? 'Foto belum dapat dipublikasikan dan memerlukan pemeriksaan admin.'
      : `Foto ditolak: ${moderation.reason || 'Tidak memenuhi ketentuan Afterclass.'}`;
    throw new Error(message);
  }

  if (typeof showToast === 'function') {
    showToast('Foto lolos pemeriksaan. Mengunggah...', '');
  }

  const extension = getSafeImageExtension(preparedFile.type);
  const fileName = `${user.id}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabaseClient.storage
    .from('photos')
    .upload(fileName, preparedFile, {
      cacheControl: '3600',
      upsert: false,
      contentType: preparedFile.type
    });

  if (uploadError) throw uploadError;

  try {
    const { data, error } = await supabaseClient
      .from('photos')
      .insert({
        user_id: user.id,
        title,
        category,
        description,
        photo_date: date,
        storage_path: fileName,
        analysis_report: moderation.report,
        moderation_status: 'approved'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    // Hindari file yatim jika insert metadata gagal.
    const { error: cleanupError } = await supabaseClient.storage
      .from('photos')
      .remove([fileName]);

    if (cleanupError) {
      console.error('Gagal membersihkan file setelah insert gagal:', cleanupError);
    }
    throw error;
  }
}

async function moderateImage(file) {
  const base64 = await fileToBase64(file);

  const response = await fetch(IMAGE_MODERATION_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: base64,
      mimeType: file.type
    })
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Respons moderasi tidak valid. Foto tidak diunggah.');
  }

  if (!response.ok) {
    // Tangani khusus error 503 (Service Unavailable) dari server
    // yang menandakan API eksternal (Gemini) sedang sibuk/down.
    if (response.status === 503) {
      throw new Error(
        'Layanan pemeriksaan foto sedang sibuk atau tidak tersedia. ' +
        'Silakan coba unggah beberapa saat lagi.'
      );
    }
    throw new Error(result?.error || 'Layanan moderasi sedang bermasalah. Foto tidak diunggah.');
  }

  const status = String(result?.status || '').toLowerCase();
  if (!['approved', 'review', 'rejected'].includes(status)) {
    throw new Error('Status moderasi tidak dikenali. Foto tidak diunggah.');
  }

  if (status !== 'approved') {
    return {
      status,
      reason: typeof result.reason === 'string' ? result.reason : '',
      report: typeof result.report === 'string' ? result.report : ''
    };
  }

  if (typeof result.report !== 'string' || !result.report.trim()) {
    throw new Error('Laporan analisis kosong. Foto tidak diunggah.');
  }

  return {
    status: 'approved',
    reason: '',
    report: result.report
  };
}

async function prepareImageForUpload(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Format foto harus JPG, PNG, atau WEBP.');
  }

  if (file.size <= MAX_IMAGE_BYTES) return file;

  // Kompresi foto besar agar tidak melewati batas request serverless.
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Foto tidak dapat dibaca.'));
    });

    const maxDimension = 2400;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Browser tidak mendukung pemrosesan foto.');

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('Foto gagal dikompres.');
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error('Ukuran foto masih terlalu besar. Gunakan foto dengan ukuran lebih kecil.');
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now()
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function getSafeImageExtension(mimeType) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };
  const extension = extensions[mimeType];
  if (!extension) throw new Error('Format foto tidak didukung.');
  return extension;
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function getPhotoUrl(storagePath) {
  const { data } = supabaseClient.storage.from('photos').getPublicUrl(storagePath);
  return data.publicUrl;
}

async function deletePhoto(id, storagePath) {
  const { error: storageError } = await supabaseClient.storage
    .from('photos')
    .remove([storagePath]);
  if (storageError) throw storageError;

  const { error } = await supabaseClient.from('photos').delete().eq('id', id);
  if (error) throw error;
}