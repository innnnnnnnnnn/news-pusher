import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// ── Configuration ─────────────────────────────────────────────────────────────
const INTERVAL_MINUTES = parseInt(process.env.INTERVAL_MINUTES || '5', 10);
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

// Load .env automatically if present
if (fs.existsSync('.env')) {
  const content = fs.readFileSync('.env', 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  });
}

function log(msg) {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  console.log(`[${now}] ${msg}`);
}

let isRunning = false;

async function runPushCycle() {
  if (isRunning) {
    log('⚠️ 前一次推播尚未完成，跳過本次循環');
    return;
  }

  isRunning = true;
  log(`🚀 開始執行新聞掃描與推播...`);

  const child = spawn('node', ['scripts/github-push.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('close', code => {
    isRunning = false;
    if (code === 0) {
      log(`✅ 本次巡邏完成。等待 ${INTERVAL_MINUTES} 分鐘後執行下一次掃描...`);
    } else {
      log(`⚠️ 本次推播退出，退出碼: ${code}。等待 ${INTERVAL_MINUTES} 分鐘後重試...`);
    }
  });

  child.on('error', err => {
    isRunning = false;
    log(`❌ 執行出錯: ${err.message}`);
  });
}

console.log('='.repeat(60));
console.log(`  🌐 News Pusher Daemon 守護進程啟動`);
console.log(`  ⏱️ 執行間隔: 每 ${INTERVAL_MINUTES} 分鐘自動執行一次`);
console.log(`  📰 來源: ${process.env.SUBSCRIPTIONS || 'The Economist, Financial Times, New York Times'}`);
console.log('='.repeat(60));

// 立即執行第一次
runPushCycle();

// 定時重複執行
setInterval(runPushCycle, INTERVAL_MS);
