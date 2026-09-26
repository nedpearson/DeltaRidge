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
  // Backgrounds
  { regex: /\bbg-surface\b/g, replace: 'bg-bg-app' },
  { regex: /\bbg-surface-2\b/g, replace: 'bg-bg-card' },
  { regex: /\bbg-surface-3\b/g, replace: 'bg-bg-elevated' },
  { regex: /\bbg-white\b/g, replace: 'bg-bg-card' },
  { regex: /\bbg-slate-50\b/g, replace: 'bg-bg-app' },
  { regex: /\bbg-slate-100\b/g, replace: 'bg-bg-page' },
  { regex: /\bbg-slate-200\b/g, replace: 'bg-bg-elevated' },
  { regex: /\bbg-slate-800\b/g, replace: 'bg-bg-page' },
  { regex: /\bbg-slate-900\b/g, replace: 'bg-bg-app' },
  { regex: /\bbg-gray-50\b/g, replace: 'bg-bg-app' },
  { regex: /\bbg-gray-100\b/g, replace: 'bg-bg-page' },
  { regex: /\bbg-gray-800\b/g, replace: 'bg-bg-card' },
  { regex: /\bbg-gray-900\b/g, replace: 'bg-bg-app' },

  // Brand backgrounds
  { regex: /\bbg-brand-50\b/g, replace: 'bg-brand-primary/10' },
  { regex: /\bbg-brand-100\b/g, replace: 'bg-brand-primary/20' },
  { regex: /\bbg-brand-500\b/g, replace: 'bg-brand-primary' },
  { regex: /\bbg-brand-600\b/g, replace: 'bg-brand-primary' },
  { regex: /\bbg-brand-700\b/g, replace: 'bg-brand-hover' },
  { regex: /\bbg-brand-800\b/g, replace: 'bg-brand-pressed' },
  { regex: /\bbg-brand-900\b/g, replace: 'bg-brand-pressed' },
  { regex: /\bbg-blue-500\b/g, replace: 'bg-brand-primary' },
  { regex: /\bbg-blue-600\b/g, replace: 'bg-brand-primary' },
  { regex: /\bhover:bg-brand-600\b/g, replace: 'hover:bg-brand-hover' },
  { regex: /\bhover:bg-blue-600\b/g, replace: 'hover:bg-brand-hover' },
  { regex: /\bhover:bg-brand-700\b/g, replace: 'hover:bg-brand-hover' },
  { regex: /\bhover:bg-blue-700\b/g, replace: 'hover:bg-brand-hover' },

  // Text colors
  { regex: /\btext-ink\b/g, replace: 'text-text-primary' },
  { regex: /\btext-muted\b/g, replace: 'text-text-muted' },
  { regex: /\btext-slate-900\b/g, replace: 'text-text-primary' },
  { regex: /\btext-slate-800\b/g, replace: 'text-text-primary' },
  { regex: /\btext-slate-700\b/g, replace: 'text-text-secondary' },
  { regex: /\btext-slate-600\b/g, replace: 'text-text-secondary' },
  { regex: /\btext-slate-500\b/g, replace: 'text-text-muted' },
  { regex: /\btext-slate-400\b/g, replace: 'text-text-muted' },
  { regex: /\btext-gray-900\b/g, replace: 'text-text-primary' },
  { regex: /\btext-gray-800\b/g, replace: 'text-text-primary' },
  { regex: /\btext-gray-700\b/g, replace: 'text-text-secondary' },
  { regex: /\btext-gray-600\b/g, replace: 'text-text-secondary' },
  { regex: /\btext-gray-500\b/g, replace: 'text-text-muted' },
  { regex: /\btext-gray-400\b/g, replace: 'text-text-muted' },
  { regex: /\btext-brand-600\b/g, replace: 'text-brand-primary' },
  { regex: /\btext-brand-700\b/g, replace: 'text-brand-primary' },
  { regex: /\btext-brand-500\b/g, replace: 'text-brand-primary' },
  { regex: /\btext-blue-600\b/g, replace: 'text-brand-primary' },
  { regex: /\btext-blue-500\b/g, replace: 'text-brand-primary' },

  // Extremely low opacity text
  { regex: /\btext-white\/[1-4]0\b/g, replace: 'text-text-disabled' },
  { regex: /\btext-white\/[5-6]0\b/g, replace: 'text-text-muted' },
  { regex: /\btext-white\/[7-9]0\b/g, replace: 'text-text-secondary' },
  { regex: /\btext-white\b/g, replace: 'text-text-primary' },

  // Borders
  { regex: /\bborder-slate-200\b/g, replace: 'border-border-subtle' },
  { regex: /\bborder-slate-300\b/g, replace: 'border-border-subtle' },
  { regex: /\bborder-slate-700\b/g, replace: 'border-border-strong' },
  { regex: /\bborder-slate-800\b/g, replace: 'border-border-strong' },
  { regex: /\bborder-gray-200\b/g, replace: 'border-border-subtle' },
  { regex: /\bborder-gray-300\b/g, replace: 'border-border-subtle' },
  { regex: /\bborder-brand-100\b/g, replace: 'border-brand-primary/20' },
  { regex: /\bborder-brand-200\b/g, replace: 'border-brand-primary/30' },
  { regex: /\bborder-brand-500\b/g, replace: 'border-brand-primary' },
  { regex: /\bborder-white\/10\b/g, replace: 'border-border-subtle' },
  { regex: /\bborder-white\/20\b/g, replace: 'border-border-subtle' },

  // Ring
  { regex: /\bring-brand-500\b/g, replace: 'ring-brand-primary' },
  { regex: /\bring-blue-500\b/g, replace: 'ring-brand-primary' },
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

console.log(`Updated ${changedFiles} files.`);
