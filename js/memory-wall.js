async function fetchWallPosts() {
  const { data, error } = await supabaseClient
    .from('memory_wall_posts')
    .select(`
      id, content, created_at, user_id,
      profiles (full_name),
      wall_likes (user_id)
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function toggleLike(postId) {
  const user = await getCurrentUser();
  if (!user) return;

  const { data: existing } = await supabaseClient
    .from('wall_likes')
    .select('id')
    .eq('post_id', postId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    await supabaseClient.from('wall_likes').delete().eq('id', existing.id);
  } else {
    await supabaseClient.from('wall_likes').insert({ post_id: postId, user_id: user.id });
  }
}