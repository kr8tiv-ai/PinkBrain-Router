const fs = require('fs');
let c = fs.readFileSync('backend/src/cli.ts', 'utf8');
c = c.replace(/db\.init\(\);/g, 'await db.init();');
fs.writeFileSync('backend/src/cli.ts', c);
console.log('Done. Replacements:', (c.match(/await db\.init\(\);/g) || []).length);
