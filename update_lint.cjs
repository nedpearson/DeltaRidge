const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/scripts/truth-lint.js';
if (fs.existsSync(path)) {
    let content = fs.readFileSync(path, 'utf8');
    const newPatterns = `  { pattern: /Coming Soon/i, message: "Do not expose unfinished features in production." },
  { pattern: /example\\.com\\/mock/i, message: "Do not use mock URLs." },
  { pattern: /as if sent/i, message: "Do not simulate sending." },
  { pattern: /Simulate upload/i, message: "Do not simulate uploads." },
  { pattern: /For Phase 2/i, message: "Do not leave placeholder phase 2 comments." },
  { pattern: /TODO:\\s*provider/i, message: "Do not leave TODOs for providers in live modules." },\n`;
    
    content = content.replace(/(const patterns = \[\s*)/, "$1" + newPatterns);
    fs.writeFileSync(path, content);
    console.log('Updated truth-lint.js');
} else {
    console.log('truth-lint.js not found');
}
