const fs = require('fs');
let c = fs.readFileSync('src/features/inspections/ReviewPanel.tsx','utf8');
const searchString = `          <SectionTitle hint={\`\${report.issues.length} to review\`}>BEFORE YOU LEAVE</SectionTitle>
          <div className="space-y-2">
            {report.issues.map((issue) => {
              const tone = TONE[issue.severity]
              return (
                <div key={issue.code} className={\`rounded-2xl p-3.5 ring-1 \${tone.ring}\`}>
                  <div className="flex items-start gap-2.5">
                    <span className={\`mt-1.5 size-1.5 shrink-0 rounded-full \${tone.dot}\`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{tone.label}</p>
                      <p className="mt-0.5 text-[13.5px] leading-snug">{issue.message}</p>
                      {issue.fix?.kind === 'camera' && (
                        <Button
                          variant="secondary"
                          className="mt-2.5 !px-3 !py-2 text-[12px]"
                          onClick={() => issue.fix?.kind === 'camera' && onFix(issue.fix.category)}
                        >
                          Fix now — {CATEGORY_LABELS[issue.fix.category]}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>`;

const replaceString = `          <SectionTitle hint={\`\${report.issues.length} to review\`}>BEFORE YOU LEAVE</SectionTitle>
          <div className="space-y-3">
            {(() => {
              const missingPhotos = report.issues.filter((i) => i.message.startsWith('Missing') && i.message.includes('photo'))
              const otherIssues = report.issues.filter((i) => !(i.message.startsWith('Missing') && i.message.includes('photo')))
              return (
                <>
                  {missingPhotos.length > 0 && (
                    <Card className="bg-bg-card ring-1 ring-border-strong border-l-4 border-l-warning-base">
                      <p className="text-[14px] font-semibold text-warning-highlight">
                        Inspection incomplete: {missingPhotos.length} required photo{missingPhotos.length === 1 ? '' : 's'} missing
                      </p>
                      <ul className="mt-3 space-y-2">
                        {missingPhotos.map((issue) => {
                          const label = issue.message.replace('Missing ', '').replace(' photo', '') + ' — Missing'
                          return (
                            <li key={issue.code} className="flex gap-3 justify-between items-center border-b border-border-strong/50 pb-2 last:border-0 last:pb-0">
                              <div className="flex-1 text-[12.5px] leading-snug text-text-secondary">
                                {label}
                              </div>
                              {issue.fix?.kind === 'camera' && (
                                <button
                                  onClick={() => issue.fix?.kind === 'camera' && onFix(issue.fix.category)}
                                  className="shrink-0 font-display text-[11px] uppercase tracking-wider text-warning-highlight hover:text-warning-base underline underline-offset-2"
                                >
                                  Fix Now
                                </button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </Card>
                  )}

                  {otherIssues.map((issue) => {
                    const tone = TONE[issue.severity]
                    return (
                      <div key={issue.code} className={\`rounded-2xl p-3.5 ring-1 \${tone.ring}\`}>
                        <div className="flex items-start gap-2.5">
                          <span className={\`mt-1.5 size-1.5 shrink-0 rounded-full \${tone.dot}\`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{tone.label}</p>
                            <p className="mt-0.5 text-[13.5px] leading-snug">{issue.message}</p>
                            {issue.fix?.kind === 'camera' && (
                              <Button
                                variant="secondary"
                                className="mt-2.5 !px-3 !py-2 text-[12px]"
                                onClick={() => issue.fix?.kind === 'camera' && onFix(issue.fix.category)}
                              >
                                Fix now — {CATEGORY_LABELS[issue.fix.category]}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </>
              )
            })()}
          </div>`;

c = c.replace(searchString, replaceString);

// Also replace the remaining full background warning later down
c = c.replace(/className="rounded-lg bg-status-warning px-3 py-2 ring-1 ring-amber-300"/g, 'className="rounded-lg bg-warning-surface px-3 py-2 ring-1 ring-warning-border"');
c = c.replace(/className="font-display text-\[10px\] tracking-widest text-status-warning\/70"/g, 'className="font-display text-[10px] tracking-widest text-warning-highlight/80"');

// And the one in "SEND WITHOUT THESE?"
c = c.replace(/!bg-status-warning ring-amber-300/g, 'bg-bg-card ring-1 ring-border-strong border-l-4 border-l-warning-base');
c = c.replace(/text-\[14px\] font-semibold text-status-warning/g, 'text-[14px] font-semibold text-warning-highlight');
c = c.replace(/text-\[12\.5px\] leading-snug text-status-warning\/90/g, 'text-[12.5px] leading-snug text-text-secondary');
c = c.replace(/text-status-warning\/90 underline underline-offset-2/g, 'text-warning-highlight underline underline-offset-2 hover:text-warning-base');

fs.writeFileSync('src/features/inspections/ReviewPanel.tsx', c);
console.log("Done.");
