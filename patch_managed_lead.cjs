const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/features/leads/pipeline.ts';
let content = fs.readFileSync(path, 'utf8');

const additionalFields = `
  // -- SPEED TO LEAD ENGINE --
  assignedAt?: string
  firstAttemptAt?: string
  firstContactAt?: string
  
  // -- ENGAGEMENT & TRACKING --
  proposalState?: 'sent' | 'delivered' | 'viewed' | 'signed' | 'declined' | 'expired'
  proposalSentAt?: string
  proposalViewedAt?: string
  proposalSignedAt?: string
  
  // -- OBJECTIONS & LOST REASONS --
  lostReason?: 'price' | 'competitor' | 'timing' | 'insurance' | 'no_damage' | 'no_response' | 'financing' | 'homeowner_declined' | 'duplicate' | 'other'
  objections?: ('too_expensive' | 'spouse_decision' | 'already_has_roofer' | 'wants_insurance_first' | 'not_enough_damage' | 'timing' | 'financing' | 'distrust' | 'no_urgency')[]
  
  // -- REFERRALS & CUSTOMER LIFETIME --
  referredBy?: string
  isRoofCareMember?: boolean
`;

content = content.replace(/(export interface ManagedLead \{[\s\S]*?)(^\})/m, `$1${additionalFields}$2`);

fs.writeFileSync(path, content);
console.log('Patched ManagedLead with new fields');
