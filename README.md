# 📰 News Pusher

> 自動從 The Economist、Financial Times、New York Times 抓取最新文章，翻譯成繁體中文後推送至 Telegram。
>
> Automatically fetches latest articles from The Economist, Financial Times, and New York Times, translates them to Traditional Chinese, and pushes to Telegram.

[![News Pusher Cron](https://github.com/innnnnnnnnnn/news-pusher/actions/workflows/push.yml/badge.svg)](https://github.com/innnnnnnnnnn/news-pusher/actions/workflows/push.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 📺 Dashboard

**[https://news-pusher.vercel.app](https://news-pusher.vercel.app)**

即時查看最近推送的文章紀錄。/ View the live push history dashboard.

---

## ✨ 功能 / Features

| 功能 | Feature |
|------|---------|
| 📡 官方 RSS 抓取（無 Cloudflare 問題） | Official RSS feeds (no Cloudflare issues) |
| 🌏 自動翻譯至繁體中文 | Auto-translate to Traditional Chinese |
| 📬 Telegram Bot 推送 | Telegram Bot push notifications |
| ⏱️ 每 30 分鐘自動執行（GitHub Actions） | Runs every 30 min via GitHub Actions |
| 🗂️ 去重機制（不重複推送） | Deduplication via `history.json` |
| 📅 只推送 72 小時內的新文章 | Only pushes articles within 72 hours |

---

## 📰 支援的媒體 / Supported Sources

| 媒體 / Source | RSS Feeds |
|---------------|-----------|
| 🗞️ **The Economist** | World, Finance, Business, US, China, Asia |
| 📰 **Financial Times** | Home UK, Home US |
| 📄 **New York Times** | Home Page, World, Business |

---

## 🚀 快速開始 / Quick Start

### 1. Fork 這個 Repo / Fork this Repo

```bash
# Clone 到本地
git clone https://github.com/YOUR_USERNAME/news-pusher.git
cd news-pusher
npm install
```

### 2. 設定 GitHub Secrets / Set GitHub Secrets

前往 `Settings → Secrets and variables → Actions`：

| Secret | 說明 / Description |
|--------|-------------------|
| `TELEGRAM_TOKEN` | Telegram Bot Token（從 [@BotFather](https://t.me/BotFather) 取得） |
| `CHAT_ID` | 你的 Telegram Chat ID（用 [@userinfobot](https://t.me/userinfobot) 取得） |

### 3. 設定訂閱來源（選填）/ Configure Sources (Optional)

前往 `Settings → Variables → Actions`，新增 `SUBSCRIPTIONS`：

```
The Economist, Financial Times (not cn subdomain), The New York Times
```

若未設定，預設推送 The Economist。

### 4. 啟動 / Enable

進入 `Actions` 頁籤，啟用 **News Pusher Cron** workflow，之後每 30 分鐘自動執行。

也可手動點 **Run workflow** 立即觸發。

---

## 🏗️ 專案結構 / Project Structure

```
news-pusher/
├── scripts/
│   └── github-push.mjs     # 主要推送腳本（RSS 抓取 → 翻譯 → Telegram）
├── src/
│   └── app/                # Next.js Dashboard（GitHub Pages）
├── .github/
│   └── workflows/
│       ├── push.yml        # 推送 Cron Job（每 30 分鐘）
│       └── pr-validate.yml # PR 自動驗證
├── history.json            # 已推送文章記錄（去重用）
└── extension-bpc/          # Bypass Paywalls Chrome Extension（備用）
```

---

## ⚙️ 架構說明 / How It Works

```
GitHub Actions (每30分鐘)
    ↓
讀取 SUBSCRIPTIONS 環境變數
    ↓
對每個媒體抓取官方 RSS Feed（HTTP fetch，無需瀏覽器）
    ↓
過濾：72小時內 + 標題長度 >= 3 詞 + 未推過（history.json）
    ↓
google-translate-api-x 翻譯標題 & 摘要
    ↓
Telegram Bot 推送訊息（含圖片/標題/摘要/日期/連結）
    ↓
更新 history.json → Git commit → Push
```

---

## 🛠️ 本地開發 / Local Development

```bash
# 設定環境變數
cp .env.example .env
# 填入 TELEGRAM_TOKEN 和 CHAT_ID

# 執行推送（本地測試）
TELEGRAM_TOKEN=xxx CHAT_ID=xxx SUBSCRIPTIONS="The Economist" node scripts/github-push.mjs

# 啟動 Dashboard
npm run dev
# 開啟 http://localhost:3000
```

---

## 📦 版本紀錄 / Changelog

### v1.0.0 — 2026-10-15
- 🎉 全面改用官方 RSS Feed，移除 Puppeteer（解決 Cloudflare 封鎖問題）
- ✅ 支援 The Economist、Financial Times、New York Times
- 📅 新增 72 小時時間過濾，避免推送舊文章
- 🔧 修正 CDATA 解析 Bug
- 🚀 GitHub Actions 改用 Node.js 24

---

## 🤝 貢獻 / Contributing

歡迎提 [Issue](https://github.com/innnnnnnnnnn/news-pusher/issues) 或 [Pull Request](https://github.com/innnnnnnnnnn/news-pusher/pulls)！

開發流程請參考 [GIT_GUIDE.md](GIT_GUIDE.md)。

---

## 📄 授權 / License

MIT License — 自由使用、修改、分發。/ Free to use, modify, and distribute.
