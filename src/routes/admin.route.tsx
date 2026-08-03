import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import adminCss from '~/styles/admin.css?url'
import { checkAdmin } from '~/lib/server/admin/gate'

/**
 * Admin shell and its gate.
 *
 * beforeLoad runs on the server for the initial request and again on client
 * navigation, so the check is not a one-time hydration decision. It is still
 * only half the story: every admin server function re-checks independently,
 * because a server function is a public endpoint that does not care which
 * layout the caller rendered.
 */
export const Route = createFileRoute('/admin')({
  head: () => ({
    links: [{ rel: 'stylesheet', href: adminCss }],
    meta: [{ title: 'Admin — Three 33' }],
  }),
  beforeLoad: async ({ location }) => {
    const { ok } = await checkAdmin()
    if (!ok && !location.pathname.startsWith('/admin/unlock')) {
      throw redirect({ to: '/admin/unlock' })
    }
    return { isAdmin: ok }
  },
  component: AdminShell,
})

const NAV: Array<{ to: string; label: string; exact?: boolean }> = [
  // exact, or "Dashboard" stays highlighted on every /admin/* page.
  { to: '/admin', label: 'Хяналтын самбар', exact: true },
  { to: '/admin/orders', label: 'Захиалга' },
  { to: '/admin/products', label: 'Бүтээгдэхүүн' },
]

function AdminShell() {
  const { isAdmin } = Route.useRouteContext()

  // The unlock page is nested in this layout but must not show the nav —
  // advertising the sections to someone who has not got in yet is pointless.
  if (!isAdmin) return <Outlet />

  return (
    <div className="adm">
      <aside className="adm__side">
        <Link to="/admin" className="adm__logo">
          Three 33 <span>Admin</span>
        </Link>
        <nav className="adm__nav">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              activeProps={{ 'data-active': 'true' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link to="/" className="adm__back">
          ← Дэлгүүр рүү
        </Link>
      </aside>

      <main className="adm__main">
        <Outlet />
      </main>
    </div>
  )
}
