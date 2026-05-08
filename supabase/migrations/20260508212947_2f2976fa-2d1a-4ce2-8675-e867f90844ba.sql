ALTER TABLE public.performance_reports ADD COLUMN job_id uuid;
CREATE INDEX IF NOT EXISTS idx_performance_reports_job_id ON public.performance_reports(job_id);