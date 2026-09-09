import type { LucideIcon } from 'lucide-react'
import { cn } from '../../../lib/utils'

export type IconTone = 'neutral' | 'green' | 'amber' | 'yellow'

const ICON_TONE: Record<IconTone, string> = {
  neutral: 'text-white/70',
  green: 'text-emerald-400',
  amber: 'text-amber-400',
  yellow: 'text-yellow-300'
  // Mac accents Architect/CTAs purple; per INV-UI-1 nothing here is purple.
}

// Icon-chip background. Amber gets a tinted chip (matches the Plan Retiring
// banner and the "you're over your limit" state) — everything else stays the
// neutral glass tint so a routine tone doesn't read as a warning.
const ICON_CHIP_BG: Record<IconTone, string> = {
  neutral: 'bg-white/[0.06]',
  green: 'bg-white/[0.06]',
  amber: 'bg-amber-400/10',
  yellow: 'bg-white/[0.06]'
}

/**
 * Shared shell for the billing cards — a dark glass card (Windows `surface-card`
 * idiom) with the Mac composition: a leading tinted icon, a title + subtitle
 * text column, an optional trailing control, and an optional expanded body.
 */
export function BillingCard(props: {
  icon: LucideIcon
  iconTone?: IconTone
  title: React.ReactNode
  subtitle?: React.ReactNode
  trailing?: React.ReactNode
  children?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const { icon: Icon, iconTone = 'neutral', title, subtitle, trailing, children, className } = props
  return (
    <div className={cn('surface-card p-5', className)}>
      {/*
        Narrow-window regression (QA repro at 520x700, still above the 500x600
        floor — src/main/index.ts minWidth/minHeight): the old markup put the
        title/subtitle column (`min-w-0 flex-1`) beside the action button
        (`shrink-0`) in a single `flex-nowrap` row. `min-w-0` let the text
        column shrink toward 0 width instead of ever triggering a wrap — under
        `flex-nowrap` items never move to a new line no matter how little
        space is left, so the button ended up painted on top of the squeezed
        title text instead of the row reflowing.

        Fix: make the ROW itself `flex-wrap`, and give the icon+title group a
        real minimum preferred width (`basis-64` = 16rem) instead of `basis-0`
        (what bare `flex-1` implies). Flexbox then wraps the trailing control
        onto its own line, right-aligned via `ml-auto`, exactly when there
        isn't room for both at the icon+title group's minimum readable width
        — driven by actual available space, not a guessed viewport
        breakpoint, so it self-corrects at every window size including ones
        never explicitly tested. At the default 1280px window (and anything
        wide enough) this renders identically to before: one row, no wrap.
      */}
      <div className="flex flex-wrap items-start gap-x-3.5 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3.5">
          <div
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              ICON_CHIP_BG[iconTone]
            )}
          >
            <Icon className={cn('h-[18px] w-[18px]', ICON_TONE[iconTone])} strokeWidth={1.9} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-tight text-text-primary">{title}</div>
            {subtitle ? <div className="mt-1 text-sm text-text-tertiary">{subtitle}</div> : null}
          </div>
        </div>
        {trailing ? <div className="ml-auto shrink-0">{trailing}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  )
}
