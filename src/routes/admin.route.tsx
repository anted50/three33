import { createFileRoute, Link, Outlet, redirect, useRouter } from '@tanstack/react-router'
import adminCss from '~/styles/admin.css?url'
import { adminLogout, checkAdminSession } from '~/lib/server/admin/auth'
import {
  BoxIcon,
  CartIcon,
  GridIcon,
  SignOutIcon,
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
    meta: [{ title: 'Admin — Three 33' }],
  }),
  beforeLoad: async ({ location }) => {
    const { ok, name } = await checkAdminSession()
    if (!ok && !location.pathname.startsWith('/admin/login')) {
      throw redirect({ to: '/admin/login' })
    }
    return { isAdmin: ok, adminName: name }
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
  { to: '/admin/orders', label: 'Захиалга', icon: CartIcon },
  { to: '/admin/products', label: 'Бүтээгдэхүүн', icon: BoxIcon },
]

function AdminShell() {
  const { isAdmin, adminName } = Route.useRouteContext()
  const router = useRouter()

  // The login page is nested in this layout but must not show the nav —
  // advertising the sections to someone who has not got in yet is pointless.
  if (!isAdmin) return <Outlet />

  return (
    <div className="adm">
      <aside className="adm__side">
        <Link to="/admin" className="adm__logo">
          Three 33 <span>Admin</span>
        </Link>

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

        <Link to="/" className="adm__back">
          ← Дэлгүүр рүү
        </Link>
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

          <button
            type="button"
            className="adm__signout"
            title={adminName ? `Гарах (${adminName})` : 'Гарах'}
            aria-label="Гарах"
            onClick={async () => {
              await adminLogout()
              await router.invalidate()
              await router.navigate({ to: '/admin/login' })
            }}
          >
            <SignOutIcon />
          </button>
        </header>

        <main className="adm__main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** Names the current section from the URL, so pages need not pass a title up. */
function Crumb() {
  const { location } = useRouter().state
  const path = location.pathname

  if (path.startsWith('/admin/orders')) return <>Захиалга</>
  if (path.startsWith('/admin/products')) return <>Бүтээгдэхүүн</>
  return <>Хяналтын самбар</>
}
