import type { ReactNode } from 'react'
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Uppercut Deluxe Mongolia' },
    ],
    links: [
      // Preconnect before the stylesheet: the CSS request is render-blocking
      // and the font files come from a second origin.
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        // Variable weight axis, so 400/500/600/700 cost one file. Cyrillic and
        // cyrillic-ext ship by default — checked, since the whole UI is
        // Mongolian. display=swap so text renders in the fallback rather than
        // staying invisible while the font loads.
        href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Mono:wght@400..700&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  // lang="mn" — v1 ships Mongolian-only; the *_en columns exist for later.
  return (
    <html lang="mn">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
