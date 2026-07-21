create table if not exists public.video_platform_metrics (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  channel_key text,
  channel_name text,
  platform text not null check (platform in ('youtube', 'instagram', 'tiktok')),
  platform_post_id text,
  platform_url text,
  views integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  shares integer not null default 0,
  watch_time_seconds numeric,
  average_view_duration_seconds numeric,
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_id, platform)
);

alter table public.video_platform_metrics enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.video_platform_metrics to service_role;

create index if not exists video_platform_metrics_video_id_idx
  on public.video_platform_metrics(video_id);

create index if not exists video_platform_metrics_platform_idx
  on public.video_platform_metrics(platform);

alter table public.videos
  add column if not exists created_at timestamptz not null default now();

alter table public.videos
  add column if not exists updated_at timestamptz not null default now();

alter table public.videos
  add column if not exists audio_duration_seconds numeric;

alter table public.videos
  add column if not exists channel_key text;

alter table public.videos
  add column if not exists channel_name text;

alter table public.videos
  add column if not exists scheduled_at timestamptz;

alter table public.videos
  add column if not exists title text;

alter table public.videos
  add column if not exists description text;

alter table public.video_platform_metrics
  add column if not exists channel_key text;

alter table public.video_platform_metrics
  add column if not exists channel_name text;

create index if not exists videos_channel_key_idx
  on public.videos(channel_key);

create index if not exists videos_scheduled_at_idx
  on public.videos(scheduled_at);

create index if not exists video_platform_metrics_channel_key_idx
  on public.video_platform_metrics(channel_key);
