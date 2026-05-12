DO $$
DECLARE
  jid bigint;
  new_cmd text;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'process-email-queue';
  new_cmd := $cmd$
  SELECT CASE
    WHEN (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now()
      THEN NULL
    WHEN EXISTS (SELECT 1 FROM pgmq.q_auth_emails LIMIT 1)
      OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails LIMIT 1)
      THEN net.http_post(
        url := 'https://project--4905f8e1-3a6a-443a-9366-1f21ed69646a.lovable.app/lovable/email/queue/process',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key'
          )
        ),
        body := '{}'::jsonb
      )
    ELSE NULL
  END;
  $cmd$;
  PERFORM cron.alter_job(job_id := jid, command := new_cmd);
END $$;

UPDATE public.email_send_state
SET transactional_email_ttl_minutes = 240, updated_at = now()
WHERE id = 1;