const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf8');
c = c.replace("import LeadsPage from '@/pages/LeadsPage'", "import LeadsPage from '@/pages/LeadsPage'\nimport SubdivisionPage from '@/pages/SubdivisionPage'");
c = c.replace('<Route path="/leads" element={<LeadsPage />} />', '<Route path="/leads" element={<LeadsPage />} />\n                        <Route path="/subdivisions/:name" element={<SubdivisionPage />} />');
fs.writeFileSync('src/App.tsx', c);
