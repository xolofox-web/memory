-- ============================================================
-- MEMORIES OF SCHOOL — Supabase Schema
-- SMP IT. BCA · Angkatan 2023
-- Jalankan file ini di Supabase → SQL Editor → New Query → Run
-- ============================================================

-- ============================================================
-- 0. BERSIHKAN (opsional — hati-hati, hapus data lama)
-- Hapus komentar di bawah jika ingin reset total
-- ============================================================
-- drop table if exists public.wall_likes cascade;
-- drop table if exists public.memory_wall_posts cascade;
-- drop table if exists public.guestbook_entries cascade;
-- drop table if exists public.photos cascade;
-- drop table if exists public.profiles cascade;


-- ============================================================
-- 1. PROFILES — tabel publik yang mirror dari auth.users
--    Otomatis terisi via trigger saat user sign-up.
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  full_name   text,
  class_name  text,          -- contoh: 'IX A'
  created_at  timestamptz default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone"
  on public.profiles for select using (true);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update using ((select auth.uid()) = id);

-- Trigger: buat profil otomatis setelah user sign-up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, class_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'class_name'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ============================================================
-- 2. VALIDASI KODE ANGKATAN
--    Menggantikan variabel CLASS_CODE di JS.
--    Client memanggil RPC: supabase.rpc('validate_class_code', { input_code: 'xxx' })
-- ============================================================
create or replace function public.validate_class_code(input_code text)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
begin
  -- Ganti 'SMPITBCA2023' sesuai kode yang diinginkan
  return input_code = 'SMPITBCA2023';
end;
$$;

grant execute on function public.validate_class_code(text) to anon, authenticated;


-- ============================================================
-- 3. PHOTOS — Galeri kenangan
-- ============================================================
create table if not exists public.photos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users on delete cascade not null,
  title         text not null,
  category      text not null check (category in ('kegiatan','kelas','wisuda')),
  description   text,
  photo_date    date not null,
  storage_path  text not null,   -- contoh: '<user_id>/<timestamp>.jpg'
  created_at    timestamptz default timezone('utc'::text, now()) not null
);

create index if not exists photos_created_at_idx on public.photos (created_at desc);
create index if not exists photos_user_id_idx    on public.photos (user_id);

alter table public.photos enable row level security;

drop policy if exists "Photos are viewable by everyone" on public.photos;
create policy "Photos are viewable by everyone"
  on public.photos for select using (true);

drop policy if exists "Authenticated users can upload photos" on public.photos;
create policy "Authenticated users can upload photos"
  on public.photos for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own photos" on public.photos;
create policy "Users can delete own photos"
  on public.photos for delete to authenticated
  using ((select auth.uid()) = user_id);


-- ============================================================
-- 4. MEMORY WALL POSTS
-- ============================================================
create table if not exists public.memory_wall_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete cascade not null,
  content     text not null check (char_length(content) between 1 and 500),
  created_at  timestamptz default timezone('utc'::text, now()) not null
);

create index if not exists wall_posts_created_at_idx
  on public.memory_wall_posts (created_at desc);

alter table public.memory_wall_posts enable row level security;

drop policy if exists "Wall posts are viewable by everyone" on public.memory_wall_posts;
create policy "Wall posts are viewable by everyone"
  on public.memory_wall_posts for select using (true);

drop policy if exists "Authenticated users can post" on public.memory_wall_posts;
create policy "Authenticated users can post"
  on public.memory_wall_posts for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own wall posts" on public.memory_wall_posts;
create policy "Users can delete own wall posts"
  on public.memory_wall_posts for delete to authenticated
  using ((select auth.uid()) = user_id);


-- ============================================================
-- 5. WALL LIKES (❤️) — satu user hanya bisa like 1x per post
-- ============================================================
create table if not exists public.wall_likes (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid references public.memory_wall_posts on delete cascade not null,
  user_id     uuid references auth.users on delete cascade not null,
  created_at  timestamptz default timezone('utc'::text, now()) not null,
  unique (post_id, user_id)
);

create index if not exists wall_likes_post_idx on public.wall_likes (post_id);

alter table public.wall_likes enable row level security;

drop policy if exists "Likes are viewable by everyone" on public.wall_likes;
create policy "Likes are viewable by everyone"
  on public.wall_likes for select using (true);

drop policy if exists "Authenticated users can like" on public.wall_likes;
create policy "Authenticated users can like"
  on public.wall_likes for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove own like" on public.wall_likes;
create policy "Users can remove own like"
  on public.wall_likes for delete to authenticated
  using ((select auth.uid()) = user_id);


-- ============================================================
-- 6. GUESTBOOK ENTRIES
--    Anonim & authenticated boleh kirim. user_id boleh NULL.
-- ============================================================
create table if not exists public.guestbook_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete set null,
  name        text not null check (char_length(name) between 1 and 80),
  email       text not null,
  message     text not null check (char_length(message) between 1 and 1000),
  created_at  timestamptz default timezone('utc'::text, now()) not null
);

create index if not exists guestbook_created_at_idx
  on public.guestbook_entries (created_at desc);

alter table public.guestbook_entries enable row level security;

drop policy if exists "Guestbook is viewable by everyone" on public.guestbook_entries;
create policy "Guestbook is viewable by everyone"
  on public.guestbook_entries for select using (true);

drop policy if exists "Anyone can submit guestbook" on public.guestbook_entries;
create policy "Anyone can submit guestbook"
  on public.guestbook_entries for insert
  with check (true);


-- ============================================================
-- 7. STORAGE BUCKET 'photos'
--    Bucket publik (siapa saja bisa lihat URL).
--    Upload/hapus hanya oleh pemilik file.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

-- Policy: siapa saja boleh baca
drop policy if exists "Public read for photos" on storage.objects;
create policy "Public read for photos"
  on storage.objects for select
  using (bucket_id = 'photos');

-- Policy: user login boleh upload ke folder miliknya
drop policy if exists "Authenticated can upload photos" on storage.objects;
create policy "Authenticated can upload photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Policy: user hanya bisa update file sendiri
drop policy if exists "Users can update own photos" on storage.objects;
create policy "Users can update own photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Policy: user hanya bisa hapus file sendiri
drop policy if exists "Users can delete own photos" on storage.objects;
create policy "Users can delete own photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- ============================================================
-- 8. VIEW OPSIONAL — foto + profil pembuat (biar query ringkas)
-- ============================================================
create or replace view public.photos_with_author as
select
  p.id,
  p.user_id,
  p.title,
  p.category,
  p.description,
  p.photo_date,
  p.storage_path,
  p.created_at,
  pr.full_name as author_name
from public.photos p
left join public.profiles pr on pr.id = p.user_id;

grant select on public.photos_with_author to anon, authenticated;


-- ============================================================
-- ✅ SELESAI
-- Setelah run:
--  1. Cek Table Editor — harus ada 5 tabel baru
--  2. Cek Storage → Buckets — harus ada 'photos'
--  3. Cek Authentication → Providers → Email = ON
--  4. (Opsional) Matikan "Confirm email" di Authentication → Settings
--     supaya user bisa langsung login tanpa verifikasi email.
-- ============================================================