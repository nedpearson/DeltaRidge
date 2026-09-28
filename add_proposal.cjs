const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('import { ProposalOptionsPanel')) {
  content = content.replace("import NextBestActionPanel", "import { ProposalOptionsPanel } from '@/components/ProposalOptionsPanel'\nimport NextBestActionPanel");
  
  // Inject before DocumentCenter
  content = content.replace("<DocumentCenter", "<ProposalOptionsPanel />\n        <DocumentCenter");
  
  fs.writeFileSync(path, content);
  console.log('LeadPage.tsx updated with ProposalOptionsPanel');
}
