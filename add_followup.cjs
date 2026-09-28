const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('import { StructuredFollowUpPanel')) {
  content = content.replace("import NextBestActionPanel", "import { StructuredFollowUpPanel, LostReasonIntelligence } from '@/components/StructuredFollowUpPanel'\nimport NextBestActionPanel");
  
  // Inject before DocumentCenter
  content = content.replace("<DocumentCenter", "<StructuredFollowUpPanel lead={lead} />\n        <LostReasonIntelligence />\n        <DocumentCenter");
  
  fs.writeFileSync(path, content);
  console.log('LeadPage.tsx updated with StructuredFollowUpPanel');
}
