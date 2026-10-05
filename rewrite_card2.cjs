const fs = require('fs');
let c = fs.readFileSync('src/pages/LeadsPage.tsx', 'utf8');

const replacement = `            filteredProperties.map(p => (
              <Card key={p.property_id} className="p-0 overflow-hidden border-border-subtle flex flex-col">
                <div className="p-4 bg-bg-base border-b border-border-subtle flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold text-text-primary">
                      {p.owner_name === 'Jane Smith' ? 'DEMO - Jane Smith' : (p.owner_name || 'Owner not found')}
                    </h3>
                    <p className="text-sm font-medium text-text-secondary mt-0.5">
                      {p.address_line1}, {p.city}
                    </p>
                    
                    <div className="mt-3 space-y-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-text-secondary">📍</span>
                        <span className="font-medium text-text-primary">
                          {p.distance_miles !== null && p.distance_miles !== undefined ? (
                            <>{p.distance_miles.toFixed(1)} mi away <span className="text-xs text-text-muted font-normal">({coords ? 'Live GPS' : 'Approximate'})</span></>
                          ) : (
                            <span className="text-text-muted italic">Distance unavailable (Location permission required)</span>
                          )}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-text-secondary">📞</span>
                        <span className="font-medium text-text-primary">
                          {p.primary_phone ? p.primary_phone : <span className="text-text-muted italic">Phone not found</span>}
                        </span>
                        {p.phone_status && <span className="text-[10px] uppercase font-bold text-brand-primary/70 bg-brand-primary/10 px-1.5 py-0.5 rounded">{p.phone_status}</span>}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-text-secondary">📧</span>
                        <span className="font-medium text-text-primary">
                          {p.primary_email ? p.primary_email : <span className="text-text-muted italic">Email not found</span>}
                        </span>
                        {p.email_status && <span className="text-[10px] uppercase font-bold text-brand-primary/70 bg-brand-primary/10 px-1.5 py-0.5 rounded">{p.email_status}</span>}
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right flex flex-col items-end">
                    <div className="flex items-baseline gap-1 bg-brand-primary/10 px-3 py-1 rounded-lg">
                      <span className="text-2xl font-display font-bold text-brand-primary">{p.opportunity_score}</span>
                      <span className="text-[10px] uppercase font-bold text-brand-primary/70">Score</span>
                    </div>
                    {p.assigned_to_name && (
                      <p className="text-xs font-medium text-text-secondary mt-2">● {p.assigned_to_name}</p>
                    )}
                  </div>
                </div>

                <div className="bg-bg-elevated p-4 text-sm text-text-secondary flex-1">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="block text-xs uppercase tracking-wider font-semibold text-text-muted mb-1">Roof Intelligence</span>
                      {p.roof_age_years ? (
                        <>
                          <p className="font-medium text-text-primary">~{p.roof_age_years} yrs old</p>
                          <p className="text-xs text-text-muted mt-0.5 truncate">{p.roof_age_source || 'Unknown source'}</p>
                        </>
                      ) : (
                        <p className="italic text-text-muted">Unknown • no permit found</p>
                      )}
                    </div>
                    <div>
                      <span className="block text-xs uppercase tracking-wider font-semibold text-text-muted mb-1">Storm Exposure</span>
                      <p className="font-medium text-text-primary">
                        {p.max_wind ? \`\${p.max_wind} MPH wind\` : 'No wind'}
                      </p>
                      <p className="font-medium text-text-primary mt-0.5">
                        {p.max_hail ? \`\${p.max_hail}" hail\` : 'No hail'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border-subtle">
                     <span className="block text-xs uppercase tracking-wider font-semibold text-text-muted mb-2">Why this lead?</span>
                     <ul className="space-y-1">
                        {p.roof_age_years && p.roof_age_years >= 15 && <li>• {p.roof_age_years}-year roof</li>}
                        {!p.roof_age_years && <li>• No recent re-roof permit</li>}
                        {p.max_wind && p.max_wind >= 60 && <li>• {p.max_wind} MPH wind exposure</li>}
                        {p.max_hail && p.max_hail >= 1.0 && <li>• {p.max_hail}" hail exposure</li>}
                        {!p.last_visit_date && <li>• Unvisited</li>}
                     </ul>
                  </div>
                </div>

                <div className="flex bg-bg-base border-t border-border-subtle divide-x divide-border-subtle">
                  <button 
                    onClick={() => navigate('/leads/' + (p.lead_id || p.property_id))}
                    className="flex-1 py-3 text-xs font-semibold text-text-primary hover:bg-bg-elevated transition-colors"
                  >
                    Open Lead
                  </button>
                  <a 
                    href={p.primary_phone ? \`tel:\${p.primary_phone.replace(/[^0-9]/g, '')}\` : undefined}
                    className={\`flex-1 py-3 text-xs font-semibold transition-colors text-center \${p.primary_phone ? 'text-brand-primary hover:bg-brand-primary/5' : 'text-text-muted cursor-not-allowed opacity-50'}\`}
                    onClick={(e) => { if (!p.primary_phone) e.preventDefault(); }}
                  >
                    Call
                  </a>
                  <a 
                    href={p.primary_phone ? \`sms:\${p.primary_phone.replace(/[^0-9]/g, '')}\` : undefined}
                    className={\`flex-1 py-3 text-xs font-semibold transition-colors text-center \${p.primary_phone ? 'text-brand-primary hover:bg-brand-primary/5' : 'text-text-muted cursor-not-allowed opacity-50'}\`}
                    onClick={(e) => { if (!p.primary_phone) e.preventDefault(); }}
                  >
                    Text
                  </a>
                  <a 
                    href={p.primary_email ? \`mailto:\${p.primary_email}\` : undefined}
                    className={\`flex-1 py-3 text-xs font-semibold transition-colors text-center \${p.primary_email ? 'text-brand-primary hover:bg-brand-primary/5' : 'text-text-muted cursor-not-allowed opacity-50'}\`}
                    onClick={(e) => { if (!p.primary_email) e.preventDefault(); }}
                  >
                    Email
                  </a>
                  <a 
                    href={\`https://www.google.com/maps/dir/?api=1&destination=\${encodeURIComponent(p.address_line1 + ', ' + p.city)}\`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-3 text-xs font-semibold text-text-secondary hover:bg-bg-elevated transition-colors text-center"
                  >
                    Navigate
                  </a>
                </div>
              </Card>
            ))`;

const regex = /filteredProperties\.map\(p => \([\s\S]*?\)\)\n\s*\)/;
c = c.replace(regex, replacement + '\n          )');

fs.writeFileSync('src/pages/LeadsPage.tsx', c);
