/** Booking-page icons: inline, stroked with currentColor, square line caps. */

type IconProps = { size?: number }

function Svg({ size = 20, children, strokeWidth = 1.7 }: IconProps & { children: React.ReactNode; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const BackIcon = (p: IconProps) => (
  <Svg size={26} strokeWidth={2} {...p}>
    <path d="M15 4l-8 8 8 8" />
  </Svg>
)
export const ChevronLeft = (p: IconProps) => (
  <Svg size={18} {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
)
export const ChevronRight = (p: IconProps) => (
  <Svg size={18} {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
)
export const ChevronDown = (p: IconProps) => (
  <Svg size={18} {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
)
export const PlusIcon = (p: IconProps) => (
  <Svg size={18} strokeWidth={1.8} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const CheckIcon = (p: IconProps) => (
  <Svg size={18} strokeWidth={2.4} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
)
export const SunIcon = (p: IconProps) => (
  <Svg strokeWidth={1.6} {...p}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Svg>
)
export const MoonIcon = (p: IconProps) => (
  <Svg strokeWidth={1.6} {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Svg>
)
export const ClockIcon = (p: IconProps) => (
  <Svg strokeWidth={1.6} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
)
export const PinIcon = (p: IconProps) => (
  <Svg strokeWidth={1.6} {...p}>
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
)
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
)
export const PhoneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />
  </Svg>
)
export const ArrowRight = (p: IconProps) => (
  <Svg size={20} strokeWidth={1.8} {...p}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </Svg>
)
export const ScissorsIcon = (p: IconProps) => (
  <Svg size={44} strokeWidth={1.2} {...p}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M8.1 8.1L20 20M8.1 15.9L20 4" />
  </Svg>
)
