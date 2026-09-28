const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/pages/ManagerPage.tsx';
let content = fs.readFileSync(path, 'utf8');

const newFunnelPanel = `function SalesFunnelPanel() {
  const { data, loading } = useLeadEconomics();

  if (loading || !data) {
    return <div className="text-[13px] text-text-secondary py-4 text-center">Loading funnel data...</div>;
  }

  // Mocking the deeper funnel stages for UI demonstration per prompt requirements
  const funnel = [
    { stage: 'Assigned', count: 1200, conversion: null, time: null },
    { stage: 'Attempted', count: 950, conversion: 79, time: '2.5h' },
    { stage: 'Reached', count: 400, conversion: 42, time: '14h' },
    { stage: 'Appointment', count: 210, conversion: 52, time: '2d' },
    { stage: 'Inspection', count: 180, conversion: 85, time: '1d' },
    { stage: 'Proposal', count: 140, conversion: 77, time: '3h' },
    { stage: 'Won', count: 42, conversion: 30, time: '7d' },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-[14px] font-bold text-text-primary">Conversion Flow</h3>
            <p className="text-[11px] text-text-secondary mt-0.5">Median transition time and step conversion.</p>
          </div>
          <select className="bg-bg-app border border-border-subtle rounded px-2 py-1 text-[11px] text-text-primary">
             <option>All Sources</option>
             <option>Referrals</option>
             <option>Door Knock</option>
          </select>
        </div>
        
        <div className="space-y-1">
          {funnel.map((step, i) => (
             <div key={step.stage} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-right">
                  <p className="text-[12px] font-bold text-text-primary">{step.stage}</p>
                </div>
                
                <div className="flex-1 bg-bg-app rounded-r-full h-8 flex items-center relative overflow-hidden group cursor-pointer border border-border-subtle hover:border-brand-primary/50 transition-colors">
                  <div className="bg-brand-primary/20 h-full absolute left-0 top-0" style={{ width: \`\${(step.count / funnel[0].count) * 100}%\` }} />
                  <div className="relative z-10 px-3 flex justify-between w-full items-center">
                    <span className="text-[12px] font-display font-bold text-brand-gold">{step.count}</span>
                    {step.conversion && (
                      <span className="text-[10px] text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity">Click to drill down into the {step.count} records</span>
                    )}
                  </div>
                </div>
                
                <div className="w-24 shrink-0 text-left">
                  {step.conversion && (
                    <div>
                      <span className="text-[11px] font-bold text-status-success">{step.conversion}%</span>
                      <span className="text-[10px] text-text-secondary ml-1">avg</span>
                      <p className="text-[9px] text-text-muted mt-0.5 uppercase tracking-wider">{step.time} median</p>
                    </div>
                  )}
                </div>
             </div>
          ))}
        </div>
      </Card>
      
      <Card className="border-l-4 border-l-brand-400 bg-bg-card shadow-sm">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-3">AI Coaching Insights</h3>
        <ul className="space-y-3">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 w-2 h-2 rounded-full bg-status-warning shrink-0" />
            <div>
              <p className="text-[13px] font-bold text-text-primary">Jake T. - Inspection Drop-off</p>
              <p className="text-[11px] text-text-secondary mt-0.5">Jake's Appt -> Proposal rate is 45% (Team avg: 72%). He may need coaching on effectively transitioning roof evidence into a proposal presentation.</p>
            </div>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 w-2 h-2 rounded-full bg-status-success shrink-0" />
            <div>
              <p className="text-[13px] font-bold text-text-primary">Sarah M. - Closing Power</p>
              <p className="text-[11px] text-text-secondary mt-0.5">Sarah's Proposal -> Won rate is 85% this week. Consider asking her to share her closing script in the next sales meeting.</p>
            </div>
          </li>
        </ul>
      </Card>
    </div>
  )
}
`;

content = content.replace(/function SalesFunnelPanel\(\) \{[\s\S]*?(?=\nfunction |$)/g, newFunnelPanel + '\n');
// Ensure it matches only the function and not the rest of the file. Actually, a safer replace:
// We will write a specific regex or string slice if this fails.

// The regex might fail, let's use index based.
const startIdx = content.indexOf('function SalesFunnelPanel() {');
const endIdx = content.indexOf('\nfunction ', startIdx + 1);
if (startIdx !== -1) {
    if (endIdx !== -1) {
        content = content.slice(0, startIdx) + newFunnelPanel + content.slice(endIdx);
    } else {
        content = content.slice(0, startIdx) + newFunnelPanel;
    }
}


fs.writeFileSync(path, content);
console.log('ManagerPage.tsx funnel updated');
