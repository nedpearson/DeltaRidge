const fs = require('fs');
let lines = fs.readFileSync('src/pages/HomePage.tsx', 'utf8').split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('ext-[14px] font-bold')) {
    lines[i] = "                <span className={	ext-[14px] font-bold }>";
  }
}
fs.writeFileSync('src/pages/HomePage.tsx', lines.join('\n'));
