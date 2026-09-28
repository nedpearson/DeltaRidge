const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('import NextBestActionPanel')) {
  content = content.replace("import ContactActions from '@/components/ContactActions'", "import ContactActions from '@/components/ContactActions'\nimport NextBestActionPanel from '@/components/NextBestActionPanel'");
  
  content = content.replace("<SectionTitle>REACH THEM</SectionTitle>", "<NextBestActionPanel lead={lead} />\n      <SectionTitle>REACH THEM</SectionTitle>");
  
  fs.writeFileSync(path, content);
  console.log('LeadPage.tsx updated with NextBestActionPanel');
}
