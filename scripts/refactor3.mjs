import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

const replacements = [
  // CSS vars text
  { regex: /text-\[var\(--color-ink\)\]/g, replace: 'text-text-primary' },
  { regex: /text-\[var\(--color-surface-2\)\]/g, replace: 'text-text-primary' }, // surface-2 was white originally

  // CSS vars bg
  { regex: /bg-\[var\(--color-surface\)\]\/[0-9]+/g, replace: 'bg-bg-app' }, // remove opacity for backdrop blur on deepest bg? Let's just do bg-bg-app
  { regex: /bg-\[var\(--color-surface\)\]/g, replace: 'bg-bg-app' },
  { regex: /bg-\[var\(--color-surface-2\)\]/g, replace: 'bg-bg-card' },
  { regex: /bg-\[var\(--color-surface-3\)\]/g, replace: 'bg-bg-elevated' },
  { regex: /bg-\[\#e8e6e1\]/g, replace: 'bg-bg-elevated' },
  { regex: /bg-\[\#1b2740\]/g, replace: 'bg-bg-card' },
  
  // Rings
  { regex: /\bring-slate-200\b/g, replace: 'ring-border-subtle' },
  { regex: /\bring-slate-300\b/g, replace: 'ring-border-subtle' },
  { regex: /\bring-sky-300\b/g, replace: 'ring-brand-primary' },
  
  // Focus rings
  { regex: /\bfocus:ring-brand-400\b/g, replace: 'focus:ring-brand-primary' },
  { regex: /\bfocus:ring-brand-500\b/g, replace: 'focus:ring-brand-primary' },
  { regex: /\bfocus:border-brand-500\b/g, replace: 'focus:border-brand-primary' },
  
  // Leftover slate
  { regex: /\btext-slate-60070\b/g, replace: 'text-text-secondary' }, // typo seen in output
  
];

let changedFiles = 0;

walkDir('src', function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    for (const { regex, replace } of replacements) {
      content = content.replace(regex, replace);
    }

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      changedFiles++;
    }
  }
});

console.log(`Updated ${changedFiles} files in refactor 3.`);
