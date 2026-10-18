/**
 * Inline icon set for الحُلم.
 *
 * Hand-rolled SVGs on a 24×24 grid with rounded caps, matching the sketchbook
 * art direction. Kept local (no icon dependency) so bundle size stays small and
 * strokes can inherit `currentColor` and theme tokens directly.
 *
 * RTL note: `ArrowLeft`/`ArrowRight`/`Chevron` are *directional*. Use the
 * `.flip-rtl` helper or the `ChevronForward` alias, which points "forward" in
 * the current writing direction.
 */

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/* ---- Navigation ---------------------------------------------------- */

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M5.5 9.8V19a1 1 0 0 0 1 1H10v-4.6a2 2 0 0 1 4 0V20h3.5a1 1 0 0 0 1-1V9.8" />
  </Svg>
)

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 9.6h17M8.2 3.5v3.2M15.8 3.5v3.2" />
    <path d="M7.4 13.4h2M11 13.4h2M14.6 13.4h2M7.4 17h2M11 17h2" />
  </Svg>
)

export const BookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.6A2 2 0 0 1 6 3.6h5.2v15.8H6a2 2 0 0 1-2-2z" />
    <path d="M20 5.6a2 2 0 0 0-2-2h-5.2v15.8H18a2 2 0 0 0 2-2z" />
    <path d="M11.2 3.6h1.6v15.8h-1.6z" />
  </Svg>
)

export const CheckSquareIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="m8 12.4 2.7 2.7L16.4 9" />
  </Svg>
)

export const TimerIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="13.4" r="7.4" />
    <path d="M12 13.4V9.2" />
    <path d="M9.4 2.9h5.2" />
    <path d="M12 2.9v2.1" />
  </Svg>
)

export const PaletteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.6c4.9 0 8.6 3.5 8.6 7.9 0 2.3-1.7 3.7-3.6 3.7h-1.5c-1 0-1.8.8-1.8 1.7 0 .5.2.9.5 1.2.3.3.5.7.5 1.1 0 .9-.8 1.6-1.8 1.6-5 0-9.5-4-9.5-9.1S6.6 3.6 12 3.6Z" />
    <circle cx="8.2" cy="9.6" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.9" r="1" fill="currentColor" stroke="none" />
    <circle cx="15.7" cy="9.6" r="1" fill="currentColor" stroke="none" />
  </Svg>
)

export const TrendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19.5h16" />
    <path d="m5 15.4 4.2-4.2 3 3L20 6.4" />
    <path d="M15.6 6.4H20v4.4" />
  </Svg>
)

export const CogIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2.9a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V2.9a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Svg>
)

/* ---- Directional --------------------------------------------------- */

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m14.5 5.5-7 6.5 7 6.5" />
  </Svg>
)

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9.5 5.5 7 6.5-7 6.5" />
  </Svg>
)

/** Points forward in the reading direction (left in RTL). */
export const ChevronForwardIcon = (p: IconProps) => <ChevronLeftIcon {...p} />

export const ArrowLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </Svg>
)

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Svg>
)

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
)

/* ---- Actions ------------------------------------------------------- */

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="m14.5 5.5 4 4" />
  </Svg>
)

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 6.5h15" />
    <path d="M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
    <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
    <path d="M10.4 10.4v6M13.6 10.4v6" />
  </Svg>
)

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.9-3.9" />
  </Svg>
)

export const FilterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16" />
    <path d="M7 12h10" />
    <path d="M10 18h4" />
  </Svg>
)

export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 9.6a5.6 5.6 0 0 1 11.2 0c0 4 1.6 5.2 1.6 5.2H4.8s1.6-1.2 1.6-5.2Z" />
    <path d="M10.2 18.2a2 2 0 0 0 3.6 0" />
  </Svg>
)

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.6 4.4 4.4L19 6.8" />
  </Svg>
)

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 5.2 18.5 12l-11 6.8z" fill="currentColor" strokeWidth={1.2} />
  </Svg>
)

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5.5v13M15 5.5v13" />
  </Svg>
)

export const ResetIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 12a7.4 7.4 0 1 0 2.4-5.5" />
    <path d="M4.2 5v4h4" />
  </Svg>
)

export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.6v2.2M12 19.2v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
  </Svg>
)

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
  </Svg>
)

export const SparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9z" />
    <path d="M18.6 16.6l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z" />
  </Svg>
)

export const StarIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z" />
  </Svg>
)

export const FlameIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21c3.6 0 6.2-2.4 6.2-5.8 0-4.2-4.4-5.4-4.4-9.2 0-.9-.4-1.6-1.2-2 .2 2-1.2 3-2.3 4.2C9 9.6 7.5 11 7.5 13.4c0 .9.3 1.7.8 2.3-.2-1.3.2-2.4 1.2-3.2-.2 2.4 2.5 2.7 2.5 4.7 0 .9-.6 1.6-1.5 1.9.4.4 1 .6 1.5.6Z" />
  </Svg>
)

export const TargetIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4.2" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </Svg>
)

export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <circle cx="9" cy="9.6" r="1.6" />
    <path d="m4.6 17.4 4.4-4.2 3.2 3 2.8-2.6 4.4 4" />
  </Svg>
)

export const MailIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m4 7 8 5.5L20 7" />
  </Svg>
)

export const BookmarkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3.8h10a1 1 0 0 1 1 1V20l-6-3.4L6 20V4.8a1 1 0 0 1 1-1Z" />
  </Svg>
)

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.6V12l3 1.9" />
  </Svg>
)

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.4" r="3.7" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </Svg>
)

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
)

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v10" />
    <path d="m8 11 4 4 4-4" />
    <path d="M5 19.5h14" />
  </Svg>
)

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V5" />
    <path d="m8 8 4-4 4 4" />
    <path d="M5 19.5h14" />
  </Svg>
)

export const InboxIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12.5 6 5.4A1.5 1.5 0 0 1 7.4 4.4h9.2A1.5 1.5 0 0 1 18 5.4l2.5 7.1" />
    <path d="M3.5 12.5h4l1 2.4h7l1-2.4h4v4.6a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z" />
  </Svg>
)

export const AwardIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="9.4" r="5.4" />
    <path d="m8.4 14.2-1.4 6.2 5-2.7 5 2.7-1.4-6.2" />
  </Svg>
)

export const NoteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.8h8.6L19 8.2V20a.9.9 0 0 1-.9.9H6a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1Z" />
    <path d="M14.4 3.9v4.4H19" />
    <path d="M8.4 12.6h7M8.4 16.2h4.6" />
  </Svg>
)
