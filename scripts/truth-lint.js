import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const BANNED_PATTERNS = [
  /MOCK_/i,
  /123 Main St/i,
  /Coming Soon/i
];

const ALLOW_LIST = [
  'src/pages/MemberPortal.tsx',
  'src/pages/TrainingSimulatorPage.tsx'
];

function getFiles(dir, files = []) {
  const list = readdirSync(dir);
  for (const file of list) {
    const fullPath = join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      getFiles(fullPath, files);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = getFiles('src');
let failed = false;

for (const file of files) {
  const normalizedFile = file.replace(/\\/g, '/');
  if (ALLOW_LIST.some(allow => normalizedFile.endsWith(allow))) continue;

  const content = readFileSync(file, 'utf8');
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(content)) {
      console.error('\n[Truth Lint Error] Found banned pattern ' + pattern + ' in ' + file);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nProduction modules must not contain mock data or placeholders. Failing CI.');
  process.exit(1);
} else {
  console.log('Truth lint passed.');
}
