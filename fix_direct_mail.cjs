const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/supabase/functions/trigger-direct-mail/index.ts';
let content = fs.readFileSync(path, 'utf8');

const regex = /if \(!LOB_API_KEY\) \{[\s\S]*?if \(data\) LOB_API_KEY = data\.secret_value;\r?\n\s*\}/m;
content = content.replace(regex, "");

// 10. Fix direct-mail webhook authentication mismatch.
// Edge Function -> compare against AUTOMATION_SECRET
const regexAuth = /if \(!authHeader \|\| authHeader !== \`Bearer \$\{serviceKey\}\`\) \{/m;
content = content.replace(regexAuth, "const automationSecret = Deno.env.get('AUTOMATION_SECRET') || serviceKey;\n    if (!authHeader || authHeader !== `Bearer ${automationSecret}`) {");

fs.writeFileSync(path, content);
console.log('Fixed trigger-direct-mail');
