import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/format'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light'
type ButtonSize = 'sm' | 'md' | 'lg'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-ink hover:bg-brand-hover active:bg-brand-active shadow-[0_0_28px_rgba(253,26,4,0.22)]',
  secondary: 'bg-panel-2 text-bone border border-line hover:border-muted/60 hover:bg-[#221717]',
  ghost: 'text-muted hover:text-bone hover:bg-white/5',
  danger:
    'bg-danger/10 text-danger border border-danger/35 hover:bg-danger/20 hover:border-danger/60',
  light: 'bg-bone text-ink hover:bg-bone/90 active:bg-bone/80',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-sm gap-2.5 rounded-xl',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </button>
  )
}

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger' | 'muted'

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-white/5 text-bone border-white/10',
  brand: 'bg-brand/10 text-brand border-brand/25',
  success: 'bg-success/10 text-success border-success/25',
  warn: 'bg-warn/10 text-warn border-warn/25',
  danger: 'bg-danger/10 text-danger border-danger/25',
  muted: 'bg-white/[0.03] text-muted border-white/10',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Progress({
  value,
  indeterminate,
  className,
}: {
  value: number
  indeterminate?: boolean
  className?: string
}) {
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-white/[0.07]', className)}>
      <div
        className={cn(
          'h-full rounded-full bg-bone transition-[width] duration-300',
          indeterminate && 'w-1/3 animate-pulse',
        )}
        style={indeterminate ? undefined : { width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-bone', className)} />
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  showLabel = true,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  showLabel?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!checked)
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={cn(
        'inline-flex items-center gap-2.5 rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
    >
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked
            ? 'border-success/50 bg-success shadow-[0_0_12px_rgba(34,197,94,0.35)]'
            : 'border-white/15 bg-white/10',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </span>
      {showLabel && label ? <span className="text-xs font-medium text-bone">{label}</span> : null}
    </button>
  )
}

export function Panel({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div style={style} className={cn('rounded-2xl border border-line bg-panel/80', className)}>
      {children}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-line bg-panel-2/70 px-4 py-3', className)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-1 font-display text-lg font-semibold text-bone">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  )
}

export function SectionTitle({
  children,
  aside,
  className,
}: {
  children: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <h2 className="font-display text-lg font-semibold tracking-tight text-bone">{children}</h2>
      {aside}
    </div>
  )
}
