const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/features/leads/markers.ts';
let content = fs.readFileSync(path, 'utf8');

const replacement = `export const COLOUR: Record<MarkerStatus, string> = {
  door: '#475569',
  
  generated: '#475569',
  assigned: '#475569',
  attempted: '#d97706',
  reached: '#d97706',
  interested: '#2563eb',
  inspection_requested: '#2563eb',
  appointment: '#059669',
  inspected: '#059669',
  estimate_proposal: '#059669',
  won: '#10b981',
  lost: '#dc2626',
  nurture: '#64748b',
  customer: '#10b981',
  roofcare: '#10b981',

  // Legacy
  new: '#475569',
  follow_up: '#d97706',
  need_visit: '#2563eb',
  not_interested: '#dc2626',
  disqualified: '#64748b',
  do_not_knock: '#dc2626',
}`;

content = content.replace(/export const COLOUR: Record<MarkerStatus, string> = \{[\s\S]*?\}/, replacement);

fs.writeFileSync(path, content);
console.log('Fixed markers.ts');
