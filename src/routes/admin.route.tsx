import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/** Where the desktop sidebar's collapsed or open state is kept, per browser. */
const SIDE_STORAGE_KEY = 'adm-side'

/**
 * Runs while the page is parsed, before the sidebar paints: puts the saved
 * state on <html>, which admin.css keys off, so a reload does not draw the
 * sidebar wide for a frame and then shut it. A constant: nothing from the
 * request goes into it.
 */
const SIDE_RESTORE_SCRIPT = `try{if(localStorage.getItem('${SIDE_STORAGE_KEY}')==='collapsed')document.documentElement.dataset.admSide='collapsed'}catch(e){}`

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
    // In the head, so it runs before the sidebar is parsed, let alone painted.
    scripts: [{ children: SIDE_RESTORE_SCRIPT }],
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

const DASHBOARD_LABEL = 'Хяналтын самбар'

const NAV: Array<{
  to: string
  label: string
  icon: () => React.ReactElement
  exact?: boolean
}> = [
  // exact, or "Dashboard" stays highlighted on every /admin/* page.
  { to: '/admin', label: DASHBOARD_LABEL, icon: GridIcon, exact: true },
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
  const [menuOpen, setMenuOpen] = usePhoneMenu()
  const { sideCollapsed, toggleSide } = useSideCollapsed()
  useIdentifyAdmin({ isAdmin, adminId, adminEmail, adminName })

  // The login page is nested in this layout but must not show the nav —
  // advertising the sections to someone who has not got in yet is pointless.
  if (!isAdmin) return <Outlet />

  return (
    <div className="adm">
      <AdminSidebar
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        sideCollapsed={sideCollapsed}
        onToggleSide={toggleSide}
        adminName={adminName}
      />

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

/** Ties analytics to the signed-in admin; resets it when the admin changes. */
function useIdentifyAdmin({
  isAdmin,
  adminId,
  adminEmail,
  adminName,
}: {
  isAdmin: boolean
  adminId: string | undefined
  adminEmail: string | undefined
  adminName: string | undefined
}) {
  const posthog = usePostHog()
  const identifiedAdminId = useRef<string | undefined>(undefined)

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
}

/** Phones only: whether the burger menu is open. */
function usePhoneMenu() {
  const [menuOpen, setMenuOpen] = useState(false)
  // Subscribed, so the effect below reruns on every section change.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

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

  return [menuOpen, setMenuOpen] as const
}

/** From 900px: whether the sidebar is cut to its icons. Kept per browser. */
function useSideCollapsed() {
  const [sideCollapsed, setSideCollapsed] = useState(false)

  // The server cannot see the saved choice, so it renders the sidebar open.
  // Read it before paint, so the button and tooltips match what the restore
  // script already drew. Leaving the admin takes the attribute off <html>.
  useLayoutEffect(() => {
    const saved = readSideCollapsed()
    setSideCollapsed(saved)
    showSideCollapsed(saved)
    return () => showSideCollapsed(false)
  }, [])

  const toggleSide = () => {
    const next = !sideCollapsed
    setSideCollapsed(next)
    showSideCollapsed(next)
    saveSideCollapsed(next)
  }

  return { sideCollapsed, toggleSide }
}

/**
 * From 900px a fixed sidebar. On a phone, a bar pinned to the top with the
 * logo and a burger naming the open section. The burger turns into an X and
 * opens .adm__menu over the whole screen under the bar, so the page under it
 * never moves: the sections, then sign-out, then the way back to the shop
 * last. From 900px .adm__menu is display: contents, its children the
 * sidebar's own.
 */
function AdminSidebar({
  menuOpen,
  onToggleMenu,
  sideCollapsed,
  onToggleSide,
  adminName,
}: {
  menuOpen: boolean
  onToggleMenu: () => void
  sideCollapsed: boolean
  onToggleSide: () => void
  adminName: string | undefined
}) {
  return (
    <aside className="adm__side" data-open={menuOpen}>
      <Link to="/admin" className="adm__logo" aria-label="Three33 Admin">
        <span className="adm__logofull" aria-hidden>
          Three33 <em>Admin</em>
        </span>
        {/* The collapsed sidebar's logo: as wide as an icon row. */}
        <span className="adm__logomark" aria-hidden>
          T<em>33</em>
        </span>
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
        onClick={onToggleMenu}
      >
        <BurgerIcon open={menuOpen} />
      </button>

      <div className="adm__menu" id="adm-menu">
        <SidebarNav sideCollapsed={sideCollapsed} />

        {/* Phones only; from 900px sign-out is in the top bar. */}
        <SignOutButton
          className="adm__signout adm__signout--side"
          adminName={adminName}
          label="Гарах"
        />

        {/* From 900px: cuts the sidebar to its icons, or opens it again. */}
        <button
          type="button"
          className="adm__sidetoggle"
          aria-expanded={!sideCollapsed}
          aria-label={sideCollapsed ? 'Цэс дэлгэх' : 'Цэс хураах'}
          title={sideCollapsed ? 'Цэс дэлгэх' : undefined}
          onClick={onToggleSide}
        >
          <CollapseIcon collapsed={sideCollapsed} />
          <span className="adm__navlabel">Хураах</span>
        </button>

        <Link
          to="/"
          className="adm__back"
          title={sideCollapsed ? 'Дэлгүүр рүү' : undefined}
        >
          <span aria-hidden>←</span>
          <span className="adm__navlabel">Дэлгүүр рүү</span>
        </Link>
      </div>
    </aside>
  )
}

/** The section links. Collapsed to icons, each one names itself on hover. */
function SidebarNav({ sideCollapsed }: { sideCollapsed: boolean }) {
  return (
    <nav className="adm__nav">
      {NAV.map((item) => {
        const Icon = item.icon
        return (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.exact ?? false }}
            activeProps={{ 'data-active': 'true' }}
            title={sideCollapsed ? item.label : undefined}
          >
            <Icon />
            <span className="adm__navlabel">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

/** The saved choice; open when there is none or storage is blocked. */
function readSideCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDE_STORAGE_KEY) === 'collapsed'
  } catch {
    // Private mode or blocked site data: no saved choice, so the default.
    return false
  }
}

function saveSideCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(
      SIDE_STORAGE_KEY,
      collapsed ? 'collapsed' : 'open',
    )
  } catch {
    // Storage blocked: the sidebar still toggles, it just is not remembered.
  }
}

/** The attribute admin.css keys the collapsed layout off. */
function showSideCollapsed(collapsed: boolean) {
  const root = document.documentElement
  if (collapsed) {
    root.dataset.admSide = 'collapsed'
  } else {
    delete root.dataset.admSide
  }
}

/** Two chevrons pointing the way the sidebar will go. */
function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {collapsed ? (
        <path d="M6 7l5 5-5 5M13 7l5 5-5 5" />
      ) : (
        <path d="M18 7l-5 5 5 5M11 7l-5 5 5 5" />
      )}
    </svg>
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
  const [busy, setBusy] = useState(false)

  async function signOut() {
    if (busy) return
    setBusy(true)
    try {
      await adminLogout()
    } catch (error) {
      console.error('Admin sign-out failed', error)
      setBusy(false)
      // Loud on purpose: a sign-out that quietly did nothing leaves the admin
      // walking away from a shared computer still signed in. The top bar has
      // no room for an inline message, and this failure is rare.
      window.alert('Гарч чадсангүй. Дахин оролдоно уу.')
      return
    }
    posthog?.reset()
    await router.invalidate()
    await router.navigate({ to: '/admin/login' })
  }

  return (
    <button
      type="button"
      className={className}
      title={adminName ? `Гарах (${adminName})` : 'Гарах'}
      aria-label="Гарах"
      disabled={busy}
      onClick={() => void signOut()}
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

/**
 * Names the current section from the URL, so pages need not pass a title up.
 * Read from NAV, so a section's name in the sidebar and here cannot drift.
 */
function Crumb() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  return <>{sectionLabel(pathname)}</>
}

function sectionLabel(pathname: string): string {
  for (const item of NAV) {
    // The dashboard is /admin itself, a prefix of every section: it is the
    // fallback below, never a match here.
    if (item.exact) continue
    if (pathname.startsWith(item.to)) return item.label
  }
  return DASHBOARD_LABEL
}
