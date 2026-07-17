import '@/lib/polyfills'
import '@/lib/gsap'

import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import type { QueryClient } from '@tanstack/react-query'
import HeroUIProvider from '@/providers/HeroUIProvider'
import LenisSmoothScrollProvider from '@/providers/LenisSmoothScrollProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import SolanaProvider from '@/providers/SolanaProvider'
import ErrorPage from '@/components/ErrorPage'
import AppHeader from '@/components/AppHeader'

import TanStackQueryDevtools from '@/integrations/tanstack-query/devtools'

import AppFooter from '@/components/AppFooter'

import appCss from '@/styles.css?url'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  errorComponent: ({ error, reset }) => (
    <ErrorPage error={error} reset={reset} />
  ),
  notFoundComponent: () => <NotFoundPage />,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Momentum — Predict. Play. Own.' },
      {
        name: 'description',
        content:
          'Predict every kick of the World Cup, own the moments. On-chain prediction pools with cNFT stickers as proof.',
      },
      { property: 'og:title', content: 'Momentum — Predict. Play. Own.' },
      {
        property: 'og:description',
        content:
          'On-chain football prediction pools with Bubblegum cNFT stickers.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { property: 'og:image', content: '/assets/logo-index.svg' },
      { name: 'twitter:image', content: '/assets/logo-index.svg' },
      { name: 'theme-color', content: '#F97316' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'black-translucent',
      },
      { name: 'apple-mobile-web-app-title', content: 'Momentum' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico' },
      { rel: 'icon', href: '/assets/logo-index.svg', type: 'image/svg+xml' },
      { rel: 'manifest', href: '/manifest.json' },
      { rel: 'apple-touch-icon', href: '/assets/images/logo192.png' },
    ],
  }),

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Inline theme script — runs before paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try{
                  var t=localStorage.getItem('theme');
                  if(t){t=JSON.parse(t);}
                  document.documentElement.classList.add(t||'dark');
                }catch(e){
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body>
        <SolanaProvider>
          <HeroUIProvider>
            <LenisSmoothScrollProvider />
            <ThemeProvider>
              {children}
              {import.meta.env.DEV && (
                <TanStackDevtools
                  config={{ position: 'bottom-right' }}
                  plugins={[
                    {
                      name: 'Tanstack Router',
                      render: <TanStackRouterDevtoolsPanel />,
                    },
                    TanStackQueryDevtools,
                  ]}
                />
              )}
            </ThemeProvider>
          </HeroUIProvider>
        </SolanaProvider>
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-ink-900 text-cream-50 antialiased transition-colors duration-300 dark:bg-ink-900 dark:text-cream-50">
      <AppHeader />
      <main className="flex-1 pt-20 md:pt-24">{children}</main>
      <AppFooter />
    </div>
  )
}

// Wire layout around Outlet — this is the actual page component
function Root() {
  return (
    <RootLayout>
      <Outlet />
    </RootLayout>
  )
}

Route.update({
  component: Root,
})

function NotFoundPage() {
  return (
    <div className="min-h-screen bg-ink-900 flex items-center justify-center px-6 py-20">
      <div className="text-center max-w-md w-full">
        <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-400 mb-3">
          404
        </p>
        <h1
          className="text-4xl md:text-6xl font-bold text-cream-50 mb-4"
          style={{ fontFamily: 'var(--font-sans)' }}
        >
          Off the pitch.
        </h1>
        <p className="text-slate-400 text-base mb-8">
          This page doesn't exist. The whistle has already blown.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 transition-colors duration-150 focus-ring"
        >
          Back to home
        </Link>
      </div>
    </div>
  )
}
