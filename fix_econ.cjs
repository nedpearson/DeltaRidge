const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/features/dashboard/useLeadEconomics.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace("select('type')", "select('activity_type')");
content = content.replace(/act\.type/g, "act.activity_type");

fs.writeFileSync(path, content);
console.log('Fixed useLeadEconomics.ts');
