const fs = require('fs');
let c = fs.readFileSync('src/pages/LeadsPage.tsx', 'utf8');

const target = `{callable !== null && (
          <div className="mt-3 flex items-center gap-2">
            <a href={\`tel:\${callable}\`} className="contents">
              <Button variant="secondary">Call</Button>
            </a>
            <a href={\`sms:\${callable}\`} className="contents">
              <Button variant="secondary">Text</Button>
            </a>
          </div>
        )}`;

const replacement = `{(callable !== null || lead.contactEmail) && (
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
        )}`;

c = c.replace(target, replacement);

fs.writeFileSync('src/pages/LeadsPage.tsx', c);
