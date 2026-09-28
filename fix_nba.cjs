const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/components/NextBestActionPanel.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/alert\s*\(/g, "console.log(");

fs.writeFileSync(path, content);
console.log('Fixed NextBestActionPanel again');
