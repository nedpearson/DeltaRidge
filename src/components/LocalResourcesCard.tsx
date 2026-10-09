import { ExternalLink, Phone } from 'lucide-react'
import { Card, SectionTitle } from '@/components/ui'
import { STATEWIDE, femaFloodMapUrl, findParish } from '@/features/places/parish-resources'

function LinkRow({ href, title, sub }: { href: string; title: string; sub?: string | undefined }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 py-2.5 active:bg-bg-elevated">
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-text-primary">{title}</span>
        {sub && <span className="mt-0.5 block text-[12px] leading-snug text-text-secondary">{sub}</span>}
      </span>
      <ExternalLink size={16} className="shrink-0 text-text-muted" />
    </a>
  )
}

/**
 * Everything official about this location in one place: who issues the reroof
 * permit, the assessor record, the parcel map, flood zone, code, and the
 * state's own claim guidance. Verified links only — see parish-resources.ts.
 */
export default function LocalResourcesCard({ address, parish, city }: {
  address: string
  parish?: string | null | undefined
  city?: string | null | undefined
}) {
  const found = findParish(parish, city)
  const p = found?.resources

  return (
    <div className="space-y-4">
      <div>
        <SectionTitle hint={p ? (found?.inferred ? `${p.parish} (from the city)` : p.parish) : 'parish not on file'}>THIS PARISH</SectionTitle>
        {p ? (
          <Card className="!p-1">
            <LinkRow href={p.permits.url} title="Reroof permit" sub={p.permits.issuer} />
            {p.permits.phone && (
              <a href={`tel:${p.permits.phone}`} className="flex min-h-11 items-center gap-2 px-3 pb-2 text-[13px] font-semibold text-brand-hover">
                <Phone size={14} /> {p.permits.phone}
              </a>
            )}
            <div className="mx-3 border-t border-border-subtle" />
            {p.assessor
              ? <LinkRow href={p.assessor} title="Assessor record" sub="Owner, assessed value, homestead, year built" />
              : <p className="px-3 py-3 text-[13px] text-text-secondary">No online assessor search for this parish.</p>}
            {p.gis && (<><div className="mx-3 border-t border-border-subtle" /><LinkRow href={p.gis} title="Parcel map" sub="Lot lines and neighbouring parcels" /></>)}
            {p.note && <p className="px-3 pb-3 pt-1 text-[12px] text-status-warning">{p.note}</p>}
            <p className="px-3 pb-3 text-[11.5px] text-text-muted">Inside city limits, the city may issue the permit instead. Confirm before you file.</p>
          </Card>
        ) : (
          <Card><p className="text-[13px] text-text-secondary">This address is outside the parishes we have verified resources for.</p></Card>
        )}
      </div>

      <div>
        <SectionTitle>THIS ADDRESS</SectionTitle>
        <Card className="!p-1">
          <LinkRow href={femaFloodMapUrl(address)} title="FEMA flood zone" sub="A mapped flood zone usually means lender-required flood insurance" />
        </Card>
      </div>

      <div>
        <SectionTitle>STATEWIDE</SectionTitle>
        <Card className="!p-1">
          {STATEWIDE.map((s, i) => (
            <div key={s.url}>
              {i > 0 && <div className="mx-3 border-t border-border-subtle" />}
              <LinkRow href={s.url} title={s.name} sub={s.why} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
