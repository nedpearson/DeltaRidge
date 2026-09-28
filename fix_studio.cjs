const fs = require('fs');
let content = fs.readFileSync('src/features/social/components/CreativeStudioView.tsx', 'utf8');
content = content.replace("const ext = file.name.split('.').pop()", "// const ext = file.name.split('.').pop()");
content = content.replace("const { data: uploadData, error: uploadError }", "const { error: uploadError }");
fs.writeFileSync('src/features/social/components/CreativeStudioView.tsx', content);
