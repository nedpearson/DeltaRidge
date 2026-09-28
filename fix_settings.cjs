const fs = require('fs')
let content = fs.readFileSync('src/pages/SettingsPage.tsx', 'utf8')
content = content.replace(/className=\{[\s\S]*?lex items-center gap-2 text-\[12px\] font-bold[\s\S]*?\}/g, (match, offset, string) => {
  if (string.substring(offset - 50, offset).includes("OpenAI")) return "className={lex items-center gap-2 text-[12px] font-bold }";
  if (string.substring(offset - 50, offset).includes("Meta")) return "className={lex items-center gap-2 text-[12px] font-bold }";
  if (string.substring(offset - 50, offset).includes("Twilio")) return "className={lex items-center gap-2 text-[12px] font-bold }";
  return match;
});
fs.writeFileSync('src/pages/SettingsPage.tsx', content)
