create table public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text not null,
  title text,
  phone text not null,
  text_phone text,
  email text not null,
  website text,
  service_address text not null,
  city text not null,
  state text not null,
  zip text not null,
  business_type text,
  kitchen_type text,
  hours text,
  access_time text,
  onsite_name text,
  onsite_phone text,
  hoods integer,
  fans integer,
  duct_runs integer,
  problem_areas text,
  fire_suppression boolean,
  access_panels boolean,
  roof_access boolean,
  equipment text[],
  other_equipment text,
  last_cleaning date,
  previous_company text,
  service_issues text,
  frequency text,
  created_at timestamptz not null default now()
);

alter table public.intake_submissions enable row level security;

create policy "anyone can submit intake"
  on public.intake_submissions for insert
  to anon, authenticated
  with check (true);

create policy "admins view intake submissions"
  on public.intake_submissions for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));