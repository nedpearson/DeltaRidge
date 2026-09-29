import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-primary text-white hover:bg-brand-hover active:bg-brand-pressed',
  gold: 'bg-brand-gold text-[#101827] hover:bg-brand-gold-highlight',
  secondary: 'bg-bg-card text-text-primary ring-1 ring-border-strong hover:bg-bg-elevated',
  ghost: 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary',
  danger: 'bg-status-critical/12 text-status-critical ring-1 ring-status-critical/25 hover:bg-status-critical/18',
}

export function Button({
  variant = 'primary',
  full,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean }) {
  return (
    <button
      {...rest}
      className={'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' + VARIANTS[variant] + (full ? ' w-full' : '') + ' ' + className}
    >
      {children}
    </button>
  )
}

export function Card({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return <div id={id} className={'min-w-0 rounded-2xl bg-bg-card p-4 ring-1 ring-border-subtle ' + className}>{children}</div>
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 mt-6 flex min-w-0 items-end justify-between gap-3 first:mt-0">
      <h2 className="min-w-0 text-[11px] font-bold tracking-[0.14em] text-text-muted">{children}</h2>
      {hint && <span className="shrink-0 text-[11px] text-text-muted">{hint}</span>}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-text-muted">{hint}</span>}
    </label>
  )
}

const CONTROL =
  'w-full min-w-0 rounded-xl bg-bg-page px-3.5 py-3 text-base text-text-primary ring-1 ring-border-strong outline-none placeholder:text-text-muted focus:ring-2 focus:ring-brand-primary'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={CONTROL + ' ' + (props.className ?? '')} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={CONTROL + ' min-h-24 resize-y ' + (props.className ?? '')} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={CONTROL + ' appearance-none ' + (props.className ?? '')} />
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border-strong bg-bg-page/50 px-5 py-9 text-center">
      <p className="font-display text-sm tracking-wide text-text-secondary">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-text-muted">{body}</p>
    </div>
  )
}


export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-hover">{eyebrow}</p>}
        <h1 className="break-words text-[clamp(1.45rem,6vw,2rem)] font-bold leading-[1.05] text-text-primary">{title}</h1>
        {description && <div className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-secondary">{description}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: readonly { id: T; label: string; badge?: string | number }[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="mobile-scroll-row rounded-2xl bg-bg-page p-1 ring-1 ring-border-subtle">
      {items.map((item) => {
        const active = value === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={
              'shrink-0 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ' +
              (active ? 'bg-bg-elevated text-text-primary ring-1 ring-border-strong' : 'text-text-muted')
            }
          >
            <span>{item.label}</span>
            {item.badge !== undefined && <span className="ml-1.5 text-[10px] text-text-muted">{item.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function ActionRow({
  icon,
  title,
  description,
  trailing,
  onClick,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
}) {
  const body = (
    <>
      {icon && <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-bg-page text-brand-hover ring-1 ring-border-subtle">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        {description && <div className="mt-0.5 text-xs leading-relaxed text-text-secondary">{description}</div>}
      </div>
      {trailing && <div className="shrink-0 text-text-muted">{trailing}</div>}
    </>
  )

  return onClick ? (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-bg-elevated">
      {body}
    </button>
  ) : (
    <div className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2.5">{body}</div>
  )
}
