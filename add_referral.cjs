const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('import { ReferralEnginePanel')) {
  content = content.replace("import { ProposalOptionsPanel }", "import { ReferralEnginePanel } from '@/components/ReferralEnginePanel'\nimport { ProposalOptionsPanel }");
  
  // Inject before DocumentCenter
  content = content.replace("<DocumentCenter", "<ReferralEnginePanel status={lead.status} />\n        <DocumentCenter");
  
  fs.writeFileSync(path, content);
  console.log('LeadPage.tsx updated with ReferralEnginePanel');
}
