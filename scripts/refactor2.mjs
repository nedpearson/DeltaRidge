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
  // Additional Text colors
  { regex: /\btext-slate-300\b/g, replace: 'text-text-secondary' },
  { regex: /\btext-slate-200\b/g, replace: 'text-text-secondary' },
  { regex: /\btext-slate-100\b/g, replace: 'text-text-primary' },
  { regex: /\btext-slate-50\b/g, replace: 'text-text-primary' },
  { regex: /\btext-gray-300\b/g, replace: 'text-text-secondary' },
  { regex: /\btext-gray-200\b/g, replace: 'text-text-secondary' },
  { regex: /\btext-gray-100\b/g, replace: 'text-text-primary' },
  { regex: /\btext-gray-50\b/g, replace: 'text-text-primary' },
  { regex: /\btext-black\/[0-9]+\b/g, replace: 'text-text-muted' },

  // Backgrounds
  { regex: /\bbg-slate-700\b/g, replace: 'bg-bg-elevated' },
  { regex: /\bbg-slate-600\b/g, replace: 'bg-bg-elevated' },
  { regex: /\bbg-slate-300\b/g, replace: 'bg-border-subtle' },
  { regex: /\bbg-gray-700\b/g, replace: 'bg-bg-elevated' },
  { regex: /\bbg-black\/[0-9]+\b/g, replace: 'bg-bg-elevated' },
  
  // Status Colors
  { regex: /\btext-emerald-[0-9]{3}\b/g, replace: 'text-status-success' },
  { regex: /\btext-green-[0-9]{3}\b/g, replace: 'text-status-success' },
  { regex: /\bbg-emerald-[0-9]{3}\b/g, replace: 'bg-status-success' },
  { regex: /\bbg-green-[0-9]{3}\b/g, replace: 'bg-status-success' },
  
  { regex: /\btext-red-[0-9]{3}\b/g, replace: 'text-status-critical' },
  { regex: /\btext-rose-[0-9]{3}\b/g, replace: 'text-status-critical' },
  { regex: /\bbg-red-[0-9]{3}\b/g, replace: 'bg-status-critical' },
  { regex: /\bbg-rose-[0-9]{3}\b/g, replace: 'bg-status-critical' },
  
  { regex: /\btext-amber-[0-9]{3}\b/g, replace: 'text-status-warning' },
  { regex: /\btext-yellow-[0-9]{3}\b/g, replace: 'text-status-warning' },
  { regex: /\bbg-amber-[0-9]{3}\b/g, replace: 'bg-status-warning' },
  { regex: /\bbg-yellow-[0-9]{3}\b/g, replace: 'bg-status-warning' },
  
  // Glow
  { regex: /\bshadow-blue-500\/[0-9]+\b/g, replace: 'box-glow' },
  { regex: /\bshadow-brand-500\/[0-9]+\b/g, replace: 'box-glow' },

  // Borders
  { regex: /\bborder-slate-600\b/g, replace: 'border-border-strong' },
  { regex: /\bborder-slate-500\b/g, replace: 'border-border-subtle' },
  { regex: /\bborder-slate-400\b/g, replace: 'border-border-subtle' },
  
  // Divide
  { regex: /\bdivide-slate-[0-9]{3}\b/g, replace: 'divide-border-subtle' },
  { regex: /\bdivide-gray-[0-9]{3}\b/g, replace: 'divide-border-subtle' },
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

console.log(`Updated ${changedFiles} files in refactor 2.`);
