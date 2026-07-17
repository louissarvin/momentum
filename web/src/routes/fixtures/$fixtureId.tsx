import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/fixtures/$fixtureId')({
  component: () => <Outlet />,
})
