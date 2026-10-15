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

const GITHUB_REPO = process.env.GITHUB_REPO || 'innnnnnnnnnn/news-pusher';
const GITHUB_WORKFLOW = process.env.GITHUB_WORKFLOW || 'push.yml';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function log(msg) {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  console.log(`[${now}] ${msg}`);
}

async function triggerGitHubActions() {
  if (!GITHUB_TOKEN) return false;
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'News-Pusher-Heartbeat/1.0',
      },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 204) {
      log('⚡ [主力] 已成功定時觸發 GitHub Actions 推播工作 (HTTP 204)');
      return true;
    }
    const txt = await res.text();
    log(`⚠️ GitHub Actions API 回應異常 (HTTP ${res.status}): ${txt.substring(0, 100)}`);
    return false;
  } catch (err) {
    log(`⚠️ 觸發 GitHub Actions 失敗: ${err.message}`);
    return false;
  }
}

let isRunning = false;

async function runPushCycle() {
  if (isRunning) {
    log('⚠️ 前一次巡邏尚未完成，跳過本次循環');
    return;
  }

  log(`⏰ 心跳觸發 (間隔: ${INTERVAL_MINUTES} 分鐘)`);

  // 優先觸發 GitHub Actions 主力推播
  if (GITHUB_TOKEN) {
    const ok = await triggerGitHubActions();
    if (ok) {
      log(`✅ GitHub Actions 已接收排程，正在雲端執行。等待 ${INTERVAL_MINUTES} 分鐘後執行下一次心跳...`);
      return;
    }
    log(`🔄 GitHub Actions 觸發失敗，立即切換為 OCI 本地備援推播...`);
  }

  // OCI 本地備援推播
  isRunning = true;
  log(`🚀 開始執行 OCI 本地新聞掃描與推播...`);

  const child = spawn('node', ['scripts/github-push.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('close', code => {
    isRunning = false;
    if (code === 0) {
      log(`✅ OCI 本地巡邏完成。等待 ${INTERVAL_MINUTES} 分鐘後執行下一次掃描...`);
    } else {
      log(`⚠️ OCI 本地推播退出，退出碼: ${code}。等待 ${INTERVAL_MINUTES} 分鐘後重試...`);
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
