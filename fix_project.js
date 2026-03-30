const fs = require('fs');
const data = fs.readFileSync('.gsd/PROJECT.md', 'utf8');
if (!data.includes('S09: Frontend polish')) {
  fs.writeFileSync('.gsd/PROJECT.md', data.trimEnd() + '\n      - [x] S09: Frontend polish + responsive design\n');
  console.log('S09 line added');
} else {
  console.log('S09 already present');
}
