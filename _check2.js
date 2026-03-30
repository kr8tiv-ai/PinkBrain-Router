const fs = require('fs');
const path = require('path');
const root = process.cwd();
// Check root node_modules for vite
const rootVite = path.join(root, 'node_modules', 'vite', 'package.json');
try { console.log('root vite:', JSON.parse(fs.readFileSync(rootVite, 'utf8')).version); } catch(e) { console.log('no root vite:', e.code); }
// Check frontend node_modules for vite
const feVite = path.join(root, 'frontend', 'node_modules', 'vite', 'package.json');
try { console.log('frontend vite:', JSON.parse(fs.readFileSync(feVite, 'utf8')).version); } catch(e) { console.log('no frontend vite:', e.code); }
// Check backend node_modules for vite
const beVite = path.join(root, 'backend', 'node_modules', 'vite', 'package.json');
try { console.log('backend vite:', JSON.parse(fs.readFileSync(beVite, 'utf8')).version); } catch(e) { console.log('no backend vite:', e.code); }
// Check what depends on vite in root
const rootLock = path.join(root, 'package-lock.json');
try { console.log('root lockfile exists:', fs.existsSync(rootLock)); } catch(e) { console.log('no root lockfile'); }
const feLock = path.join(root, 'frontend', 'package-lock.json');
try { console.log('frontend lockfile exists:', fs.existsSync(feLock)); } catch(e) { console.log('no frontend lockfile'); }
