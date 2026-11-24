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

  // 1. Persiapkan file (kompresi jika > 3MB & tangkap error baca file)
  let preparedFile;
  try {
    preparedFile = await prepareImageForUpload(file);
  } catch (err) {
    throw new Error('Gagal memproses file. Pastikan foto tersimpan di memori HP (bukan di Google Drive/Cloud) dan coba pilih ulang.');
  }

  if (typeof showToast === 'function') {
    showToast('Memeriksa keamanan foto...', '');
  }

  // 2. Moderasi
  const moderation = await moderateImage(preparedFile);

  // JIKA DITOLAK (REJECTED), HENTIKAN PROSES
  if (moderation.status === 'rejected') {
    throw new Error(`Foto ditolak: ${moderation.reason || 'Tidak memenuhi ketentuan Afterclass.'}`);
  }

  // JIKA REVIEW, BERI PERINGATAN TAPI LANJUTKAN UNGGAH
  if (moderation.status === 'review') {
    if (typeof showToast === 'function') {
      showToast(moderation.reason || 'Foto masuk antrean review admin.', 'warning');
    }
  } else {
    // JIKA APPROVED
    if (typeof showToast === 'function') {
      showToast('Foto lolos pemeriksaan. Mengunggah...', '');
    }
  }

  const extension = getSafeImageExtension(preparedFile.type);
  const fileName = `${user.id}/${crypto.randomUUID()}.${extension}`;

  // 3. Upload ke Supabase Storage
  const { error: uploadError } = await supabaseClient.storage
    .from('photos')
    .upload(fileName, preparedFile, {
      cacheControl: '3600',
      upsert: false,
      contentType: preparedFile.type
    });

  if (uploadError) throw uploadError;

  // 4. Simpan ke Database
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
        moderation_status: moderation.status // Simpan 'approved' atau 'review'
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
  // Tangkap error jika file gagal diubah ke base64
  let base64;
  try {
    base64 = await fileToBase64(file);
  } catch (e) {
    throw new Error('Gagal membaca isi file foto. Pastikan file tidak rusak atau terkunci.');
  }

  // Timeout 15 detik agar tidak stuck selamanya
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); 

  try {
    const response = await fetch(IMAGE_MODERATION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: base64,
        mimeType: file.type
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Respons moderasi tidak valid. Foto tidak diunggah.');
    }

    if (!response.ok) {
      throw new Error(result?.error || 'Layanan moderasi sedang bermasalah.');
    }

    const status = String(result?.status || '').toLowerCase();
    if (!['approved', 'review', 'rejected'].includes(status)) {
      throw new Error('Status moderasi tidak dikenali. Foto tidak diunggah.');
    }

    return {
      status,
      reason: typeof result.reason === 'string' ? result.reason : '',
      report: typeof result.report === 'string' ? result.report : ''
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Tangkap error jika waktu habis (AbortError)
    if (error.name === 'AbortError') {
      throw new Error('Waktu pemeriksaan habis (koneksi lambat). Silakan coba lagi.');
    }
    
    throw error;
  }
}

async function prepareImageForUpload(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Format foto harus JPG, PNG, atau WEBP.');
  }

  if (file.size <= MAX_IMAGE_BYTES) return file;

  // Kompresi foto besar agar tidak melewati batas request serverless.
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
    if (imageUrl) URL.revokeObjectURL(imageUrl);
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