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
