const fs = require('fs');
let content = fs.readFileSync('supabase/functions/generate-intelligence-brief/index.ts', 'utf8');
content = content.replace("intelligenceBrief = json", "intelligenceBrief = json");
content = content.replace("intelligenceBrief = \"Failed", "intelligenceBrief = \"Failed");
fs.writeFileSync('supabase/functions/generate-intelligence-brief/index.ts', content);
