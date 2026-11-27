import { useEffect, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import adminCss from '~/styles/admin.css?url'
import { adminLogout, checkAdminSession } from '~/lib/server/admin/auth'
import {
  BoxIcon,
  CalendarIcon,
  CartIcon,
  ClockIcon,
  GearIcon,
  GridIcon,
  ReceiptIcon,
  ScissorsIcon,
  SignOutIcon,
  TagIcon,
  TruckIcon,
} from '~/components/admin-icons'

/**
 * Admin shell and its gate.
 *
 * beforeLoad runs on the server for the initial request and again on client
 * navigation, so the check is not a one-time hydration decision. It is still
 * only half the story: every admin server function re-checks independently
 * via assertAdminSession, because a server function is a public HTTP endpoint
 * that does not care which layout the caller rendered.
 */
export const Route = createFileRoute('/admin')({
  head: () => ({
    links: [{ rel: 'stylesheet', href: adminCss }],
    meta: [{ title: 'Admin — Three33' }],
  }),
  beforeLoad: async ({ location }) => {
    const { ok, userId, email, name } = await checkAdminSession()
    if (!ok && !location.pathname.startsWith('/admin/login')) {
      throw redirect({ to: '/admin/login' })
    }
    return { isAdmin: ok, adminId: userId, adminEmail: email, adminName: name }
  },
  component: AdminShell,
})

const NAV: Array<{
  to: string
  label: string
  icon: () => React.ReactElement
  exact?: boolean
}> = [
  // exact, or "Dashboard" stays highlighted on every /admin/* page.
  { to: '/admin', label: 'Хяналтын самбар', icon: GridIcon, exact: true },
  // Booking first after the dashboard: it's the barber's day, every day.
  { to: '/admin/bookings', label: 'Цаг захиалга', icon: CalendarIcon },
  { to: '/admin/schedule', label: 'Хуваарь', icon: ClockIcon },
  { to: '/admin/services', label: 'Үйлчилгээ', icon: ScissorsIcon },
  { to: '/admin/orders', label: 'Захиалга', icon: CartIcon },
  { to: '/admin/invoices', label: 'Нэхэмжлэх', icon: ReceiptIcon },
  { to: '/admin/products', label: 'Бүтээгдэхүүн', icon: BoxIcon },
  { to: '/admin/categories', label: 'Ангилал', icon: TagIcon },
  { to: '/admin/purchases', label: 'Татан авалт', icon: TruckIcon },
  { to: '/admin/settings', label: 'Тохиргоо', icon: GearIcon },
]

function AdminShell() {
  const { isAdmin, adminId, adminEmail, adminName } = Route.useRouteContext()
  const posthog = usePostHog()
  const identifiedAdminId = useRef<string | undefined>(undefined)
  /** Phones only: whether the burger menu is open. */
  const [menuOpen, setMenuOpen] = useState(false)
  // Subscribed, so the effect below reruns on every section change.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  useEffect(() => {
    if (!isAdmin || !adminId || !posthog) return

    if (identifiedAdminId.current && identifiedAdminId.current !== adminId) {
      posthog.reset()
    }

    posthog.identify(adminId, {
      email: adminEmail,
      name: adminName,
      role: 'admin',
    })
    identifiedAdminId.current = adminId
  }, [adminEmail, adminId, adminName, isAdmin, posthog])

  // Picking a section is the end of the menu's job: close it on arrival.
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  // While the menu is open: Escape closes it, and the page behind is held
  // still, so a swipe in the menu cannot scroll it.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [menuOpen])

  // The login page is nested in this layout but must not show the nav —
  // advertising the sections to someone who has not got in yet is pointless.
  if (!isAdmin) return <Outlet />

  return (
    <div className="adm">
      {/*
        From 900px a fixed sidebar. On a phone, a bar pinned to the top with
        the logo and a burger naming the open section. The burger turns into
        an X and opens .adm__menu over the whole screen under the bar, so the
        page under it never moves: the sections, then sign-out, then the way
        back to the shop last. From 900px .adm__menu
        is display: contents, its children the sidebar's own.
      */}
      <aside className="adm__side" data-open={menuOpen}>
        <Link to="/admin" className="adm__logo">
          Three33 <span>Admin</span>
        </Link>

        {/* Phones: the open section, so the bar still says where you are. */}
        <span className="adm__menulabel">
          <Crumb />
        </span>

        <button
          type="button"
          className="adm__menubtn"
          aria-expanded={menuOpen}
          aria-controls="adm-menu"
          aria-label={menuOpen ? 'Цэс хаах' : 'Цэс нээх'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <BurgerIcon open={menuOpen} />
        </button>

        <div className="adm__menu" id="adm-menu">
          <nav className="adm__nav">
            {NAV.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.exact ?? false }}
                  activeProps={{ 'data-active': 'true' }}
                >
                  <Icon />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          {/* Phones only; from 900px sign-out is in the top bar. */}
          <SignOutButton
            className="adm__signout adm__signout--side"
            adminName={adminName}
            label="Гарах"
          />

          <Link to="/" className="adm__back">
            ← Дэлгүүр рүү
          </Link>
        </div>
      </aside>

      <div className="adm__body">
        <header className="adm__topbar">
          <nav className="adm__crumbs">
            <Link to="/admin">Admin</Link>
            <span aria-hidden>›</span>
            <strong>
              <Crumb />
            </strong>
          </nav>

          <SignOutButton className="adm__signout" adminName={adminName} />
        </header>

        <main className="adm__main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/**
 * Ends the session and goes to the login page. Rendered twice by the shell,
 * once per layout (top bar from 900px, the logo row on phones), with CSS
 * showing one, so neither layout has to move the other's markup around.
 */
function SignOutButton({
  className,
  adminName,
  label,
}: {
  className: string
  adminName: string | undefined
  /** Shown beside the icon; the top bar's button is the icon alone. */
  label?: string
}) {
  const posthog = usePostHog()
  const router = useRouter()

  return (
    <button
      type="button"
      className={className}
      title={adminName ? `Гарах (${adminName})` : 'Гарах'}
      aria-label="Гарах"
      onClick={async () => {
        await adminLogout()
        posthog?.reset()
        await router.invalidate()
        await router.navigate({ to: '/admin/login' })
      }}
    >
      <SignOutIcon />
      {label}
    </button>
  )
}

/**
 * Three bars, or an X while the menu is open. Two drawings swapped, not one
 * morphed: bars translated and turned about a shared centre went through
 * lopsided in-between shapes. The `key` remounts the svg on each swap, so
 * the turn-in animation (.adm__burger in admin.css) plays every time.
 */
function BurgerIcon({ open }: { open: boolean }) {
  return (
    <svg
      key={open ? 'close' : 'open'}
      className="adm__burger"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      {open ? (
        <path d="M6 6l12 12M18 6L6 18" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" />
      )}
    </svg>
  )
}

/** Names the current section from the URL, so pages need not pass a title up. */
function Crumb() {
  const { location } = useRouter().state
  const path = location.pathname

  if (path.startsWith('/admin/bookings')) return <>Цаг захиалга</>
  if (path.startsWith('/admin/schedule')) return <>Хуваарь</>
  if (path.startsWith('/admin/services')) return <>Үйлчилгээ</>
  if (path.startsWith('/admin/orders')) return <>Захиалга</>
  if (path.startsWith('/admin/invoices')) return <>Нэхэмжлэх</>
  if (path.startsWith('/admin/products')) return <>Бүтээгдэхүүн</>
  if (path.startsWith('/admin/categories')) return <>Ангилал</>
  if (path.startsWith('/admin/purchases')) return <>Татан авалт</>
  if (path.startsWith('/admin/settings')) return <>Тохиргоо</>
  return <>Хяналтын самбар</>
}
