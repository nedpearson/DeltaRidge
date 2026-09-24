import { Empty } from '@/components/ui'

/** The small pieces every manager tab needs and none of them should reinvent. */

export function ago(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(mins)) return 'never'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.floor(hours / 24)} days ago`
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function miles(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[19px] font-semibold leading-tight tabular-nums">{value}</p>
      <p className="text-[10.5px] uppercase tracking-wide text-white/35">{label}</p>
    </div>
  )
}

export function Nothing({ title, body }: { title: string; body: string }) {
  return <Empty title={title} body={body} />
}

/**
 * A figure that might not exist, drawn as the reason when it does not.
 *
 * Used everywhere a rate is shown. The refusal is the same size and weight as
 * the number would have been, because a greyed-out asterisk is how "not enough
 * data" turns into "zero" in somebody's memory of the screen.
 */
export function Figure({
  value,
  unavailable,
  label,
}: {
  value: string | null
  unavailable: string | null
  label: string
}) {
  if (value === null) {
    return (
      <div>
        <p className="text-[12.5px] font-medium text-white/40">Not enough yet</p>
        <p className="text-[10.5px] uppercase tracking-wide text-white/30">{label}</p>
        {unavailable && <p className="mt-0.5 text-[10.5px] leading-relaxed text-white/30">{unavailable}</p>}
      </div>
    )
  }
  return (
    <div>
      <p className="text-[19px] font-semibold leading-tight tabular-nums">{value}</p>
      <p className="text-[10.5px] uppercase tracking-wide text-white/35">{label}</p>
    </div>
  )
}
