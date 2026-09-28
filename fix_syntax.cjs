const fs = require('fs');

// Fix ContentCalendarView.tsx
let content = fs.readFileSync('src/features/social/components/ContentCalendarView.tsx', 'utf8');
content = content.replace("className={px-4 py-2 rounded-full text-sm font-medium }", "className={px-4 py-2 rounded-full text-sm font-medium }");
content = content.replace("className={px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider }", "className={px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider }");
fs.writeFileSync('src/features/social/components/ContentCalendarView.tsx', content);

// Fix HomePage.tsx
content = fs.readFileSync('src/pages/HomePage.tsx', 'utf8');
content = content.replace(/className=\{\t/g, 'className={	');
content = content.replace(/ext-\[14px\] font-bold \}/g, "ext-[14px] font-bold }");
fs.writeFileSync('src/pages/HomePage.tsx', content);

