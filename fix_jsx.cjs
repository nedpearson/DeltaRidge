const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/ManagerPage.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace("Appt -> Proposal", "Appt -&gt; Proposal");
content = content.replace("Proposal -> Won", "Proposal -&gt; Won");

fs.writeFileSync(path, content);
console.log('Fixed JSX syntax error');
