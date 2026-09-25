import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-brand-600 to-brand-400 text-white shadow-lg shadow-brand-500/25 hover:from-brand-500 hover:to-brand-300 active:scale-[0.98]',
  gold: 'bg-gradient-to-r from-gold-600 to-gold-400 text-surface shadow-lg shadow-gold-500/25 hover:from-gold-500 hover:to-gold-300 active:scale-[0.98]',
  secondary: 'bg-white/5 text-white ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-sm',
  ghost: 'text-white/70 hover:bg-white/5 hover:text-white',
  danger: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20 hover:bg-red-500/20',
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
    <div id={id} className={`rounded-2xl bg-[var(--color-surface-2)] p-4 ring-1 ring-white/5 shadow-xl shadow-black/40 ${className}`}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2.5 mt-6 flex items-baseline justify-between first:mt-0">
      <h2 className="font-display text-xs tracking-[0.14em] text-white/50">{children}</h2>
      {hint && <span className="text-[11px] text-white/35">{hint}</span>}
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
      <span className="mb-1.5 block text-[12px] font-medium text-white/60">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-white/35">{hint}</span>}
    </label>
  )
}

const CONTROL =
  'w-full rounded-xl bg-[var(--color-surface-3)] px-3.5 py-3 text-[15px] text-white ring-1 ring-white/8 outline-none placeholder:text-white/25 focus:ring-2 focus:ring-brand-400'

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
    <div className="rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center">
      <p className="font-display text-sm tracking-wide text-white/70">{title}</p>
      <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-white/40">{body}</p>
    </div>
  )
}
