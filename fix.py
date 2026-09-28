import re

def fix_content_calendar():
    with open('src/features/social/components/ContentCalendarView.tsx', 'r') as f:
        content = f.read()
    content = content.replace(
        "className={px-4 py-2 rounded-full text-sm font-medium }",
        "className={px-4 py-2 rounded-full text-sm font-medium }"
    )
    content = content.replace(
        "className={px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider }",
        "className={px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider }"
    )
    with open('src/features/social/components/ContentCalendarView.tsx', 'w') as f:
        f.write(content)

def fix_home_page():
    with open('src/pages/HomePage.tsx', 'r') as f:
        content = f.read()
    
    # We will just replace ALL instances of the bad span tab bug.
    # The syntax error spans from lines 93-104 where there is a tab character
    # span className={	ext-[14px] font-bold }
    
    import re
    content = re.sub(r'className=\{\t?ext-\[14px\] font-bold\s*\}', r'className="text-[14px] font-bold text-text-primary"', content)
    with open('src/pages/HomePage.tsx', 'w') as f:
        f.write(content)

fix_content_calendar()
fix_home_page()
