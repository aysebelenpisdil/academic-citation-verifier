#!/usr/bin/env node
import { execSync } from 'node:child_process';

const PORT = 8000;
const isWin = process.platform === 'win32';

try {
  if (isWin) {
    const output = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = output.trim().split('\n').filter(Boolean);
    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') {
        pids.add(pid);
      }
    }
    if (pids.size > 0) {
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          console.log(`Port ${PORT} üzerindeki işlem (PID ${pid}) kapatıldı.`);
        } catch {}
      }
    } else {
      console.log(`Port ${PORT} zaten boş.`);
    }
  } else {
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
  }
} catch (e) {
  console.log(`Port ${PORT} zaten boş.`);
}
