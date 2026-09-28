const fs = require('fs')
let content = fs.readFileSync('src/pages/HomePage.tsx', 'utf8')
content = content.replace(/className=\{[\s\S]*?ext-\[14px\] font-bold[\s\S]*?\}/g, "className={	ext-[14px] font-bold }");
fs.writeFileSync('src/pages/HomePage.tsx', content)
