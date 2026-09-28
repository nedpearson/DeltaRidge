const fs = require('fs');

const leadMap = 'c:/dev/github/business/DeltaRidge/src/components/LeadMapLive.tsx';
let lm = fs.readFileSync(leadMap, 'utf8');
lm = lm.replace(/, onFailed/g, "");
fs.writeFileSync(leadMap, lm);

const settings = 'c:/dev/github/business/DeltaRidge/src/pages/SettingsPage.tsx';
let setts = fs.readFileSync(settings, 'utf8');
setts = setts.replace(/import \{ useState \} from 'react'\n/, "");
setts = setts.replace(/import \{ Card, SectionTitle, Button \} from '@\/components\/ui'/, "import { Card, SectionTitle } from '@/components/ui'");
setts = setts.replace(/import \{ KeyRound, ShieldAlert, CheckCircle2 \} from 'lucide-react'/, "import { ShieldAlert, CheckCircle2 } from 'lucide-react'");
setts = setts.replace(/import \{ PageHeader \} from '@\/components\/PageHeader'\n/, "");
setts = setts.replace(/<PageHeader title="Settings" subtitle="System configuration and integrations" \/>\n/, "");
fs.writeFileSync(settings, setts);

console.log('Fixed build errors');
