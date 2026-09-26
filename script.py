import re
with open('c:/dev/github/business/DeltaRidge/src/pages/EstimatePage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

replacement = '''<SectionTitle>PROPOSAL OPTIONS</SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card className="flex flex-col border-border-subtle bg-bg-app shadow-sm">
              <h3 className="text-[14px] font-semibold text-text-primary">GOOD</h3>
              <p className="text-[12px] text-text-secondary mt-1 flex-1">Standard Shingle, basic underlayment, 10-year workmanship.</p>
              <div className="mt-3 text-[18px] font-bold text-text-primary">{money(Math.round(built.recommended.price * 0.85) as Cents)}</div>
              <Button variant="secondary" className="mt-3 w-full text-[12px]">Select Option</Button>
            </Card>
            <Card className="flex flex-col border-brand-primary ring-1 ring-brand-primary/50 shadow-md relative mt-3 md:mt-0">
              <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-primary text-text-primary text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">Recommended</div>
              <h3 className="text-[14px] font-semibold text-brand-primary">BETTER</h3>
              <p className="text-[12px] text-text-secondary mt-1 flex-1">Architectural Shingle, synthetic underlayment, 25-year workmanship.</p>
              <div className="mt-3 text-[18px] font-bold text-text-primary">{money(built.recommended.price)}</div>
              <Button className="mt-3 w-full text-[12px]">Select Option</Button>
            </Card>
            <Card className="flex flex-col border-border-subtle bg-bg-app shadow-sm mt-3 md:mt-0">
              <h3 className="text-[14px] font-semibold text-gold-400">BEST</h3>
              <p className="text-[12px] text-text-secondary mt-1 flex-1">Premium Shingle, ice & water shield, lifetime warranty, premium accessories.</p>
              <div className="mt-3 text-[18px] font-bold text-text-primary">{money(Math.round(built.recommended.price * 1.25) as Cents)}</div>
              <Button variant="secondary" className="mt-3 w-full text-[12px]">Select Option</Button>
            </Card>
          </div>

          \g<0>'''

new_content = re.sub(r'^\s*<SectionTitle[^>]*>COST AND PRICE</SectionTitle>', replacement, content, flags=re.MULTILINE)

if new_content != content:
    with open('c:/dev/github/business/DeltaRidge/src/pages/EstimatePage.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('Replaced')
else:
    print('Not found')
