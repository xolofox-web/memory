async function addPhoto({ file, title, category, description, date }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Silakan login dulu.');

  const fileExt = file.name.split('.').pop();
  const fileName = `${user.id}/${Date.now()}.${fileExt}`;

  // 1. Upload file ke Storage
  const { error: uploadError } = await supabaseClient.storage
    .from('photos')
    .upload(fileName, file, { cacheControl: '3600', upsert: false });
  if (uploadError) throw uploadError;

  // 2. Simpan metadata ke tabel
  const { data, error } = await supabaseClient
    .from('photos')
    .insert({
      user_id: user.id,
      title,
      category,
      description,
      photo_date: date,
      storage_path: fileName
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function getPhotoUrl(storagePath) {
  const { data } = supabaseClient.storage.from('photos').getPublicUrl(storagePath);
  return data.publicUrl;
}

async function deletePhoto(id, storagePath) {
  // Hapus dari Storage
  await supabaseClient.storage.from('photos').remove([storagePath]);
  // Hapus dari tabel
  const { error } = await supabaseClient.from('photos').delete().eq('id', id);
  if (error) throw error;
}