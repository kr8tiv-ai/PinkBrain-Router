const fs = require('fs');
const path = require('path');

const scriptsDir = path.join('backend', 'scripts');
console.log('Scripts dir exists:', fs.existsSync(scriptsDir));
if (fs.existsSync(scriptsDir)) {
  console.log('Contents:', fs.readdirSync(scriptsDir));
}

const pkg = JSON.parse(fs.readFileSync(path.join('backend', 'package.json'), 'utf8'));
console.log('Scripts:', JSON.stringify(pkg.scripts, null, 2));
