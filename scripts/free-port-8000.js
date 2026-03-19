#!/usr/bin/env node
/**
 * Port 8000'i kullanan işlemi sonlandırır.
 */
import { execSync } from 'child_process';

const PORT = 8000;

try {
  const pids = execSync(`lsof -i :${PORT} -t 2>/dev/null`, { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  if (!pids.length) {
    console.log(`Port ${PORT} zaten boş.`);
    process.exit(0);
  }

  for (const pid of pids) {
    execSync(`kill -9 ${pid}`, { stdio: 'inherit' });
    console.log(`PID ${pid} sonlandırıldı.`);
  }
  console.log(`Port ${PORT} boşaltıldı.`);
} catch (e) {
  if (e.status === 1) {
    console.log(`Port ${PORT} zaten boş.`);
  } else {
    console.error('Hata:', e.message);
    process.exit(1);
  }
}
