import type { ReactNode } from 'react'
import {
    createRootRoute,
    HeadContent,
    Outlet,
    Scripts,
} from '@tanstack/react-router'
import appCss from '~/styles/app.css?url'
import { CartProvider } from '~/components/cart-drawer'
import { getCart } from '~/lib/server/cart/cart'

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { charSet: 'utf-8' },
            { name: 'viewport', content: 'width=device-width, initial-scale=1' },
            { title: 'Three33 Barber' },
            // Tints the browser chrome on Android to match the hero band.
            { name: 'theme-color', content: '#0b0b0b' },
            // Label under the icon when iOS saves the site to the home screen.
            { name: 'apple-mobile-web-app-title', content: 'Three33' },
        ],
        links: [
            /*
             * SVG first: browsers that support it take it and get a mark that is
             * sharp at any size and follows the tab strip's light/dark scheme. The
             * .ico is the fallback for those that do not, and is also what a browser
             * fetches from the domain root regardless of markup.
             */
            { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
            { rel: 'icon', type: 'image/png', sizes: '96x96', href: '/favicon-96x96.png' },
            { rel: 'shortcut icon', href: '/favicon.ico' },
            { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
            { rel: 'manifest', href: '/site.webmanifest' },

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
    /**
     * The cart count feeds the header, which is on every page. Loading it
     * here means one query per navigation instead of every route remembering
     * to fetch what its own chrome needs.
     */
    loader: async () => ({
        cartCount: (await getCart()).itemCount,
    }),
    component: RootComponent,
})

function RootComponent() {
    return (
        <RootDocument>
            {/* Provider at the root so the header and any product page share one
          drawer, and it survives navigation between them. */}
            <CartProvider>
                <Outlet />
            </CartProvider>
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
