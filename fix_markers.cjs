const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/features/leads/markers.ts';
let content = fs.readFileSync(path, 'utf8');

const replacement = `export const MARKER_COLOR: Record<MarkerStatus, string> = {
  door: 'var(--color-bg-elevated)',
  
  generated: 'var(--color-bg-elevated)',
  assigned: 'var(--color-bg-elevated)',
  attempted: 'var(--color-status-noanswer)',
  reached: 'var(--color-status-spoke)',
  interested: 'var(--color-status-interested)',
  inspection_requested: 'var(--color-status-interested)',
  appointment: 'var(--color-status-appointment)',
  inspected: 'var(--color-status-appointment)',
  estimate_proposal: 'var(--color-status-appointment)',
  won: 'var(--color-brand-400)',
  lost: 'var(--color-status-lost)',
  nurture: 'var(--color-status-lost)',
  customer: 'var(--color-brand-400)',
  roofcare: 'var(--color-brand-400)',

  // Legacy
  new: 'var(--color-bg-elevated)',
  follow_up: 'var(--color-status-interested)',
  need_visit: 'var(--color-status-appointment)',
  not_interested: 'var(--color-status-lost)',
  disqualified: 'var(--color-status-dnc)',
  do_not_knock: 'var(--color-status-dnc)',
}`;

content = content.replace(/export const MARKER_COLOR: Record<MarkerStatus, string> = \{[\s\S]*?\}/, replacement);

fs.writeFileSync(path, content);
console.log('Fixed markers.ts');
