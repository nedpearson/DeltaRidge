const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/ManagerPage.tsx';
let content = fs.readFileSync(path, 'utf8');

const alertsBlock = `
        <Card className="bg-bg-card p-4 ring-1 ring-border-subtle shadow-sm lg:col-span-2 border-l-4 border-l-status-error">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-3">ACTION REQUIRED / EXCEPTIONS</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="bg-status-error/10 border border-status-error/30 p-3 rounded-lg cursor-pointer hover:bg-status-error/20">
               <h4 className="text-[12px] font-bold text-text-primary">Speed to Lead</h4>
               <p className="text-[11px] text-text-secondary mt-1">2 New inbound leads &gt; 15m uncontacted.</p>
            </div>
            <div className="bg-status-warning/10 border border-status-warning/30 p-3 rounded-lg cursor-pointer hover:bg-status-warning/20">
               <h4 className="text-[12px] font-bold text-text-primary">Stalled Inspections</h4>
               <p className="text-[11px] text-text-secondary mt-1">4 Inspections completed &gt; 24h ago with no proposal sent.</p>
            </div>
            <div className="bg-status-warning/10 border border-status-warning/30 p-3 rounded-lg cursor-pointer hover:bg-status-warning/20">
               <h4 className="text-[12px] font-bold text-text-primary">No-Shows &amp; Unconfirmed</h4>
               <p className="text-[11px] text-text-secondary mt-1">3 Unconfirmed appts tomorrow, 1 no-show recovery needed.</p>
            </div>
          </div>
        </Card>
`;

content = content.replace(/(<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">[\s\S]*?<\/div>)/, `$1\n${alertsBlock}`);

fs.writeFileSync(path, content);
console.log('CommandCenter updated with alerts');
