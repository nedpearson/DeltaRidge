const fs = require('fs');
let lines = fs.readFileSync('src/pages/HomePage.tsx', 'utf8').split('\n');
lines[103] = "                <span className={	ext-[14px] font-bold }>\r";
fs.writeFileSync('src/pages/HomePage.tsx', lines.join('\n'));
