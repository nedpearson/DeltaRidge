const fs = require('fs')
let content = fs.readFileSync('src/pages/HomePage.tsx', 'utf8')
content = content.replace("className={\text-[14px] font-bold }", "className={	ext-[14px] font-bold }")
fs.writeFileSync('src/pages/HomePage.tsx', content)
