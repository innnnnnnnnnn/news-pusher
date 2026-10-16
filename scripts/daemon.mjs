import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// ── Configuration ─────────────────────────────────────────────────────────────
// Default check every 2 minutes for real-time continuous push
const INTERVAL_MINUTES = parseFloat(process.env.INTERVAL_MINUTES || '2');
const INTERVAL_MS = Math.max(60000, Math.floor(INTERVAL_MINUTES * 60 * 1000));

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

function syncHistoryToGithub() {
  try {
    const status = execSync('git status --porcelain history.json', { encoding: 'utf8' }).trim();
    if (!status) return;

    execSync('git config user.name "news-pusher[bot]"');
    execSync('git config user.email "news-pusher@oci"');
    execSync('git add history.json');
    execSync('git commit -m "update: sync push history from OCI [skip ci]"');
    execSync('git push origin main');
    log('☁️ 成功將推播歷史同步更新至 GitHub Repository');
  } catch (err) {
    log(`⚠️ 同步歷史至 GitHub 略過或失敗: ${err.message.substring(0, 100)}`);
  }
}

let isRunning = false;

async function runPushCycle() {
  if (isRunning) {
    log('⚠️ 前一次巡邏尚未完成，跳過本次循環');
    return;
  }

  isRunning = true;
  log(`⏰ 開始執行新聞即時掃描與推播巡邏...`);

  const child = spawn('node', ['scripts/github-push.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('close', code => {
    isRunning = false;
    if (code === 0) {
      log(`✅ 本次巡邏完成。同步歷史並等待 ${INTERVAL_MINUTES} 分鐘後執行下一次巡邏...`);
      syncHistoryToGithub();
    } else {
      log(`⚠️ 推播程式退出，退出碼: ${code}。等待 ${INTERVAL_MINUTES} 分鐘後重試...`);
    }
  });

  child.on('error', err => {
    isRunning = false;
    log(`❌ 執行出錯: ${err.message}`);
  });
}

console.log('='.repeat(60));
console.log(`  🌐 News Pusher Daemon 守護進程啟動 (OCI 本地常駐推播模式)`);
console.log(`  ⏱️ 巡邏間隔: 每 ${INTERVAL_MINUTES} 分鐘自動檢查一次 (永不結束)`);
console.log(`  📰 來源: ${process.env.SUBSCRIPTIONS || 'The Economist, Financial Times, New York Times'}`);
console.log('='.repeat(60));

// 立即執行第一次巡邏
runPushCycle();

// 常駐定時重複執行，永不結束
setInterval(runPushCycle, INTERVAL_MS);

