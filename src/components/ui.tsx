import clsx from 'clsx'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-white/10 bg-white/[0.045] p-4 backdrop-blur-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

type Variant = 'primary' | 'ghost' | 'soft'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-ink-950 font-semibold hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100',
  ghost: 'border border-white/15 text-mist-100 hover:bg-white/5 disabled:opacity-40',
  soft: 'bg-white/10 text-mist-100 hover:bg-white/15 disabled:opacity-40',
}

export function Button({
  variant = 'primary',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] transition-colors',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function ProgressBar({
  value,
  max,
  className,
}: {
  value: number
  max: number
  className?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className={clsx('h-2.5 w-full overflow-hidden rounded-full bg-white/10', className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-300 transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode
  tone?: 'default' | 'muted' | 'accent' | 'success'
  className?: string
}) {
  const tones: Record<string, string> = {
    default: 'bg-white/10 text-mist-100',
    muted: 'bg-white/5 text-mist-500',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-emerald-400/10 text-emerald-300',
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Avatar({
  emoji,
  color,
  size = 'md',
  className,
}: {
  emoji: string
  color: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = {
    sm: 'h-9 w-9 text-lg',
    md: 'h-12 w-12 text-2xl',
    lg: 'h-16 w-16 text-3xl',
  }
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-white/15',
        sizes[size],
        className,
      )}
      style={{ backgroundColor: `${color}26` }}
      aria-hidden
    >
      {emoji}
    </span>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-mist-500 uppercase">{children}</h2>
      {action}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-mist-500">{children}</p>
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-200">
      {message}
    </p>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/80',
        className,
      )}
      role="status"
      aria-label="Загрузка"
    />
  )
}
