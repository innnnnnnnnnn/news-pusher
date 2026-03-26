import { scrapeArticleWithBPC } from '../src/lib/scraper.js';
import TelegramBot from 'node-telegram-bot-api';
import { translate } from 'google-translate-api-x';
import fs from 'fs';
import vm from 'vm';
import path from 'path';

async function fetchAllArticlesFromGoogleNewsRSS(siteUrl) {
  try {
    const rssUrl = `https://news.google.com/rss/search?q=site:${siteUrl}`;
    const res = await fetch(rssUrl);
    const text = await res.text();
    const items = text.match(/<item>.*?<\/item>/gs) || [];
    return items.map(item => {
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      return linkMatch ? linkMatch[1] : null;
    }).filter(link => link !== null);
  } catch(e) {
    console.error('RSS Fetch error:', e);
    return [];
  }
}

async function getDomainForSite(siteName) {
  try {
    const extensionPath = process.env.BPC_PATH || path.resolve(process.cwd(), './extension-bpc');
    const sitesPath = path.join(extensionPath, 'sites.js');
    const content = fs.readFileSync(sitesPath, 'utf8');
    const sandbox = { chrome: { runtime: { getManifest: () => ({ key: 'mock' }) } }, browser: undefined };
    vm.createContext(sandbox);
    vm.runInContext(content, sandbox);
    const info = sandbox.defaultSites[siteName];
    if (info && info.domain) {
      if (info.domain.startsWith('###') && info.group && info.group.length > 0) return info.group[0];
      return info.domain;
    }
  } catch(e) {}
  return null;
}

const HISTORY_FILE = './history.json';
const history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : [];
const DASHBOARD_FILE = './news-data.json';
const newDashboardItems = [];

async function pushArticles() {
  const telegramToken = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.CHAT_ID;
  const subscriptionsString = process.env.SUBSCRIPTIONS || 'The Economist, The New York Times, Financial Times (not cn subdomain)';
  const sites = subscriptionsString.split(',').map(s => s.trim());

  if (!telegramToken || !chatId) {
    console.error('Missing TELEGRAM_TOKEN or CHAT_ID environment variables.');
    process.exit(1);
  }

  const bot = new TelegramBot(telegramToken, { polling: false });

  for (const siteName of sites) {
    try {
      const domain = await getDomainForSite(siteName);
      if (!domain) continue;

      console.log(`[CHECK] ${siteName}...`);
      const articleUrls = await fetchAllArticlesFromGoogleNewsRSS(domain);
      
      for (const articleUrl of articleUrls) {
        if (history.includes(articleUrl)) continue;

        console.log(`[NEW] Processing: ${articleUrl}`);
        
        try {
          const article = await scrapeArticleWithBPC(articleUrl);
          
          const [tTitle, tCategory, tExcerpt] = await Promise.all([
            translate(article.title, { to: 'zh-TW' }),
            translate(article.category || 'News', { to: 'zh-TW' }),
            translate(article.excerpt || article.textContent.substring(0, 200), { to: 'zh-TW' })
          ]);

          const message = `*${tCategory.text}*\n\n` +
                          `*${tTitle.text}*\n` +
                          `${article.title}\n\n` +
                          `${tExcerpt.text}\n\n` +
                          `⏳ 閱讀時間：${article.readingTime}分鐘\n` +
                          `🔗 [閱讀全文](${article.url})`;
          
          if (article.image) {
            await bot.sendPhoto(chatId, article.image, { caption: message, parse_mode: 'Markdown' });
          } else {
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
          }

          history.push(articleUrl);
          
          newDashboardItems.push({
            title: article.title,
            title_zh: tTitle.text,
            excerpt_zh: tExcerpt.text,
            category: article.category,
            category_zh: tCategory.text,
            image: article.image,
            readingTime: article.readingTime,
            url: article.url,
            pushed_at: new Date().toISOString()
          });

          console.log(`[SENT] ${article.title}`);
          await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
          console.error(`[FAIL] ${articleUrl}:`, err.message);
        }
      }
    } catch (e) {
      console.error(`[ERROR] Site ${siteName}:`, e.message);
    }
  }

  // Finalize history
  const trimmedHistory = history.slice(-500);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmedHistory, null, 2));

  // Finalize dashboard (in root for GitHub Pages)
  let dashboardData = fs.existsSync(DASHBOARD_FILE) ? JSON.parse(fs.readFileSync(DASHBOARD_FILE, 'utf8')) : [];
  
  if (newDashboardItems.length > 0) {
    dashboardData = [...newDashboardItems, ...dashboardData];
    dashboardData = dashboardData.slice(0, 50); // Keep last 50
    fs.writeFileSync(DASHBOARD_FILE, JSON.stringify(dashboardData, null, 2));
    console.log(`[DASHBOARD] Updated history with ${newDashboardItems.length} new items.`);
  }
}

pushArticles().then(() => {
  console.log('--- News Push Job Completed ---');
});
