const fs = require('fs');
let c = fs.readFileSync('src/pages/SubdivisionPage.tsx', 'utf8');
c = c.replace(/\\\`/g, '`').replace(/\\\$/g, '$');
fs.writeFileSync('src/pages/SubdivisionPage.tsx', c);
