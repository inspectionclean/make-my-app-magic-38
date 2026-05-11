-- Add new job columns
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS po_number text,
  ADD COLUMN IF NOT EXISTS filters jsonb,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Extend job_status enum with 'cancelled' if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'job_status' AND e.enumlabel = 'cancelled'
  ) THEN
    ALTER TYPE public.job_status ADD VALUE 'cancelled';
  END IF;
END$$;