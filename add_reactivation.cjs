const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/LeadsPage.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('import { ReactivationEnginePanel')) {
  content = "import { ReactivationEnginePanel } from '@/components/ReactivationEnginePanel';\n" + content;
  content = content.replace("</div>\n    </div>\n  )\n}", "</div>\n      <ReactivationEnginePanel />\n    </div>\n  )\n}");
  fs.writeFileSync(path, content);
  console.log('LeadsPage.tsx updated with ReactivationEnginePanel');
}
