const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('import { SalesPlaybookPanel')) {
  content = content.replace("import { ReferralEnginePanel }", "import { SalesPlaybookPanel } from '@/components/SalesPlaybookPanel'\nimport { ReferralEnginePanel }");
  
  // Inject before DocumentCenter
  content = content.replace("<DocumentCenter", "<SalesPlaybookPanel leadScore={lead.score} />\n        <DocumentCenter");
  
  fs.writeFileSync(path, content);
  console.log('LeadPage.tsx updated with SalesPlaybookPanel');
}
