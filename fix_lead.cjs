const fs = require('fs');
let code = fs.readFileSync('c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx', 'utf8');

// 1. Remove OwnerLine import
code = code.replace("import { OwnerLine } from '@/components/OwnerLine'", "");

// 2. Fix duplicated roofrLastEventAt
const oldState = `  const [roofrLastEventAt, setRoofrLastEventAt] = useState<string | null>(null)
  const [queued, setQueued] = useState<{ total: number; stalled: number }>({ total: 0, stalled: 0 })`;
code = code.replace(oldState, "");

const oldRun = `  const [run, setRun] = useState<LeadRun | null>(null)`;
code = code.replace(oldRun, `  const [queued, setQueued] = useState<{ total: number; stalled: number }>({ total: 0, stalled: 0 })
  const [run, setRun] = useState<LeadRun | null>(null)`);

// 3. Fix lead.parcel
const propertyProfileRepl = `  const scoredLead = useMemo(() => {
    return run?.leads.find((l) => l.addressKey === lead?.addressKey)
  }, [run, lead])

  useEffect(() => {
    if (lead && permits && run && scoredLead) {
      const nearby = (run.stormEvents ?? []).filter(
        (s) => distanceMiles(lead.latitude, lead.longitude, s.latitude, s.longitude) <= 5,
      )
      setProfile(buildPropertyProfile({
        address: lead.address,
        addressKey: lead.addressKey,
        ...(scoredLead.parcel ? { parcel: scoredLead.parcel } : {}),
        permits,
        storms: nearby,
        now: new Date(),
      }))
    }
  }, [lead, permits, run, scoredLead])`;

code = code.replace(/  useEffect\(\(\) => \{\s+if \(lead && permits && run\) \{\s+const nearby = \(run\.stormEvents \?\? \[\]\)\.filter\(\s+\(s\) => distanceMiles\(lead\.latitude, lead\.longitude, s\.latitude, s\.longitude\) <= 5,\s+\)\s+setProfile\(buildPropertyProfile\(\{\s+address: lead\.address,\s+addressKey: lead\.addressKey,\s+\.\.\.\(lead\.parcel \? \{ parcel: lead\.parcel \} : \{\}\),\s+permits,\s+storms: nearby,\s+now: new Date\(\),\s+\}\)\)\s+\}\s+\}, \[lead, permits, run\]\)/, propertyProfileRepl);

// 4. Fix permit.id -> permit.externalId
code = code.replace(/key=\{p\.id\}/g, 'key={p.externalId}');

fs.writeFileSync('c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx', code);
console.log('Fixed LeadPage.tsx');
