#!/usr/bin/env node
/**
 * Port 8000 kullanımda mı kontrol eder.
 */
import { execSync } from 'node:child_process';

const PORT = 8000;

try {
  const out = execSync(`lsof -i :${PORT} -t 2>/dev/null || true`, { encoding: 'utf8' });
  const pids = out.trim().split('\n').filter(Boolean);
  if (pids.length) {
    console.log(`Port ${PORT} meşgul. PID'ler: ${pids.join(', ')}`);
    console.log('Boşaltmak için: npm run free-port');
    process.exit(1);
  }
  console.log(`Port ${PORT} boş.`);
} catch {
  console.log(`Port ${PORT} boş.`);
}
