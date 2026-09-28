const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/features/integrations/roofr/RoofrPanel.tsx';
let content = fs.readFileSync(path, 'utf8');

const actionsBlock = `
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {link.workflowStage !== null && (
              <span className="rounded bg-gold-400/15 px-2 py-0.5 text-sm text-gold-300">
                {link.workflowStage}
              </span>
            )}
            {link.roofrJobId !== null && (
              <span className="text-xs text-text-secondary">Roofr job {link.roofrJobId}</span>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1 text-[11px] uppercase tracking-wide" onClick={() => void alert('Measurement report ordered from Roofr.')} disabled={!!link.reportOrderedAt}>
              {link.reportOrderedAt ? 'Report Ordered' : 'Order Report'}
            </Button>
            <Button variant="secondary" className="flex-1 text-[11px] uppercase tracking-wide" onClick={() => void alert('Proposal draft generated.')} disabled={!!link.proposalSentAt}>
               {link.proposalSentAt ? 'Proposal Sent' : 'Draft Proposal'}
            </Button>
          </div>
`;

content = content.replace(`
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {link.workflowStage !== null && (
              <span className="rounded bg-gold-400/15 px-2 py-0.5 text-sm text-gold-300">
                {link.workflowStage}
              </span>
            )}
            {link.roofrJobId !== null && (
              <span className="text-xs text-text-secondary">Roofr job {link.roofrJobId}</span>
            )}
          </div>`, actionsBlock);

fs.writeFileSync(path, content);
console.log('RoofrPanel.tsx updated with deep-dive actions');
