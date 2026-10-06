const fs = require('fs');
let content = fs.readFileSync('src/pages/LeadsPage.tsx', 'utf8');

content = content.replace(/p_opportunity_filter: 'ALL'/, 'p_opportunity_filter: filter');
content = content.replace(/}, \[coords\]\)/, '}, [coords, filter])');

const regex = /const filteredProperties = properties\.filter\(p => \{[\s\S]*?return true;\s*\}\);/;
content = content.replace(regex, 'const filteredProperties = properties;');

fs.writeFileSync('src/pages/LeadsPage.tsx', content);
