const fs = require('fs');
let code = fs.readFileSync('c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx', 'utf8');

// We need to add PropertyPage panels to LeadPage
// Add imports:
const imports = `
import { OwnerLine } from '@/components/OwnerLine'
import RoofImageryPanel from '@/features/imagery/RoofImageryPanel'
import { buildPropertyProfile, type PropertyProfile } from '@/features/leads/property-profile'
import { distanceMiles } from '@/features/leads/scoring'
import { readCachedRun, type LeadRun } from '@/features/leads/engine'
import { EbrPermitProvider } from '@/integrations/permits/ebr'
import { streetLineOf } from '@/integrations/geocode/ebr'
import type { PermitRecord } from '@/integrations/permits/types'
`;

// Insert imports safely after existing imports
code = code.replace(/import \{ newId, saveInspection, type LocalInspection \} from '@\/lib\/db'/, 
  "import { newId, saveInspection, type LocalInspection } from '@/lib/db'\n" + imports);

// We need to add PropertyPage state to LeadPage
const stateRepl = `
  const [roofrLastEventAt, setRoofrLastEventAt] = useState<string | null>(null)
  const [queued, setQueued] = useState<{ total: number; stalled: number }>({ total: 0, stalled: 0 })

  // Property Page fields
  const [run, setRun] = useState<LeadRun | null>(null)
  const [permits, setPermits] = useState<PermitRecord[] | null>(null)
  const [profile, setProfile] = useState<PropertyProfile | null>(null)

  useEffect(() => {
    void readCachedRun().then(setRun)
  }, [])

  useEffect(() => {
    if (lead) {
      new EbrPermitProvider().search({
        kinds: ['reroof', 'new_build', 'other'],
        addressLike: streetLineOf(lead.address),
        limit: 100,
      }).then(setPermits).catch(() => setPermits([]))
    }
  }, [lead])

  useEffect(() => {
    if (lead && permits && run) {
      const nearby = (run.stormEvents ?? []).filter(
        (s) => distanceMiles(lead.latitude, lead.longitude, s.latitude, s.longitude) <= 5,
      )
      setProfile(buildPropertyProfile({
        address: lead.address,
        addressKey: lead.addressKey,
        ...(lead.parcel ? { parcel: lead.parcel } : {}),
        permits,
        storms: nearby,
        now: new Date(),
      }))
    }
  }, [lead, permits, run])
`;
code = code.replace(/  const \[queued, setQueued\] = useState<\{ total: number; stalled: number \}>\(\{ total: 0, stalled: 0 \}\)/, stateRepl);


// Add the panels just before WHAT HAPPENED
const panelsRepl = `
      {lead && (
        <>
          <SectionTitle>PROPERTY & IMAGERY</SectionTitle>
          <RoofImageryPanel
            latitude={lead.latitude}
            longitude={lead.longitude}
            storms={profile?.storms ?? []}
            autoFetch
          />
          <Card className="mt-2">
            <div className="flex gap-4">
              <div className="flex-1">
                <p className="font-semibold text-[13px] text-text-secondary uppercase">Permits ({permits?.length ?? 0})</p>
                <div className="text-[12px] text-text-secondary mt-1">
                  {permits?.slice(0, 3).map(p => (
                    <div key={p.id}>{p.issuedAt.slice(0, 10)} - {p.kind}</div>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-[13px] text-text-secondary uppercase">Storms ({profile?.storms.length ?? 0})</p>
                <div className="text-[12px] text-text-secondary mt-1">
                  {profile?.storms.slice(0, 3).map(s => (
                    <div key={s.externalId}>{s.occurredAt.slice(0, 10)} - {s.hailSizeInches}"</div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      <SectionTitle>WHAT HAPPENED</SectionTitle>
`;
code = code.replace(/      <SectionTitle>WHAT HAPPENED<\/SectionTitle>/, panelsRepl);

// Universal Timeline
code = code.replace(/<SectionTitle hint=\{.*?\}\>HISTORY<\/SectionTitle>/, '<SectionTitle>UNIVERSAL TIMELINE</SectionTitle>');

const timelineRepl = `
            <li className="border-l-2 border-border-subtle pl-3">
              <p className="text-[12.5px] font-semibold text-text-secondary">Lead generated</p>
              <p className="text-[10.5px] text-text-secondary">{when(lead.createdAt)} · Initial Generation</p>
            </li>
            {history.map((event) => (
`;
code = code.replace(/\{history\.map\(\(event\) => \(/, timelineRepl);

fs.writeFileSync('c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx', code);
console.log('LeadPage.tsx updated.');
