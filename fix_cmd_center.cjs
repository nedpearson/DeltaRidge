const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/features/dashboard/useManagerCommandCenter.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace("select('user_id, created_at, type, leads(address)')", "select('user_id, occurred_at, activity_type, leads(address)')");
content = content.replace("order('created_at'", "order('occurred_at'");
content = content.replace(/act\.created_at/g, "act.occurred_at");
content = content.replace(/act\.type/g, "act.activity_type");

fs.writeFileSync(path, content);
console.log('Fixed useManagerCommandCenter.ts');
