DO $$
DECLARE
  payload jsonb;
  new_mid text;
BEGIN
  SELECT message INTO payload FROM pgmq.q_transactional_emails_dlq WHERE msg_id = 1;
  IF payload IS NULL THEN RAISE NOTICE 'No DLQ message'; RETURN; END IF;
  new_mid := gen_random_uuid()::text;
  payload := payload || jsonb_build_object('message_id', new_mid, 'queued_at', now()::text);
  PERFORM pgmq.send('transactional_emails', payload);
  INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status)
  VALUES (new_mid, 'service-report', payload->>'to', 'pending');
  PERFORM pgmq.delete('transactional_emails_dlq', 1::bigint);
END $$;