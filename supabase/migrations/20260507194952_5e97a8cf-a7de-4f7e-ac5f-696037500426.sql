create table public.performance_reports (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid,
  business_name text not null,
  address text not null,
  city text not null,
  state text not null,
  zip text not null,
  contact_name text not null,
  phone text not null,
  email text,
  service_date date not null,
  arrival_time time,
  completion_time time,
  technicians text,
  previous_cleaning_date date,
  service_type text,
  hoods integer,
  fans integer,
  duct_runs integer,
  fire_suppression boolean,
  access_panels boolean,
  roof_access boolean,
  areas_cleaned text[],
  other_cleaned text,
  condition_before text,
  condition_after text,
  grease_level text,
  airflow_check text,
  fan_check text,
  filter_condition text,
  access_panel_condition text,
  findings text,
  recommendations text,
  recommendation_items text[],
  photos text[],
  technician_name text,
  technician_signature text,
  customer_rep text,
  customer_signature text,
  signature_date date not null,
  created_at timestamptz not null default now()
);

alter table public.performance_reports enable row level security;

create policy "authenticated submit performance report"
  on public.performance_reports for insert
  to authenticated
  with check (submitted_by = auth.uid());

create policy "view own performance reports"
  on public.performance_reports for select
  to authenticated
  using (submitted_by = auth.uid());

create policy "admins view all performance reports"
  on public.performance_reports for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));