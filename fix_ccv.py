import re

def fix_content_calendar():
    with open('src/features/social/components/ContentCalendarView.tsx', 'r') as f:
        content = f.read()
    
    content = re.sub(r'className=\{px-4 py-2 rounded-full text-sm font-medium\s*\}', r'className={px-4 py-2 rounded-full text-sm font-medium }', content)
    
    content = re.sub(r'className=\{px-1\.5 py-0\.5 rounded-md text-\[10px\] font-bold uppercase tracking-wider\s*\}', r'className={px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider }', content)

    with open('src/features/social/components/ContentCalendarView.tsx', 'w') as f:
        f.write(content)

fix_content_calendar()
