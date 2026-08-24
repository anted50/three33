/**
 * Inline admin icons, matching the sidebar in the Figma frame.
 *
 * Inline rather than an icon package: three shapes do not justify a dependency,
 * and inlining keeps them working under a strict CSP with no external requests.
 */

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export function GridIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

export function CartIcon() {
  return (
    <svg {...base}>
      <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.5a1 1 0 0 0 1-.78L20 8H6" />
      <circle cx="10" cy="20" r="1.2" />
      <circle cx="17" cy="20" r="1.2" />
    </svg>
  )
}

export function BoxIcon() {
  return (
    <svg {...base}>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </svg>
  )
}

export function SignOutIcon() {
  return (
    <svg {...base}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5M5 12h11" />
    </svg>
  )
}

export function GearIcon() {
  // A ring with plain rays around it reads as a sun, not a settings icon —
  // the teeth need to be part of the outline, not separate spokes.
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function TruckIcon() {
  return (
    <svg {...base}>
      <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </svg>
  )
}

export function TagIcon() {
  return (
    <svg {...base}>
      <path d="M20.6 12.9 12.9 20.6a2 2 0 0 1-2.8 0l-6.7-6.7a2 2 0 0 1 0-2.8L11.1 3.4A2 2 0 0 1 12.5 3H19a1 1 0 0 1 1 1v6.5a2 2 0 0 1-.6 1.4Z" />
      <circle cx="15.5" cy="8.5" r="1.2" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg {...base} width={16} height={16}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-.9 13.4a2 2 0 0 1-2 1.6H6.9a2 2 0 0 1-2-1.6L4 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function ChevronLeftIcon() {
  return (
    <svg {...base} width={16} height={16}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

export function ChevronRightIcon() {
  return (
    <svg {...base} width={16} height={16}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}
