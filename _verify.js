const fs = require('fs');
const path = require('path');
const base = path.join(process.cwd(), 'frontend', 'node_modules');
const checks = [
  ['vite', '8.0.0'],
  ['recharts', '3.0.0'],
  ['typescript', '6.0.0'],
];
let allOk = true;
checks.forEach(([d, min]) => {
  const v = JSON.parse(fs.readFileSync(path.join(base, d, 'package.json'), 'utf8')).version;
  const ok = v >= min;
  if (!ok) allOk = false;
  console.log(d + ': ' + v + ' ' + (ok ? 'OK' : 'FAIL'));
});
if (!allOk) process.exit(1);
