create extension if not exists pgcrypto;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, 'friend@example.com'), '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.user_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text not null unique,
  theme text not null default 'light',
  settings jsonb not null default jsonb_build_object(
    'type', 'Cochlear',
    'difficulty', 'Beginner',
    'frequency', '3-5',
    'cochlearAssessmentMode', 'multiple-choice',
    'specificGroups', '',
    'specificSounds', ''
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_questions integer not null default 0,
  correct_answers integer not null default 0,
  phonetic_errors jsonb not null default '{}'::jsonb,
  word_errors jsonb not null default '{}'::jsonb,
  proficiency_level text not null default 'Beginner',
  last_updated timestamptz not null default timezone('utc', now())
);

create table if not exists public.video_score_history (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id text not null,
  video_name text not null,
  completed_at timestamptz not null,
  score integer not null,
  total_questions integer not null,
  percentage integer not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.question_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id text not null,
  timestamp integer not null,
  correct boolean not null,
  question_text text,
  selected_answer text,
  correct_answer text,
  word text,
  phonetic_category text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_video_score_history_user_id on public.video_score_history(user_id);
create index if not exists idx_question_results_user_video on public.question_results(user_id, video_id);

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_progress enable row level security;
alter table public.video_score_history enable row level security;
alter table public.question_results enable row level security;

drop policy if exists "users can view own profile" on public.profiles;
create policy "users can view own profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
using (auth.uid() = id);

drop policy if exists "users can insert own profile" on public.profiles;
create policy "users can insert own profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "users can access own progress" on public.user_progress;
create policy "users can access own progress"
on public.user_progress for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can access own history" on public.video_score_history;
create policy "users can access own history"
on public.video_score_history for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can access own question results" on public.question_results;
create policy "users can access own question results"
on public.question_results for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
