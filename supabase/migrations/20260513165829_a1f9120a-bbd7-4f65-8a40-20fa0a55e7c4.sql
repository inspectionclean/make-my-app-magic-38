DELETE FROM public.intake_submissions
WHERE business_name = 'Fluor Field (All Kitchens)'
  AND frequency = 'Annually'
  AND id NOT IN (
    SELECT id FROM public.intake_submissions
    WHERE business_name = 'Fluor Field (All Kitchens)'
    ORDER BY created_at DESC
    LIMIT 1
  );