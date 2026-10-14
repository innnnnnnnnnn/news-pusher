import { scrapeArticleWithBPC } from '../src/lib/scraper.js';
import TelegramBot from 'node-telegram-bot-api';
import { translate } from 'google-translate-api-x';
import fs from 'fs';
import vm from 'vm';
import path from 'path';

// ── Google News RSS (for non-FT sites) ──────────────────────────────────────
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

// ── FT Official RSS (bypasses Cloudflare entirely) ──────────────────────────
/**
 * Fetches articles directly from the Financial Times official RSS feed.
 * Returns an array of article objects: { id, title, excerpt, url, image, pubDate }
 * Uses ft.com/rss/home/uk as the primary feed (no auth required for headlines).
 */
async function fetchFTArticlesFromOfficialRSS() {
  const FT_RSS_URLS = [
    'https://www.ft.com/rss/home/uk',
    'https://www.ft.com/rss/home/us',
  ];

  const articles = [];
  const seenIds = new Set();

  for (const rssUrl of FT_RSS_URLS) {
    try {
      console.log(`[FT-RSS] Fetching: ${rssUrl}`);
      const res = await fetch(rssUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml',
        }
      });

      if (!res.ok) {
        console.warn(`[FT-RSS] HTTP ${res.status} for ${rssUrl}`);
        continue;
      }

      const text = await res.text();
      const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];

      for (const item of items) {
        const titleMatch = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                           item.match(/<title>([\s\S]*?)<\/title>/);
        const linkMatch  = item.match(/<link>([\s\S]*?)<\/link>/) ||
                           item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);
        const descMatch  = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                           item.match(/<description>([\s\S]*?)<\/description>/);
        const dateMatch  = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const imgMatch   = item.match(/<media:content[^>]+url="([^"]+)"/) ||
                           item.match(/<enclosure[^>]+url="([^"]+)"/);

        if (!titleMatch || !linkMatch) continue;

        const url = linkMatch[1].trim().replace(/^https?:\/\/www\.ft\.com/, 'https://www.ft.com');
        if (seenIds.has(url)) continue;
        seenIds.add(url);

        // Strip HTML tags from description
        const rawDesc = descMatch ? descMatch[1] : '';
        const excerpt = rawDesc.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim().substring(0, 300);

        articles.push({
          id: url,
          title: titleMatch[1].trim(),
          excerpt,
          url,
          image: imgMatch ? imgMatch[1] : null,
          pubDate: dateMatch ? dateMatch[1] : '',
        });
      }
    } catch(e) {
      console.error(`[FT-RSS] Error fetching ${rssUrl}:`, e.message);
    }
  }

  console.log(`[FT-RSS] Found ${articles.length} articles total`);
  return articles;
}

// ── BPC domain lookup ────────────────────────────────────────────────────────
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

// ── History ──────────────────────────────────────────────────────────────────
const HISTORY_FILE = './history.json';
const history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : [];

// ── Main ─────────────────────────────────────────────────────────────────────
async function pushArticles() {
  const telegramToken = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.CHAT_ID;
  const subscriptionsString = process.env.SUBSCRIPTIONS || 'The Economist';
  const sites = subscriptionsString.split(',').map(s => s.trim());

  if (!telegramToken || !chatId) {
    console.error('Missing TELEGRAM_TOKEN or CHAT_ID environment variables.');
    process.exit(1);
  }

  const bot = new TelegramBot(telegramToken, { polling: false });

  for (const siteName of sites) {
    try {
      // ── Special case: Financial Times → use official RSS (no Cloudflare) ──
      if (siteName.toLowerCase().includes('financial times')) {
        console.log(`[CHECK] Using FT Official RSS for: ${siteName}`);
        const ftArticles = await fetchFTArticlesFromOfficialRSS();

        for (const article of ftArticles) {
          if (history.includes(article.id)) continue;

          console.log(`[NEW] FT Article: ${article.title}`);
          try {
            const [tTitle, tExcerpt] = await Promise.all([
              translate(article.title, { to: 'zh-TW' }),
              article.excerpt
                ? translate(article.excerpt, { to: 'zh-TW' })
                : Promise.resolve({ text: '' }),
            ]);

            const pubDateStr = article.pubDate
              ? `📅 ${new Date(article.pubDate).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}\n`
              : '';

            const message =
              `*金融時報 Financial Times*\n\n` +
              `*${tTitle.text}*\n` +
              `${article.title}\n\n` +
              (tExcerpt.text ? `${tExcerpt.text}\n\n` : '') +
              pubDateStr +
              `🔗 [閱讀全文](${article.url})`;

            if (article.image) {
              await bot.sendPhoto(chatId, article.image, { caption: message, parse_mode: 'Markdown' });
            } else {
              await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            }

            history.push(article.id);
            console.log(`[SENT] ${article.title}`);

            await new Promise(r => setTimeout(r, 2000));
          } catch (err) {
            console.error(`[FAIL] FT article "${article.title}":`, err.message);
          }
        }
        continue; // done with FT, move to next site
      }

      // ── Standard flow: Google News RSS + Puppeteer BPC ───────────────────
      const domain = await getDomainForSite(siteName);
      if (!domain) {
        console.log(`[SKIP] Domain not found for: ${siteName}`);
        continue;
      }

      console.log(`[CHECK] Fetching RSS for: ${siteName} (${domain})`);
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

  // Save history back to file (keep only last 500 entries to avoid file bloat)
  const trimmedHistory = history.slice(-500);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmedHistory, null, 2));
}

pushArticles().then(() => {
  console.log('--- News Push Job Completed ---');
});
