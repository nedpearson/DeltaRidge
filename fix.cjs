const fs = require('fs');
let c = fs.readFileSync('src/components/ResidentPhoneCard.tsx', 'utf8');

c = c.replace(
  /\{loading[\s\S]*?\?\s*['"](.*?)['"][\s\S]*?:\s*\(resident \|\| ownerName\)/g,
  '{loading ? \'⚡ Auto-enriching phone number...\' : errorMsg ? \'Skip-Tracing Failed\' : (resident || ownerName)'
);

c = c.replace(
  /\{loading \? ['"](.*?)['"] : ['"]Automated skip-trace & reverse directory['"]\}/g,
  '{loading ? \'Querying skip-trace records...\' : errorMsg ? (<span className="text-status-critical">{errorMsg}</span>) : \'Automated skip-trace & reverse directory\'}'
);

c = c.replace(
  /<a\s+href=\{freeSearchUrl\}[\s\S]*?<\/a>/g,
  '{!errorMsg && (<a href={freeSearchUrl} target="_blank" rel="noreferrer" className="contents"><Button variant="secondary" className="!px-2.5 !py-1 text-[11px]">🔍 Look Up</Button></a>)}'
);

fs.writeFileSync('src/components/ResidentPhoneCard.tsx', c);
