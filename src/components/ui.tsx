import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-md shadow-brand-900/15 hover:bg-brand-500 active:bg-brand-700 active:scale-[0.98]',
  gold: 'bg-gold-500 text-white shadow-md shadow-amber-900/15 hover:bg-gold-400 active:bg-gold-600 active:scale-[0.98]',
  secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-100 hover:ring-slate-400 shadow-sm active:scale-[0.98]',
  ghost: 'text-slate-700 hover:bg-slate-200 hover:text-slate-950',
  danger: 'bg-red-50 text-red-700 ring-1 ring-red-300 hover:bg-red-100',
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
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-[15px] font-bold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:scale-100 ${VARIANTS[variant]} ${full ? 'w-full' : ''} ${className}`}
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
    <div id={id} className={`rounded-2xl border border-slate-200/90 bg-[var(--color-surface-2)] p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)] ${className}`}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2.5 mt-6 flex items-baseline justify-between first:mt-0">
      <h2 className="font-display text-xs tracking-[0.14em] text-brand-900">{children}</h2>
      {hint && <span className="text-[11px] font-medium text-slate-600">{hint}</span>}
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
      <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-600">{hint}</span>}
    </label>
  )
}

const CONTROL =
  'w-full rounded-xl bg-white px-3.5 py-3 text-[15px] text-slate-950 ring-1 ring-slate-300 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-brand-500 shadow-sm'

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
      <p className="font-display text-sm tracking-wide text-slate-900">{title}</p>
      <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-slate-600">{body}</p>
    </div>
  )
}
