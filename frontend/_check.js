const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', 'node_modules', 'vite', 'package.json');
console.log('checking:', root);
try { console.log('root vite:', JSON.parse(fs.readFileSync(root, 'utf8')).version); } catch(e) { console.log('no root vite:', e.code); }
const local = path.resolve(__dirname, 'node_modules', 'vite', 'package.json');
console.log('frontend vite:', JSON.parse(fs.readFileSync(local, 'utf8')).version);
