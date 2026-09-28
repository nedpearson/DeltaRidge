const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/features/leads/pipeline.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /export type LeadStatus =[\s\S]*?\| 'do_not_knock'/,
  `export type LeadStatus = 
  | 'generated'
  | 'assigned'
  | 'attempted'
  | 'reached'
  | 'interested'
  | 'inspection_requested'
  | 'appointment'
  | 'inspected'
  | 'estimate_proposal'
  | 'won'
  | 'lost'
  | 'nurture'
  | 'customer'
  | 'roofcare'
  // Legacy aliases to keep old code compiling temporarily while we migrate
  | 'new'
  | 'follow_up'
  | 'need_visit'
  | 'not_interested'
  | 'disqualified'
  | 'do_not_knock'`
);

content = content.replace(
  /export const STATUS_LABEL: Record<LeadStatus, string> = {[\s\S]*?}/,
  `export const STATUS_LABEL: Record<LeadStatus, string> = {
  generated: 'Generated',
  assigned: 'Assigned',
  attempted: 'Attempted',
  reached: 'Reached',
  interested: 'Interested',
  inspection_requested: 'Inspection Requested',
  appointment: 'Appointment',
  inspected: 'Inspected',
  estimate_proposal: 'Estimate / Proposal',
  won: 'Won',
  lost: 'Lost',
  nurture: 'Nurture',
  customer: 'Customer',
  roofcare: 'RoofCare',
  
  // Legacy
  new: 'New',
  follow_up: 'Follow-up',
  need_visit: 'Needs a visit',
  not_interested: 'Not interested',
  disqualified: 'Not a prospect',
  do_not_knock: 'Do not knock',
}`
);

fs.writeFileSync(path, content);
console.log('pipeline.ts patched');
