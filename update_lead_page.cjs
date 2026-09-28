const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  'return (\n    <div>\n      {/*',
  `return (
    <div className="pb-24 relative">
      {/* CONTEXTUAL ACTION BAR */}
      <div className="fixed bottom-0 left-0 right-0 p-3 bg-bg-elevated border-t border-border-strong shadow-[0_-8px_16px_rgba(0,0,0,0.4)] z-50 flex gap-3 md:hidden backdrop-blur-sm bg-opacity-90">
        <a
          href={\`https://www.google.com/maps/dir/?api=1&destination=\${lead.latitude},\${lead.longitude}\`}
          target="_blank"
          rel="noreferrer"
          className="flex-1"
        >
          <Button variant="secondary" full className="py-3.5 font-bold shadow-md h-full">Navigate</Button>
        </a>
        <Button variant="primary" className="flex-1 py-3.5 font-bold shadow-md" onClick={() => {
          document.getElementById('outcome-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }}>Record Outcome</Button>
      </div>

      {/*`
);

fs.writeFileSync(path, content);
console.log('LeadPage.tsx updated');
