import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white shadow-md shadow-brand-500/20 hover:bg-brand-400 active:scale-[0.98]',
  gold: 'bg-gold-500 text-white shadow-md shadow-gold-500/20 hover:bg-gold-400 active:scale-[0.98]',
  secondary: 'bg-white text-[var(--color-ink)] ring-1 ring-[var(--color-surface-3)] hover:bg-slate-50 shadow-sm active:scale-[0.98]',
  ghost: 'text-[var(--color-ink)]/70 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]',
  danger: 'bg-red-50 text-red-600 ring-1 ring-red-200 hover:bg-red-100',
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
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-4 text-base font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:scale-100 ${VARIANTS[variant]} ${full ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  )
}

export function Card({
  children,
  className = '',
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <div id={id} className={`rounded-2xl bg-[var(--color-surface-2)] p-4 ring-1 ring-slate-200 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2.5 mt-6 flex items-baseline justify-between first:mt-0">
      <h2 className="font-display text-xs tracking-[0.14em] text-[var(--color-ink)]/60">{children}</h2>
      {hint && <span className="text-[11px] text-[var(--color-ink)]/40">{hint}</span>}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[var(--color-ink)]/70">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--color-ink)]/40">{hint}</span>}
    </label>
  )
}

const CONTROL =
  'w-full rounded-xl bg-white px-3.5 py-3 text-[15px] text-[var(--color-ink)] ring-1 ring-[var(--color-surface-3)] outline-none placeholder:text-[var(--color-ink)]/30 focus:ring-2 focus:ring-brand-500 shadow-sm'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ''}`} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CONTROL} min-h-24 resize-y ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CONTROL} appearance-none ${props.className ?? ''}`} />
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-5 py-10 text-center">
      <p className="font-display text-sm tracking-wide text-[var(--color-ink)]/80">{title}</p>
      <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-[var(--color-ink)]/50">{body}</p>
    </div>
  )
}
