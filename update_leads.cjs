const fs = require('fs');
let code = fs.readFileSync('c:/dev/github/business/DeltaRidge/src/pages/LeadsPage.tsx', 'utf8');

// 1. Add visual sub-scores and Ultimate tier, and 'Why This House' to DoorCard
code = code.replace(/function DoorCard\(\{[\s\S]*?<\/[cC]ard>\s*\n\s*\}/m, `function DoorCard({
  lead,
  managed,
  onKnock,
  onPhoneSaved,
}: {
  lead: ScoredLead
  managed: ManagedLead | undefined
  onKnock: (lead: ScoredLead) => void
  onPhoneSaved?: () => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [roofOpen, setRoofOpen] = useState(false)
  const parcel = lead.parcel

  const propOpp = lead.breakdown.filter(f => f.label !== 'Owner occupied').reduce((sum, f) => sum + f.points, 0)
  const homeIntent = lead.breakdown.find(f => f.label === 'Owner occupied')?.points ?? 0
  const contactability = managed?.contactPhone ? 'High' : (lead.parcel?.ownerName ? 'Medium' : 'Low')
  const isUltimate = lead.score >= 50

  return (
    <Card className={isUltimate ? "ring-2 ring-gold-500" : ""}>
      {roofOpen && (
        <RoofViewSheet
          latitude={lead.latitude}
          longitude={lead.longitude}
          address={lead.address}
          onClose={() => setRoofOpen(false)}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 truncate text-[15px] font-semibold">
            {isUltimate && <span className="rounded bg-gradient-to-r from-gold-400 to-gold-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-950 shadow-sm">Ultimate Lead</span>}
            {lead.address}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-text-secondary">
            {[lead.subdivision, lead.city].filter(Boolean).join(' · ') || 'East Baton Rouge Parish'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={\`font-display text-2xl leading-none \${tone(lead.score)}\`}>{lead.score}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-text-secondary">priority</p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="flex-1 rounded-lg bg-bg-elevated p-2 text-center">
          <p className="text-[10px] uppercase text-text-secondary">Property</p>
          <p className="font-display text-lg text-gold-400">{propOpp}</p>
        </div>
        <div className="flex-1 rounded-lg bg-bg-elevated p-2 text-center">
          <p className="text-[10px] uppercase text-text-secondary">Intent</p>
          <p className="font-display text-lg text-gold-400">{homeIntent}</p>
        </div>
        <div className="flex-1 rounded-lg bg-bg-elevated p-2 text-center">
          <p className="text-[10px] uppercase text-text-secondary">Contact</p>
          <p className={\`font-display text-[15px] leading-tight mt-1 \${contactability === 'High' ? 'text-status-success' : contactability === 'Medium' ? 'text-gold-400' : 'text-text-secondary'}\`}>{contactability}</p>
        </div>
      </div>

      <div className="mt-3">
        <OwnerLine parcel={parcel} />
      </div>

      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-2">Why This House / Show Proof</p>
        <ul className="space-y-1">
          {lead.reasons.map((reason) => (
            <li key={reason} className="flex gap-2 text-[12.5px] leading-snug text-text-primary">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-400" />
              {reason}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3">
        <ResidentPhoneCard
          address={lead.address}
          city={lead.city || 'Baton Rouge'}
          zip={lead.postalCode}
          ownerName={parcel?.ownerName}
          phone={managed?.contactPhone}
          email={managed?.contactEmail}
          onPhoneSaved={async (phone, email, name) => {
            await saveResidentContact(lead, phone, email, name)
            onPhoneSaved?.()
          }}
        />
      </div>

      {managed && (
        <p className="mt-2 inline-block rounded-full bg-bg-elevated px-2.5 py-1 text-[11px] text-text-secondary">
          {STATUS_LABEL[managed.status]} · knocked {managed.knockCount}x
        </p>
      )}

      <Button variant="gold" full className="mt-3" onClick={() => onKnock(lead)}>
        Knocked it
      </Button>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <a
          href={mapsHref(lead.latitude, lead.longitude)}
          target="_blank"
          rel="noreferrer"
          className="contents"
        >
          <Button variant="secondary">Navigate</Button>
        </a>
        <Button
          variant="secondary"
          onClick={() => setRoofOpen(true)}
        >
          EagleView
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigate(\`/property/\${encodeURIComponent(lead.addressKey)}\`)}
        >
          Property
        </Button>
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-2 w-full !min-h-0 py-1 text-[11px] text-text-secondary"
      >
        {open ? 'Hide how this ranked' : 'How this ranked'}
      </button>
      {open && <ScoreBreakdown lead={lead} />}
    </Card>
  )
}`);

// 2. Add searchAroundMe to LeadsPage
code = code.replace(/  const patch = \(p: Partial<LeadRunSettings>\) => \{[\s\S]*?  \}/, `  const patch = (p: Partial<LeadRunSettings>) => {
    const next = { ...settings, ...p }
    setSettings(next)
    void refresh(next)
  }

  const searchAroundMe = useCallback(() => {
    if (!here) return
    const diff = 0.05
    const bbox: [number, number, number, number] = [here.longitude - diff, here.latitude - diff, here.longitude + diff, here.latitude + diff]
    patch({ bbox })
  }, [here, patch])`);

// 3. Add Search Near Me button
code = code.replace(/<Button[\s\S]*?disabled={busy}[\s\S]*?>[\s\S]*?\{busy \? 'Building the list…' : run \? 'Refresh the list' : 'Build the list'\}[\s\S]*?<\/Button>/, `<div className="flex gap-2 mt-4">
          <Button
            variant="gold"
            full
            onClick={() => void refresh(settings)}
            disabled={busy}
          >
            {busy ? 'Building the list…' : run ? 'Refresh the list' : 'Build the list'}
          </Button>
          {here && (
            <Button
              variant="secondary"
              full
              onClick={searchAroundMe}
              disabled={busy}
            >
              Search Near Me
            </Button>
          )}
        </div>`);

// 4. Update the layout for rendering Best Opportunities
code = code.replace(/              \) : activeRoute \? \([\s\S]*?              \) : \([\s\S]*?<div className="mt-2 space-y-2">[\s\S]*?\{\/\* Routes first, doors second. A hundred and fifty cards is a[\s\S]*?scroll, not a plan; a handful of neighbourhoods is a[\s\S]*?morning. \*\/\}[\s\S]*?\{worthADrive\.map\(\(route\) => \([\s\S]*?<RouteCard[\s\S]*?key=\{route\.name\}[\s\S]*?route=\{route\}[\s\S]*?onPick=\{.*?\}[\s\S]*?\/>[\s\S]*?\)\)\}[\s\S]*?\{singleStops\.length > 0 && \([\s\S]*?<>[\s\S]*?<SectionTitle hint=\{\`\$\{singleStops\.reduce\(\(t, r\) => t \+ r\.doors\.length, 0\)\} doors\`\}>[\s\S]*?ON THE WAY[\s\S]*?<\/SectionTitle>[\s\S]*?\{singleStops\.map\(\(route\) => \([\s\S]*?<RouteCard[\s\S]*?key=\{route\.name\}[\s\S]*?route=\{route\}[\s\S]*?onPick=\{.*?\}[\s\S]*?\/>[\s\S]*?\)\)\}[\s\S]*?<\/>[\s\S]*?\)\}[\s\S]*?<\/div>[\s\S]*?\)/, `              ) : activeRoute ? (
                <div className="mt-2 space-y-2">
                  <RouteHeader
                    route={activeRoute}
                    ordered={visibleDoors}
                    onBack={() => setRouteName(null)}
                  />
                  {visibleDoors.map((lead) => (
                    <DoorCard
                      key={lead.addressKey}
                      lead={lead}
                      managed={managedByAddress.get(lead.addressKey)}
                      onKnock={setKnocking}
                      onPhoneSaved={() => void readLeads().then(setManaged)}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <SectionTitle hint={\`\${filteredDoors.length} doors\`}>
                    BEST OPPORTUNITIES NEAR ME
                  </SectionTitle>
                  {filteredDoors.slice(0, 20).map((lead) => (
                    <DoorCard
                      key={lead.addressKey}
                      lead={lead}
                      managed={managedByAddress.get(lead.addressKey)}
                      onKnock={setKnocking}
                      onPhoneSaved={() => void readLeads().then(setManaged)}
                    />
                  ))}
                </div>
              )`);

fs.writeFileSync('c:/dev/github/business/DeltaRidge/src/pages/LeadsPage.tsx', code);
console.log('LeadsPage.tsx updated.');
