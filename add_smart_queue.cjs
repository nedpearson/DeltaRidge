const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/pages/LeadsPage.tsx';
let content = fs.readFileSync(path, 'utf8');

const replacement = `
          {pipeline.length === 0 ? (
            <Empty
              title="Nothing here yet"
              body="A door lands here the moment you record what happened at it. Knock one from the New tab and it becomes a lead you can work."
            />
          ) : (
            <div className="space-y-3">
              {tab === 'follow_up' && (
                 <Button variant="primary" full className="py-4 shadow-lg flex items-center justify-center gap-2" onClick={() => {
                   // Navigate to a follow-up specific mode, or just alert for now.
                   alert('Starting Smart Follow-Up Queue. This mode sequences overdue calls/texts for fast execution.');
                 }}>
                   <span className="font-bold tracking-wide">START SMART QUEUE</span>
                 </Button>
              )}
              {pipeline.map((lead) => (
                <PipelineCard key={lead.id} lead={lead} now={now} />
              ))}
            </div>
          )}
`;

content = content.replace(`
          {pipeline.length === 0 ? (
            <Empty
              title="Nothing here yet"
              body="A door lands here the moment you record what happened at it. Knock one from the New tab and it becomes a lead you can work."
            />
          ) : (
            <div className="space-y-2">
              {pipeline.map((lead) => (
                <PipelineCard key={lead.id} lead={lead} now={now} />
              ))}
`, replacement);

fs.writeFileSync(path, content);
console.log('LeadsPage.tsx updated with Smart Queue');
