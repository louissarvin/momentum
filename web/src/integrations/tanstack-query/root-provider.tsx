import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Always fetch regardless of navigator.onLine — the API client handles
        // offline gracefully with mock fallback and abort timeouts.
        networkMode: 'always',
        // Disable automatic retries — individual hooks handle retry logic.
        // This prevents exponential-backoff hangs when the backend is offline.
        retry: false,
      },
      mutations: {
        networkMode: 'always',
        retry: false,
      },
    },
  })
  return {
    queryClient,
  }
}

export function Provider({
  children,
  queryClient,
}: {
  children: React.ReactNode
  queryClient: QueryClient
}) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
