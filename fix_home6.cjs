const fs = require('fs');
let lines = fs.readFileSync('src/pages/HomePage.tsx', 'utf8').split('\n');
lines.splice(44, 0, \      {!session && (
        <Card className="border border-brand-500/30 bg-brand-500/5 p-4 flex flex-col gap-3">
          <div>
            <h3 className="font-bold text-text-primary text-[14px]">You are not signed in</h3>
            <p className="text-[12px] text-text-secondary mt-1">Your work is saved locally, but sign in to access your assigned leads and push data to the office.</p>
          </div>
          <Button variant="primary" onClick={() => navigate('/more')}>Sign In</Button>
        </Card>
      )}\);
fs.writeFileSync('src/pages/HomePage.tsx', lines.join('\n'));
