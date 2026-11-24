// js/gallery.js
// Moderation berjalan di backend. Jangan simpan API key/secret di file frontend.

const IMAGE_MODERATION_ENDPOINT = '/api/moderate-image';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

async function addPhoto({ file, title, category, description, date }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Silakan login dulu.');

  if (!(file instanceof File)) throw new Error('File foto tidak valid.');

  let preparedFile;
  try {
    preparedFile = await prepareImageForUpload(file);
  } catch (err) {
    throw new Error('Gagal memproses file. Pastikan foto tersimpan di memori HP dan coba pilih ulang.');
  }

  if (typeof showToast === 'function') showToast('Memeriksa keamanan foto...', '');

  // Moderasi
  const moderation = await moderateImage(preparedFile);

  // JIKA DITOLAK (REJECTED), HENTIKAN TOTAL!
  if (moderation.status === 'rejected') {
    throw new Error(`Foto ditolak: ${moderation.reason || 'Tidak memenuhi ketentuan Afterclass.'}`);
  }

  // JIKA REVIEW (Hanya untuk foto aman yang butuh verifikasi manual)
  if (moderation.status === 'review') {
    if (typeof showToast === 'function') {
      showToast('Foto memerlukan pemeriksaan admin. Foto akan disembunyikan dari publik sampai disetujui.', 'warning');
    }
  } else {
    // JIKA APPROVED
    if (typeof showToast === 'function') showToast('Foto lolos pemeriksaan. Mengunggah...', '');
  }

  const extension = getSafeImageExtension(preparedFile.type);
  const fileName = `${user.id}/${crypto.randomUUID()}.${extension}`;

  // Upload ke Supabase Storage
  const { error: uploadError } = await supabaseClient.storage
    .from('photos')
    .upload(fileName, preparedFile, { cacheControl: '3600', upsert: false, contentType: preparedFile.type });

  if (uploadError) throw uploadError;

  // Simpan ke Database
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
        analysis_report: moderation.report || '',
        moderation_status: moderation.status // 'approved' atau 'review'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    // Hapus file jika insert gagal
    await supabaseClient.storage.from('photos').remove([fileName]);
    throw error;
  }
}

async function moderateImage(file) {
  let base64;
  try {
    base64 = await fileToBase64(file);
  } catch (e) {
    throw new Error('Gagal membaca file foto.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); 

  try {
    const response = await fetch(IMAGE_MODERATION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    let result;
    try { result = await response.json(); } catch { throw new Error('Respons tidak valid.'); }

    if (!response.ok) {
      // Menangkap error 503 dari backend (saat AI sibuk)
      throw new Error(result?.error || 'Layanan moderasi sedang bermasalah.');
    }

    const status = String(result?.status || '').toLowerCase();
    if (!['approved', 'review', 'rejected'].includes(status)) {
      throw new Error('Status moderasi tidak dikenali.');
    }

    return { status, reason: result.reason || '', report: result.report || '' };
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('Waktu pemeriksaan habis. Silakan coba lagi.');
    throw error;
  }
}

// Fungsi pembantu tetap sama
async function prepareImageForUpload(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) throw new Error('Format harus JPG, PNG, atau WEBP.');
  if (file.size <= MAX_IMAGE_BYTES) return file;

  let imageUrl;
  try {
    imageUrl = URL.createObjectURL(file);
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
    if (!context) throw new Error('Browser tidak mendukung.');

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('Foto gagal dikompres.');
    
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }
}

function getSafeImageExtension(mimeType) {
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
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
  const { error: storageError } = await supabaseClient.storage.from('photos').remove([storagePath]);
  if (storageError) throw storageError;
  const { error } = await supabaseClient.from('photos').delete().eq('id', id);
  if (error) throw error;
}