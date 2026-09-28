const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/lib/env.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(" * nothing but a Supabase URL and key. A missing Mapbox token degrades the map;", " * nothing but a Supabase URL and key. Missing tokens gracefully degrade features;");
content = content.replace("  VITE_MAPBOX_PUBLIC_TOKEN: z.string().optional(),\n", "");
content = content.replace("    'VITE_MAPBOX_SECRET_TOKEN',\n", "");

fs.writeFileSync(path, content);
console.log('Fixed env.ts');
