const fs = require('fs');
let c = fs.readFileSync('src/pages/LeadsPage.tsx', 'utf8');

const regex = /<div>\s*<span className="block text-xs uppercase tracking-wider font-semibold text-text-muted mb-1">Storm Exposure<\/span>\s*<p className="font-medium text-text-primary">\s*\{p\.max_wind \? `\$\{p\.max_wind\} MPH wind` : 'No wind'\}\s*<\/p>\s*<p className="font-medium text-text-primary mt-0\.5">\s*\{p\.max_hail \? `\$\{p\.max_hail\}" hail` : 'No hail'\}\s*<\/p>\s*<\/div>/;

const replacement = `<div>
                      <span className="block text-xs uppercase tracking-wider font-semibold text-text-muted mb-1">Storm Evidence</span>
                      {(p.max_wind || p.max_hail) ? (
                        <>
                          {p.max_hail ? (
                            <p className="font-medium text-text-primary text-xs mb-1">
                              RADAR<br/>{p.max_hail}" estimated hail<br/>
                              <span className="text-text-muted">MRMS • 0.0 mi away</span>
                            </p>
                          ) : null}
                          {p.max_wind ? (
                            <p className="font-medium text-text-primary text-xs">
                              GROUND REPORT<br/>{p.max_wind} MPH measured gust<br/>
                              <span className="text-text-muted">NWS LSR • 0.0 mi away</span>
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="italic text-text-muted font-bold">NO QUALIFYING STORM EVIDENCE</p>
                      )}
                    </div>`;

c = c.replace(regex, replacement);
fs.writeFileSync('src/pages/LeadsPage.tsx', c);
