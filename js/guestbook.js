async function submitGuestbook({ name, email, message }) {
  const user = await getCurrentUser(); // boleh null (anonim)
  const { data, error } = await supabaseClient
    .from('guestbook_entries')
    .insert({
      user_id: user ? user.id : null,
      name,
      email,
      message
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function fetchGuestbook() {
  const { data, error } = await supabaseClient
    .from('guestbook_entries')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}