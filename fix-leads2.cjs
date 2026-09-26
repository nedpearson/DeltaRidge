const fs = require('fs');
let c = fs.readFileSync('src/pages/LeadsPage.tsx', 'utf8');

c = c.replace(
  /\{callable !== null && \(\s*<div className="mt-3 flex items-center gap-2">\s*<a href=\{`tel:\$\{callable\}`\} className="contents">\s*<Button variant="secondary">Call<\/Button>\s*<\/a>\s*<a href=\{`sms:\$\{callable\}`\} className="contents">\s*<Button variant="secondary">Text<\/Button>\s*<\/a>\s*<\/div>\s*\)\}/g,
  `{(callable !== null || lead.contactEmail) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {callable !== null && (
              <>
                <a href={\`tel:\${callable}\`} className="contents">
                  <Button variant="secondary">Call</Button>
                </a>
                <a href={\`sms:\${callable}\`} className="contents">
                  <Button variant="secondary">Text</Button>
                </a>
              </>
            )}
            {lead.contactEmail && (
              <a href={\`mailto:\${lead.contactEmail}\`} className="contents">
                <Button variant="secondary">Email</Button>
              </a>
            )}
          </div>
        )}`
);

fs.writeFileSync('src/pages/LeadsPage.tsx', c);
