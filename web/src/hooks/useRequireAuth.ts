import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@/hooks/useAuth'

/**
 * Redirects to `/` if the user is not authenticated.
 * Use at the top of any protected page component.
 */
export function useRequireAuth(redirectTo = '/') {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isAuthenticated) {
      navigate({ to: redirectTo }).catch(() => null)
    }
  }, [isAuthenticated, navigate, redirectTo])

  return { isAuthenticated }
}
