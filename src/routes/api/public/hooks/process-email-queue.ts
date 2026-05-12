import { createFileRoute } from '@tanstack/react-router'
import { processEmailQueueRequest } from '@/lib/email-queue-processor.server'

export const Route = createFileRoute('/api/public/hooks/process-email-queue')({
  server: {
    handlers: {
      POST: async ({ request }) => processEmailQueueRequest(request, { allowPublicApiKey: true }),
    },
  },
})
