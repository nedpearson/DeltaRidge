const fs = require('fs');
let lines = fs.readFileSync('src/pages/HomePage.tsx', 'utf8').split(/\r?\n/);
let out = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('ext-[14px] font-bold')) {
    out.push("                <span className={	ext-[14px] font-bold }>");
  } else {
    out.push(lines[i]);
  }
}
fs.writeFileSync('src/pages/HomePage.tsx', out.join('\n'));
