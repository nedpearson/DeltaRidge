const fs = require('fs');

function fixNBA() {
  const path = 'c:/dev/github/business/DeltaRidge/src/components/NextBestActionPanel.tsx';
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace("import React from 'react'", "");
  fs.writeFileSync(path, content);
}

function fixRules() {
  const path = 'c:/dev/github/business/DeltaRidge/src/features/manager/tabs/AutomationRulesPanel.tsx';
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace("import { useState } from 'react'", "");
  fs.writeFileSync(path, content);
}

function fixManager() {
  const path = 'c:/dev/github/business/DeltaRidge/src/pages/ManagerPage.tsx';
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/funnel\.map\(\(step, i\) =>/g, "funnel.map((step) =>");
  content = content.replace(/step\.count \/ funnel\[0\]\.count/g, "step.count / funnel[0]?.count");
  fs.writeFileSync(path, content);
}

fixNBA();
fixRules();
fixManager();
console.log('Fixed minor TS issues');
