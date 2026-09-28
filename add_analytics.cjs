const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/pages/ManagerPage.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('import { AnalyticsDrilldownPanel')) {
  content = content.replace("import { SectionTitle }", "import { SectionTitle }\nimport { AnalyticsDrilldownPanel } from '@/components/AnalyticsDrilldownPanel'");
  // If the previous replace failed because it wasn't exact, I'll put it at the top manually.
  if (content.indexOf("import { AnalyticsDrilldownPanel") === -1) {
      content = "import { AnalyticsDrilldownPanel } from '@/components/AnalyticsDrilldownPanel';\n" + content;
  }
  
  content = content.replace("</Card>\n    </div>\n  )\n}\n", "</Card>\n      <AnalyticsDrilldownPanel />\n    </div>\n  )\n}\n");
  
  fs.writeFileSync(path, content);
  console.log('ManagerPage.tsx updated with AnalyticsDrilldownPanel');
}
