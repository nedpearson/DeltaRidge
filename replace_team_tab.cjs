const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/pages/ManagerPage.tsx';
let content = fs.readFileSync(path, 'utf8');

const startIndex = content.indexOf('function TeamTab({');
const endIndex = content.indexOf('function FieldTab({', startIndex);

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find boundaries");
  process.exit(1);
}

const before = content.slice(0, startIndex);
const after = content.slice(endIndex);

const newTeamTab = `function TeamTab({
  repActivity,
  outcomes,
  baseline,
  nameOf,
  openByRep,
  loading,
}: {
  repActivity: ReturnType<typeof rollUpActivity>
  outcomes: ReturnType<typeof outcomesFrom>
  baseline: ReturnType<typeof orgBaseline>
  nameOf: (id: string | null) => string
  openByRep: Map<string, number>
  loading: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)

  if (loading) return <Card><p className="text-[13px] text-text-secondary">Reading the server.</p></Card>
  if (repActivity.length === 0) {
    return (
      <Nothing
        title="No recorded work yet"
        body="Nobody has knocked a door that reached the server in this window."
      />
    )
  }

  return (
    <Card className="overflow-x-auto p-0 border-x-0 rounded-none sm:p-4 sm:border-x sm:rounded-xl">
      <table className="w-full text-left border-collapse min-w-[700px]">
        <thead>
          <tr className="border-b border-border-strong text-[11px] uppercase tracking-wider text-text-secondary">
            <th className="p-3 font-semibold w-1/4">Rep</th>
            <th className="p-3 font-semibold text-right">Knocks</th>
            <th className="p-3 font-semibold text-right">Doors</th>
            <th className="p-3 font-semibold text-right">Spoke</th>
            <th className="p-3 font-semibold text-right">Appts</th>
            <th className="p-3 font-semibold text-right">Eff Index</th>
            <th className="p-3 font-semibold text-center w-16"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {repActivity.map((rep) => {
            const eff = efficiencyFor(rep.repId, outcomes, baseline)
            const expanded = open === rep.repId
            
            return (
              <React.Fragment key={rep.repId}>
                <tr className={\`hover:bg-bg-elevated transition-colors \${expanded ? 'bg-bg-elevated' : ''}\`}>
                  <td className="p-3 text-[13px] font-bold text-text-primary">
                    {nameOf(rep.repId)}
                    <div className="text-[11px] font-normal text-text-secondary mt-0.5">{openByRep.get(rep.repId) ?? 0} open deals</div>
                  </td>
                  <td className="p-3 text-[13px] text-right">{rep.knocks}</td>
                  <td className="p-3 text-[13px] text-right">{rep.doors}</td>
                  <td className="p-3 text-[13px] text-right text-brand-gold">{rep.conversations}</td>
                  <td className="p-3 text-[13px] text-right text-status-success font-semibold">{rep.appointments}</td>
                  <td className="p-3 text-[13px] text-right font-display tracking-wide">
                    {eff.index === null ? '-' : eff.index.toFixed(2)}
                  </td>
                  <td className="p-3 text-center">
                    <button onClick={() => setOpen(expanded ? null : rep.repId)} className="text-[10px] uppercase font-bold text-brand-gold px-2 py-1 rounded hover:bg-brand-gold/10">
                      {expanded ? 'Hide' : 'Expand'}
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-bg-elevated/50">
                    <td colSpan={7} className="p-4 border-t border-border-subtle/50">
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-text-secondary mb-2">GPS Evidence</p>
                          <div className="text-[12px] text-text-primary bg-bg-app p-2 rounded border border-border-subtle">
                             {rep.verified} confirmed &middot; {rep.probable} consistent &middot; {rep.unverified} off-property &middot; {rep.noFix} no fix
                             {rep.offPropertyShare !== null && (
                               <p className="mt-1 text-[11px] text-text-secondary">{pct(rep.offPropertyShare)} of usable knocks were off-property.</p>
                             )}
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-text-secondary mb-2">Efficiency Arithmetic</p>
                          <div className="text-[12px] text-text-primary bg-bg-app p-2 rounded border border-border-subtle">
                             {eff.unavailable ? (
                                <p className="text-[11px] text-text-secondary">{eff.unavailable}</p>
                             ) : (
                                <>
                                  <p className="text-[11px] text-text-secondary mb-1">
                                    {eff.won} closed against {eff.expected?.toFixed(1)} expected by team baseline. (1.00 is exactly par).
                                  </p>
                                  {eff.contributions.length > 0 && (
                                    <ul className="space-y-1 mt-2">
                                      {eff.contributions.map((c) => (
                                        <li key={c.label} className="text-[11px] leading-tight text-text-secondary">
                                          <span className="font-semibold text-text-primary">Score {c.label}</span> &middot; {c.decided} decided &middot; {c.teamRate === null ? 'no team rate' : \`\${pct(c.teamRate)} win rate, \${c.expected?.toFixed(1)} expected\`}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </>
                             )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */

`;

fs.writeFileSync(path, before + newTeamTab + after);
console.log('Replaced TeamTab with a data grid');
