// js/gallery.js
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

  if (typeof showToast === 'function') showToast('Mengunggah foto...', '');

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
        analysis_report: 'Sistem AI dinonaktifkan. Foto langsung disetujui.',
        moderation_status: 'approved' // Langsung approved tanpa AI
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

// Fungsi pembantu kompresi gambar (Tetap dipertahankan)
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