const fs = require('fs');
let content = fs.readFileSync('c:/dev/github/business/DeltaRidge/src/pages/LeadsPage.tsx', 'utf8');
content = content.replace("import { ReactivationEnginePanel } from '@/components/ReactivationEnginePanel';\n", "");
fs.writeFileSync('c:/dev/github/business/DeltaRidge/src/pages/LeadsPage.tsx', content);
