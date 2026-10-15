import db from './db';
import { scrapeArticleWithBPC } from './scraper';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import vm from 'vm';
import path from 'path';

// ── DeepL Translator (Free API, ZH-HANT = Traditional Chinese) ───────────────
async function translate(text, opts = {}) {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey || !text || !text.trim()) return { text: text || '' };
  const targetLang = 'ZH-HANT';
  try {
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: [text], target_lang: targetLang }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { text };
    const data = await res.json();
    return { text: data?.translations?.[0]?.text || text };
  } catch {
    return { text };
  }
}

function normalizeTitle(title) {
  if (!title) return '';
  // Remove " - Site Name" suffix
  const clean = title.replace(/\s+-\s+[^-\s]+.*$/, '').trim();
  // Lowercase and remove extra spaces
  return clean.toLowerCase().replace(/\s+/g, ' ');
}

async function fetchAllArticlesFromGoogleNewsRSS(siteUrl) {
  try {
    const rssUrl = `https://news.google.com/rss/search?q=site:${siteUrl}`;
    const res = await fetch(rssUrl);
    const text = await res.text();
    // Use regex to find all <item> tags
    const items = text.match(/<item>.*?<\/item>/gs) || [];
    return items.map(item => {
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      const titleMatch = item.match(/<title>(.*?)<\/title>/);
      const originalTitle = titleMatch ? titleMatch[1] : null;
      return {
        url: linkMatch ? linkMatch[1] : null,
        title: originalTitle,
        normalizedTitle: normalizeTitle(originalTitle)
      };
    }).filter(item => item.url !== null);
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

      const articles = await fetchAllArticlesFromGoogleNewsRSS(domain);
      // Process newest first (RSS usually sorted by date desc)
      for (const articleItem of articles) {
        const { url: articleUrl, title: rssTitle, normalizedTitle: rssNormTitle } = articleItem;

        // 1. Initial check (Exact RSS URL)
        const exist = db.prepare('SELECT 1 FROM pushed_articles WHERE url = ?').get(articleUrl);
        if (exist) continue;

        // 2. Title check (RSS Title - Normalized)
        if (rssNormTitle) {
          const existTitle = db.prepare('SELECT 1 FROM pushed_articles WHERE title = ?').get(rssNormTitle);
          if (existTitle) {
            console.log(`[SKIP] Title already pushed (norm): ${rssNormTitle}`);
            // Still mark this URL as seen to avoid re-checking
            db.prepare('INSERT OR IGNORE INTO pushed_articles (url, title) VALUES (?, ?)').run(articleUrl, rssNormTitle);
            continue;
          }
        }

        console.log(`[QUEUE] Found new article for ${siteName}: ${articleUrl}`);
        
        try {
          const article = await scrapeArticleWithBPC(articleUrl);
          const scrapedNormTitle = normalizeTitle(article.title);

          // 3. Final check (Canonical URL after redirect)
          if (article.url !== articleUrl) {
            const existCanonical = db.prepare('SELECT 1 FROM pushed_articles WHERE url = ?').get(article.url);
            if (existCanonical) {
              console.log(`[SKIP] Canonical URL already pushed: ${article.url}`);
              db.prepare('INSERT OR IGNORE INTO pushed_articles (url, title) VALUES (?, ?)').run(articleUrl, scrapedNormTitle || rssNormTitle);
              continue;
            }
          }

          // 4. Final title check (Scraped Title - Normalized)
          if (scrapedNormTitle) {
            const existScrapedTitle = db.prepare('SELECT 1 FROM pushed_articles WHERE title = ?').get(scrapedNormTitle);
            if (existScrapedTitle) {
              console.log(`[SKIP] Scraped title already pushed (norm): ${scrapedNormTitle}`);
              db.prepare('INSERT OR IGNORE INTO pushed_articles (url, title) VALUES (?, ?)').run(articleUrl, scrapedNormTitle);
              if (article.url !== articleUrl) {
                db.prepare('INSERT OR IGNORE INTO pushed_articles (url, title) VALUES (?, ?)').run(article.url, scrapedNormTitle);
              }
              continue;
            }
          }

          const [tTitle, tCategory, tExcerpt] = await Promise.all([
            translate(article.title),
            translate(article.category || 'News'),
            translate(article.excerpt || article.textContent.substring(0, 200))
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

          // Save both URLs and the normalized title
          db.prepare('INSERT OR IGNORE INTO pushed_articles (url, title) VALUES (?, ?)').run(articleUrl, scrapedNormTitle);
          if (article.url !== articleUrl) {
            db.prepare('INSERT OR IGNORE INTO pushed_articles (url, title) VALUES (?, ?)').run(article.url, scrapedNormTitle);
          }
          
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
