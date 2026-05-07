import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/intake')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/intake"!</div>
}
