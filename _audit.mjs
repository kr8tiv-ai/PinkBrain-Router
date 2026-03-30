const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getInstalledVersion(baseDir, pkg) {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(baseDir, 'node_modules', pkg, 'package.json'), 'utf8'));
    return pj.version;
  } catch {
    return null;
  }
}

function getLatestVersion(pkg) {
  try {
    const out = execSync(`npm view ${pkg} version --json 2>/dev/null`, { encoding: 'utf8', timeout: 15000 });
    const v = JSON.parse(out.trim());
    return Array.isArray(v) ? v[0] : v;
  } catch {
    return 'ERROR';
  }
}

const backendDir = path.resolve(__dirname, 'backend');
const frontendDir = path.resolve(__dirname, 'frontend');

const deps = {
  backend: [
    'fastify','@bagsfm/bags-sdk','@fastify/cors','@fastify/rate-limit',
    '@fastify/sensible','@solana/spl-token','@solana/web3.js','bn.js',
    'bs58','commander','dotenv','node-cron','pino','pino-pretty',
    'viem','axios','zod','typescript','vitest','tsx','eslint','rimraf'
  ],
  frontend: [
    'react','react-dom','@tanstack/react-query','react-router',
    'recharts','tailwindcss','vite','@tailwindcss/vite','@vitejs/plugin-react'
  ]
};

console.log(JSON.stringify({backendDir, frontendDir}, null, 2));

// Check which node_modules exist
console.log('backend node_modules:', fs.existsSync(path.join(backendDir, 'node_modules')));
console.log('frontend node_modules:', fs.existsSync(path.join(frontendDir, 'node_modules')));

// Get installed versions
console.log('\n=== INSTALLED VERSIONS ===');

for (const pkg of deps.backend) {
  const v = getInstalledVersion(backendDir, pkg);
  console.log(`backend|${pkg}|${v}`);
}

for (const pkg of deps.frontend) {
  const v = getInstalledVersion(frontendDir, pkg);
  console.log(`frontend|${pkg}|${v}`);
}

// Get latest versions
console.log('\n=== LATEST VERSIONS FROM npm ===');
const allPkgs = [...deps.backend, ...deps.frontend];
for (const pkg of allPkgs) {
  const latest = getLatestVersion(pkg);
  console.log(`${pkg}|${latest}`);
}
