const fs = require('fs');
const path = require('path');
const d = process.cwd();
console.log('cwd:', d);
const r = path.join(d, 'frontend', 'node_modules', 'vite', 'package.json');
const v = JSON.parse(fs.readFileSync(r, 'utf8')).version;
console.log('frontend vite:', v);
const r2 = path.join(d, 'node_modules', 'vite', 'package.json');
try {
  console.log('root vite:', JSON.parse(fs.readFileSync(r2, 'utf8')).version);
} catch(e) {
  console.log('no root vite');
}
