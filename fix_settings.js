const fs = require('fs')
let content = fs.readFileSync('src/pages/SettingsPage.tsx', 'utf8')
content = content.replace(/className=\{\\\f/g, "className={");
content = content.replace(/\\\\\}/g, "}");
fs.writeFileSync('src/pages/SettingsPage.tsx', content)
