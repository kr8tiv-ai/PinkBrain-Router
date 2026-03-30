import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const backendDir = 'C:/Users/lucid/desktop/pinkbrain router git/backend/node_modules';
const frontendDir = 'C:/Users/lucid/desktop/pinkbrain router git/frontend/node_modules';

const backendPkgs = [
  'fastify','@bagsfm/bags-sdk','@fastify/cors','@fastify/rate-limit',
  '@fastify/sensible','@solana/spl-token','@solana/web3.js','bn.js',
  'bs58','commander','dotenv','node-cron','pino','pino-pretty',
  'viem','axios','zod','typescript','vitest','tsx','eslint','rimraf'
];

const frontendPkgs = [
  'react','react-dom','@tanstack/react-query','react-router',
  'recharts','tailwindcss','typescript','vite','@tailwindcss/vite','@vitejs/plugin-react'
];

console.log('=== BACKEND ===');
for (const p of backendPkgs) {
  const fp = join(backendDir, p, 'package.json');
  if (existsSync(fp)) {
    const j = JSON.parse(readFileSync(fp, 'utf8'));
    console.log(`${p}=${j.version}`);
  } else {
    console.log(`${p}=NOT_FOUND`);
  }
}

console.log('\n=== FRONTEND ===');
for (const p of frontendPkgs) {
  const fp = join(frontendDir, p, 'package.json');
  if (existsSync(fp)) {
    const j = JSON.parse(readFileSync(fp, 'utf8'));
    console.log(`${p}=${j.version}`);
  } else {
    console.log(`${p}=NOT_FOUND`);
  }
}
