const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

walkDir('src', function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let c = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    if (c.includes('!bg-status-warning')) {
      c = c.replace(/!bg-status-warning ring-amber-300/g, 'bg-warning-surface ring-1 ring-warning-border border-l-4 border-l-warning-base');
      c = c.replace(/!bg-status-warning\/6 ring-amber-500\/15/g, 'bg-warning-surface ring-1 ring-warning-border');
      c = c.replace(/!bg-status-warning/g, 'bg-warning-surface');
      changed = true;
    }
    
    if (c.includes('text-status-warning')) {
      // For elements inside those cards, text-status-warning can be harsh if we change bg.
      // But text-status-warning might still be okay as amber text.
      // Let's replace cases where they're heading elements specifically or just standard warning replacements.
      // Wait, we can safely replace `text-[14px] font-semibold text-status-warning`
      c = c.replace(/text-\[14px\] font-semibold text-status-warning/g, 'text-[14px] font-semibold text-warning-highlight');
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(filePath, c);
    }
  }
});
console.log("Done");
