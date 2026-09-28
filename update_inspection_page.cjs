const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/pages/InspectionPage.tsx';
let content = fs.readFileSync(path, 'utf8');

const newBlock = `
  const usableCategories = new Set(photos.filter(p => !p.retakeRecommended).map(p => p.category));
  const missingCategories = required.filter(c => !usableCategories.has(c));
  const completedCount = required.length - missingCategories.length;
  const nextMissing = missingCategories.length > 0 ? missingCategories[0] : null;

  return (
    <div className="pb-32">
      <div className="flex items-start justify-between gap-3">`;

content = content.replace('  return (\n    <div>\n      <div className="flex items-start justify-between gap-3">', newBlock);

const blockToReplace = `{/* CONTEXTUAL ACTION BAR (Mobile Only) */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-bg-app/95 backdrop-blur-md border-t border-border-subtle flex gap-3 z-40 sm:hidden">
        <Button variant="primary" className="flex-1 font-bold tracking-wide" onClick={() => setTab('capture')}>
          CAPTURE NEXT
        </Button>
      </div>`;

const newActionBarBlock = `{/* CONTEXTUAL ACTION BAR */}
      <div className="fixed bottom-0 left-0 right-0 p-3 bg-bg-elevated border-t border-border-strong shadow-[0_-8px_16px_rgba(0,0,0,0.4)] z-50 md:hidden flex flex-col gap-2">
        <div className="flex justify-between items-center px-1">
          <span className="text-[12px] font-semibold text-text-secondary">{completedCount} / {required.length} required items</span>
          {nextMissing && <span className="text-[11px] uppercase tracking-wider text-status-warning font-bold">NEXT: {nextMissing.replace(/_/g, ' ')}</span>}
        </div>
        <div className="flex gap-3">
          {nextMissing ? (
             <Button variant="primary" className="flex-1 py-3.5 font-bold shadow-md text-[13px]" onClick={() => fixNow(nextMissing)}>
               Capture Next
             </Button>
          ) : (
             <Button variant="gold" className="flex-1 py-3.5 font-bold shadow-md text-[13px]" onClick={() => setTab('review')}>
               Review & Submit
             </Button>
          )}
        </div>
      </div>`;

content = content.replace(blockToReplace, newActionBarBlock);

fs.writeFileSync(path, content);
console.log('InspectionPage.tsx updated');
