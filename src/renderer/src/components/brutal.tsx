import type {
  ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, CSSProperties,
} from 'react'

/**
 * The hand-written skeuomorphic layer.
 *
 * HeroUI covers the components where accessibility is genuinely fiddly --
 * listboxes, dialogs, tooltips. Everything below is simple enough that
 * owning it outright is cheaper than overriding a design system, and it
 * keeps the physical receiver look exact rather than approximate.
 */

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

export function Panel({
  title, children, className, accent,
}: { title?: string; children: ReactNode; className?: string; accent?: string }) {
  return (
    <section
      className={cx('skeuo-panel', className)}
      style={{ '--panel-accent': accent ?? '#70736c' } as CSSProperties}
    >
      {title && (
        <header className="skeuo-panel-header">
          <h2 className="skeuo-panel-title">{title}</h2>
        </header>
      )}
      <div className="skeuo-panel-body">{children}</div>
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
    default: '',
    primary: 'skeuo-button-primary',
    danger: 'skeuo-button-danger',
    ghost: 'skeuo-button-ghost',
  }[variant]
  const dims = {
    sm: 'skeuo-button-sm',
    md: 'skeuo-button-md',
    lg: 'skeuo-button-lg',
  }[size]
  return (
    <button
      className={cx(
        'skeuo-button',
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
      <span className="skeuo-field-label">{label}</span>
      {children}
      {hint && <span className="skeuo-field-hint">{hint}</span>}
    </label>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx('skeuo-input focus:outline-none focus:ring-0', className)}
      {...rest}
    />
  )
}

/** A miniature slide switch with a recessed illuminated track. */
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
      className={cx('skeuo-toggle', checked && 'is-on')}
    >
      <span className="skeuo-toggle-track" aria-hidden>
        <span className="skeuo-toggle-thumb" />
      </span>
      <span className="skeuo-toggle-label">{label}</span>
    </button>
  )
}

export function Tag({
  children, tone = 'neutral',
}: { children: ReactNode; tone?: 'neutral' | 'live' | 'good' | 'bad' }) {
  const palette = tone === 'neutral' ? '' : `status-pod-${tone}`
  return (
    <span className={cx('status-pod', palette)}>
      <span className="status-led" aria-hidden />
      {children}
    </span>
  )
}
