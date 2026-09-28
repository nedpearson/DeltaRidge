const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/LeadPage.tsx';
let content = fs.readFileSync(path, 'utf8');
content = content.replace("<SalesPlaybookPanel leadScore={lead.score} />", "<SalesPlaybookPanel />");
fs.writeFileSync(path, content);
console.log('Fixed LeadPage playbook props');
