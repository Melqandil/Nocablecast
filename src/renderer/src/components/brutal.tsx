import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react'

/**
 * The hand-written brutalist layer.
 *
 * HeroUI covers the components where accessibility is genuinely fiddly --
 * listboxes, dialogs, tooltips. Everything below is simple enough that
 * owning it outright is cheaper than overriding a design system, and it
 * keeps the harsh look exact rather than approximate.
 */

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

export function Panel({
  title, children, className, accent,
}: { title?: string; children: ReactNode; className?: string; accent?: string }) {
  return (
    <section className={cx('border-3 border-ink bg-panel shadow-brutal', className)}>
      {title && (
        <header
          className="flex items-center gap-2 border-b-3 border-ink px-3 py-1.5"
          style={{ background: accent ?? 'var(--color-ink)' }}
        >
          <h2
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: accent ? 'var(--color-ink)' : 'var(--color-panel)' }}
          >
            {title}
          </h2>
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({
  variant = 'default', size = 'md', className, children, ...rest
}: BtnProps) {
  const palette = {
    default: 'bg-panel text-ink hover:bg-[#ddd8c9]',
    primary: 'bg-blaze text-white hover:brightness-110',
    danger: 'bg-rust text-white hover:brightness-110',
    ghost: 'bg-transparent text-ink hover:bg-[#ddd8c9]',
  }[variant]
  const dims = {
    sm: 'px-2 py-1 text-[10px]',
    md: 'px-3 py-1.5 text-[11px]',
    lg: 'px-5 py-2.5 text-[13px]',
  }[size]
  return (
    <button
      className={cx(
        'border-3 border-ink font-black uppercase tracking-[0.12em]',
        'shadow-brutal-sm press-brutal cursor-pointer',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
        palette, dims, className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Field({
  label, hint, children, htmlFor,
}: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="flex flex-col gap-1" htmlFor={htmlFor}>
      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-ink">
        {label}
      </span>
      {children}
      {hint && <span className="text-[10px] leading-tight text-[color:var(--muted)]">{hint}</span>}
    </label>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'w-full border-3 border-ink bg-white px-2 py-1.5 text-[12px] font-bold text-ink',
        'placeholder:text-[color:var(--muted)] placeholder:font-normal',
        'focus:outline-none focus:ring-0 focus:bg-[#fffdf5]',
        'disabled:opacity-40 disabled:bg-[#ddd8c9]',
        className,
      )}
      {...rest}
    />
  )
}

/** A checkbox that reads as a physical switch rather than a tick. */
export function Toggle({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex items-center gap-2 border-3 border-ink px-2 py-1.5',
        'shadow-brutal-sm press-brutal cursor-pointer',
        'disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'bg-acid' : 'bg-panel',
      )}
    >
      <span
        className={cx(
          'grid h-3.5 w-3.5 place-items-center border-3 border-ink',
          checked ? 'bg-ink' : 'bg-white',
        )}
      >
        {checked && <span className="block h-1 w-1 bg-acid" />}
      </span>
      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-ink">{label}</span>
    </button>
  )
}

export function Tag({
  children, tone = 'neutral',
}: { children: ReactNode; tone?: 'neutral' | 'live' | 'good' | 'bad' }) {
  const palette = {
    neutral: 'bg-panel text-ink',
    live: 'bg-blaze text-white',
    good: 'bg-moss text-white',
    bad: 'bg-rust text-white',
  }[tone]
  return (
    <span className={cx(
      'border-3 border-ink px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em]',
      palette,
    )}>
      {children}
    </span>
  )
}
