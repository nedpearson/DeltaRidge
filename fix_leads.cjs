const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/lib/sync/leads.ts';
let content = fs.readFileSync(path, 'utf8');

const replacement = `export function remoteLeadStatus(status: LeadStatus): string {
  switch (status) {
    case 'generated': return 'target'
    case 'assigned': return 'target'
    case 'attempted': return 'no_answer'
    case 'reached': return 'spoke'
    case 'interested': return 'spoke'
    case 'inspection_requested': return 'inspection_requested'
    case 'appointment': return 'appointment'
    case 'inspected': return 'inspected'
    case 'estimate_proposal': return 'proposal'
    case 'won': return 'won'
    case 'lost': return 'lost'
    case 'nurture': return 'nurture'
    case 'customer': return 'won'
    case 'roofcare': return 'won'
    
    // Legacy
    case 'new': return 'target'
    case 'follow_up': return 'spoke'
    case 'need_visit': return 'inspection_requested'
    case 'not_interested': return 'not_interested'
    case 'disqualified': return 'disqualified'
    case 'do_not_knock': return 'do_not_knock'
    
    default: return 'target'
  }
}`;

content = content.replace(/export function remoteLeadStatus\(status: LeadStatus\): string \{[\s\S]*?(?=\n\n|\nfunction |\nexport)/, replacement);

fs.writeFileSync(path, content);
console.log('Fixed leads.ts');
