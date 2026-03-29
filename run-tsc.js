const { execSync } = require('child_process');
try {
  const out = execSync('npx tsc --noEmit', { cwd: 'backend', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: 'cmd.exe' });
  console.log('TSC SUCCESS');
  if (out.trim()) console.log(out.trim());
} catch (e) {
  console.log('TSC FAILED');
  console.log('EXIT CODE:', e.status);
  if (e.stdout && e.stdout.trim()) console.log('STDOUT:', e.stdout.trim());
  if (e.stderr && e.stderr.trim()) console.log('STDERR:', e.stderr.trim());
}
