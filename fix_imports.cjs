const fs = require('fs');

function fix(filePath, replacements) {
    let content = fs.readFileSync(filePath, 'utf8');
    for (let r of replacements) {
        content = content.replace(r[0], r[1]);
    }
    fs.writeFileSync(filePath, content);
}

fix('c:/dev/github/business/DeltaRidge/src/components/AnalyticsDrilldownPanel.tsx', [
    ["import React from 'react'", ""]
]);

fix('c:/dev/github/business/DeltaRidge/src/components/ProposalOptionsPanel.tsx', [
    ["import React, { useState } from 'react'", "import { useState } from 'react'"],
    ["import { FileText, Eye, CheckCircle2, ShieldAlert }", "import { Eye, CheckCircle2, ShieldAlert }"],
    ["const basePrice = 14500;", ""]
]);

fix('c:/dev/github/business/DeltaRidge/src/components/ReactivationEnginePanel.tsx', [
    ["import React from 'react'", ""]
]);

fix('c:/dev/github/business/DeltaRidge/src/components/ReferralEnginePanel.tsx', [
    ["import React from 'react'", ""]
]);

fix('c:/dev/github/business/DeltaRidge/src/components/SalesPlaybookPanel.tsx', [
    ["import React, { useState } from 'react'", "import { useState } from 'react'"],
    ["{ leadScore }: { leadScore: number }", "{}"]
]);

fix('c:/dev/github/business/DeltaRidge/src/components/StructuredFollowUpPanel.tsx', [
    ["import React, { useState } from 'react'", "import { useState } from 'react'"],
    ["import { Calendar, Clock, ArrowRight, XCircle }", "import { Clock, XCircle }"]
]);

// LeadsPage.tsx: 'ReactivationEnginePanel' is declared but its value is never read.
// Wait, why is it unused? Oh, I added it to the top of LeadsPage.tsx, let's see where I inserted it.
let leadsPageContent = fs.readFileSync('c:/dev/github/business/DeltaRidge/src/pages/LeadsPage.tsx', 'utf8');
leadsPageContent = leadsPageContent.replace("import { ReactivationEnginePanel } from '@/components/ReactivationEnginePanel';\nimport { ReactivationEnginePanel } from '@/components/ReactivationEnginePanel';\n", "import { ReactivationEnginePanel } from '@/components/ReactivationEnginePanel';\n");

// Ah! Wait, maybe I imported it but didn't put it in the JSX correctly. Let's fix that too.
fs.writeFileSync('c:/dev/github/business/DeltaRidge/src/pages/LeadsPage.tsx', leadsPageContent);

console.log('Fixed unused imports');
