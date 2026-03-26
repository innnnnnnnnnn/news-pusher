import db from './db';
import { scrapeArticleWithBPC } from './scraper';
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
    // Use regex to find all <link> values within <item> tags
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

const isRunning = new Set();

export async function runPushJob() {
  const subStmt = db.prepare('SELECT site_name FROM subscriptions WHERE enabled = 1');
  const sites = subStmt.all().map(s => s.site_name);
  
  const cfgStmt = db.prepare('SELECT key, value FROM config');
  const configMap = {};
  cfgStmt.all().forEach(row => { configMap[row.key] = row.value });
  
  if (!configMap.telegramToken || !configMap.chatId) return;

  const bot = new TelegramBot(configMap.telegramToken, { polling: false });

  for (const siteName of sites) {
    if (isRunning.has(siteName)) continue;
    isRunning.add(siteName);

    try {
      const domain = await getDomainForSite(siteName);
      if (!domain) continue;

      const articleUrls = await fetchAllArticlesFromGoogleNewsRSS(domain);
      // Process newest first (RSS usually sorted by date desc)
      for (const articleUrl of articleUrls) {
        // Check if already sent
        const exist = db.prepare('SELECT 1 FROM pushed_articles WHERE url = ?').get(articleUrl);
        if (exist) continue;

        console.log(`[QUEUE] Found new article for ${siteName}: ${articleUrl}`);
        
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
            await bot.sendPhoto(configMap.chatId, article.image, { caption: message, parse_mode: 'Markdown' });
          } else {
            await bot.sendMessage(configMap.chatId, message, { parse_mode: 'Markdown' });
          }

          db.prepare('INSERT INTO pushed_articles (url) VALUES (?)').run(articleUrl);
          console.log(`[PASS] Sent: ${article.title}`);
          
          // Wait 2 seconds between individual articles to be safe
          await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
          console.error(`[FAIL] Article ${articleUrl}:`, err.message);
        }
      }
    } catch(e) {
      console.error(`[FAIL] ${siteName}:`, e.message);
    } finally {
      isRunning.delete(siteName);
    }
  }
}
