import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend-js');
const frontendDir = path.join(rootDir, 'frontend');

console.log('🚀 TÜBİTAK Atıf Doğrulayıcı Başlatılıyor...\n');

// 1. Port 8000 temizleme
try {
  console.log('🧹 Port 8000 kontrol ediliyor...');
  execSync('node scripts/free-port-8000.js', { cwd: rootDir, stdio: 'inherit' });
} catch (e) {}

console.log('\n⚙️ Backend (Port 8000) ve Frontend (Port 5173) başlatılıyor...\n');

// 2. Backend Başlatma (node server.js)
const serverScript = path.join(backendDir, 'server.js');
const backendProcess = spawn(process.execPath, [serverScript], {
  cwd: backendDir,
  stdio: 'pipe'
});

backendProcess.stdout.on('data', (data) => {
  const line = data.toString().trim();
  if (line) console.log(`\x1b[36m[BACKEND]\x1b[0m ${line}`);
});

backendProcess.stderr.on('data', (data) => {
  const line = data.toString().trim();
  if (line) console.warn(`\x1b[31m[BACKEND-LOG]\x1b[0m ${line}`);
});

// 3. Frontend Başlatma (node node_modules/vite/bin/vite.js --open)
const viteBin = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
const frontendArgs = fs.existsSync(viteBin) ? [viteBin, '--open'] : ['node_modules/vite/bin/vite.js', '--open'];

const frontendProcess = spawn(process.execPath, frontendArgs, {
  cwd: frontendDir,
  stdio: 'pipe'
});

frontendProcess.stdout.on('data', (data) => {
  const line = data.toString().trim();
  if (line) console.log(`\x1b[32m[FRONTEND]\x1b[0m ${line}`);
});

frontendProcess.stderr.on('data', (data) => {
  const line = data.toString().trim();
  if (line) console.log(`\x1b[32m[FRONTEND]\x1b[0m ${line}`);
});

function cleanup() {
  console.log('\n🛑 Servisler kapatılıyor...');
  try { backendProcess.kill(); } catch {}
  try { frontendProcess.kill(); } catch {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
