
-- Roles enum + table
create type public.app_role as enum ('admin', 'employee');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- Jobs
create type public.job_status as enum ('scheduled', 'in_progress', 'completed', 'cancelled');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_email text,
  customer_phone text,
  address text not null,
  lat double precision,
  lng double precision,
  description text,
  scheduled_at timestamptz not null,
  assigned_to uuid references auth.users(id) on delete set null,
  status job_status not null default 'scheduled',
  mgmt_email text,
  report_sent_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.jobs enable row level security;
create index on public.jobs (assigned_to, scheduled_at);

create table public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  type text not null check (type in ('before','after')),
  storage_path text not null,
  uploaded_by uuid references auth.users(id),
  taken_at timestamptz not null default now()
);
alter table public.job_photos enable row level security;
create index on public.job_photos (job_id);

create table public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  author_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.job_notes enable row level security;
create index on public.job_notes (job_id);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  arrived_at timestamptz not null default now(),
  left_at timestamptz,
  source text not null default 'auto' check (source in ('auto','manual')),
  created_at timestamptz not null default now()
);
alter table public.time_entries enable row level security;
create index on public.time_entries (job_id);

-- Profile auto-creation
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  -- First user becomes admin, others employee
  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'employee');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();

-- RLS policies
-- profiles
create policy "view own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "admins view all profiles" on public.profiles for select to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid());

-- user_roles
create policy "view own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "admins view roles" on public.user_roles for select to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "admins manage roles" on public.user_roles for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- jobs
create policy "employees view own jobs" on public.jobs for select to authenticated using (assigned_to = auth.uid());
create policy "admins view all jobs" on public.jobs for select to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "admins manage jobs" on public.jobs for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "employees update own job status" on public.jobs for update to authenticated using (assigned_to = auth.uid()) with check (assigned_to = auth.uid());

-- job_photos
create policy "view photos on accessible jobs" on public.job_photos for select to authenticated using (
  exists (select 1 from public.jobs j where j.id = job_id and (j.assigned_to = auth.uid() or public.has_role(auth.uid(),'admin')))
);
create policy "insert photos on assigned jobs" on public.job_photos for insert to authenticated with check (
  uploaded_by = auth.uid() and exists (select 1 from public.jobs j where j.id = job_id and (j.assigned_to = auth.uid() or public.has_role(auth.uid(),'admin')))
);

-- job_notes
create policy "view notes on accessible jobs" on public.job_notes for select to authenticated using (
  exists (select 1 from public.jobs j where j.id = job_id and (j.assigned_to = auth.uid() or public.has_role(auth.uid(),'admin')))
);
create policy "insert notes on accessible jobs" on public.job_notes for insert to authenticated with check (
  author_id = auth.uid() and exists (select 1 from public.jobs j where j.id = job_id and (j.assigned_to = auth.uid() or public.has_role(auth.uid(),'admin')))
);

-- time_entries
create policy "view time on accessible jobs" on public.time_entries for select to authenticated using (
  user_id = auth.uid() or public.has_role(auth.uid(),'admin')
);
create policy "insert own time" on public.time_entries for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.jobs j where j.id = job_id and j.assigned_to = auth.uid())
);
create policy "update own time" on public.time_entries for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Storage bucket
insert into storage.buckets (id, name, public) values ('job-photos','job-photos', false);

create policy "read job photos" on storage.objects for select to authenticated using (
  bucket_id = 'job-photos' and (
    public.has_role(auth.uid(),'admin') or
    exists (
      select 1 from public.job_photos jp
      join public.jobs j on j.id = jp.job_id
      where jp.storage_path = name and j.assigned_to = auth.uid()
    )
  )
);
create policy "upload job photos" on storage.objects for insert to authenticated with check (
  bucket_id = 'job-photos' and owner = auth.uid()
);
