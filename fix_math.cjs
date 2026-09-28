const fs = require('fs');

const path = 'c:/dev/github/business/DeltaRidge/src/pages/ManagerPage.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/step\.count \/ funnel\[0\]\?\.count/g, "step.count / (funnel[0]?.count || 1)");

fs.writeFileSync(path, content);
console.log('Fixed math undefined');
