const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/ManagerPage.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes("import React ")) {
  content = "import React from 'react';\n" + content;
  fs.writeFileSync(path, content);
  console.log('Added React import');
}
