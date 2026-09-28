const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/pages/ManagerPage.tsx';
let content = fs.readFileSync(path, 'utf8');

const coachingInsightBlock = `
        <div className="border-t border-border-subtle pt-3 grid grid-cols-4 gap-2 text-center text-[11px] font-semibold text-brand-gold">
          <div>{leadToAppt}%</div>
          <div>{apptToProposal}%</div>
          <div>{proposalToJob}%</div>
          <div>{totalConversion}%</div>
        </div>
      </Card>
      
      {/* CONVERSION COACHING INSIGHTS */}
      <Card className="border-l-4 border-l-brand-400 bg-bg-card shadow-sm mt-4">
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
`;

content = content.replace(`
        <div className="border-t border-border-subtle pt-3 grid grid-cols-4 gap-2 text-center text-[11px] font-semibold text-brand-gold">
          <div>{leadToAppt}%</div>
          <div>{apptToProposal}%</div>
          <div>{proposalToJob}%</div>
          <div>{totalConversion}%</div>
        </div>
      </Card>`, coachingInsightBlock);

fs.writeFileSync(path, content);
console.log('ManagerPage.tsx updated with coaching insights');
