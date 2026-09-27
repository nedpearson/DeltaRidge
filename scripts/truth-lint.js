import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

// =============================================================================
// DELTA RIDGE TRUTH LINTER
// =============================================================================
// Catches functional mock data, fake statuses, dead controls, invented
// coordinates, and unverified provider states before they reach production.
//
// This linter does NOT ban legitimate UI placeholder text (e.g. <input placeholder="...">).
// It bans patterns that cause the SYSTEM to lie about what it did.
// =============================================================================

const BANNED_PATTERNS = [
  { pattern: /MOCK_/i, reason: 'Mock data marker' },
  { pattern: /PENDING_CONFIGURATION/i, reason: 'Unconfigured placeholder secret' },
  { pattern: /123 Main St/i, reason: 'Hardcoded fake address' },
  { pattern: /Austin, TX 78701/i, reason: 'Hardcoded fake city/zip' },
  { pattern: /Math\.random\(\).*(?:lat|lng|coord|position)/i, reason: 'Random coordinate generation' },
  { pattern: /alert\s*\(/i, reason: 'Raw alert() in production code' },
  { pattern: /tmpl_post_storm_front_v1/i, reason: 'Hardcoded fake template ID' },
  { pattern: /tmpl_just_installed_front_v1/i, reason: 'Hardcoded fake template ID' },
];

// Files explicitly allowed to use demo/training patterns
const ALLOW_LIST = [
  'src/pages/MemberPortal.tsx',
  'src/pages/TrainingSimulatorPage.tsx',
  'scripts/truth-lint.js',
];

// Directories to scan (production-relevant code)
const SCAN_DIRS = [
  'src',
  'supabase/functions',
  'supabase/migrations',
];

// File extensions to scan
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.sql', '.js'];

function getFiles(dir, files = []) {
  let list;
  try {
    list = readdirSync(dir);
  } catch {
    return files; // Directory doesn't exist, skip
  }
  for (const file of list) {
    const fullPath = join(dir, file);
    try {
      if (statSync(fullPath).isDirectory()) {
        getFiles(fullPath, files);
      } else if (SCAN_EXTENSIONS.some(ext => fullPath.endsWith(ext))) {
        files.push(fullPath);
      }
    } catch {
      // Skip inaccessible files
    }
  }
  return files;
}

// Gather all files from all scan directories
const allFiles = [];
for (const dir of SCAN_DIRS) {
  getFiles(dir, allFiles);
}

let failed = false;
const violations = [];

for (const file of allFiles) {
  const normalizedFile = file.replace(/\\/g, '/');
  if (ALLOW_LIST.some(allow => normalizedFile.endsWith(allow))) continue;

  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  for (const banned of BANNED_PATTERNS) {
    // Check each line individually so we can report line numbers
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip HTML input placeholder attributes — those are legitimate UX
      if (/placeholder\s*=\s*["']/.test(line)) continue;
      // Skip comments that document what was removed/why
      if (/^\s*(\/\/|\/\*|\*|--|#)/.test(line)) continue;

      if (banned.pattern.test(line)) {
        const violation = file + ':' + (i + 1) + ' — ' + banned.reason + ' (' + banned.pattern + ')';
        violations.push(violation);
        failed = true;
      }
    }
  }
}

if (failed) {
  console.error('\n╔══════════════════════════════════════════════════════════════╗');
  console.error('║  TRUTH LINT FAILED — ' + violations.length + ' violation(s) found                ║');
  console.error('╚══════════════════════════════════════════════════════════════╝\n');
  for (const v of violations) {
    console.error('  ✗ ' + v);
  }
  console.error('\nNo UI state may claim more than the backend can prove.');
  console.error('Fix these violations or add the file to the ALLOW_LIST if it is explicitly demo/training.\n');
  process.exit(1);
} else {
  console.log('Truth lint passed. Scanned ' + allFiles.length + ' files across ' + SCAN_DIRS.join(', ') + '.');
}
