import TelegramBot from 'node-telegram-bot-api';
import { translate } from 'google-translate-api-x';
import fs from 'fs';

// ── RSS Feed Definitions ─────────────────────────────────────────────────────
// Each entry maps a site name keyword → array of official RSS feed URLs
const OFFICIAL_RSS_SOURCES = {
  'financial times': {
    label: '金融時報 Financial Times',
    feeds: [
      'https://www.ft.com/rss/home/uk',
      'https://www.ft.com/rss/home/us',
    ],
  },
  'the economist': {
    label: '經濟學人 The Economist',
    feeds: [
      'https://www.economist.com/rss/the_world_this_week_rss.xml',
      'https://www.economist.com/finance-and-economics/rss.xml',
      'https://www.economist.com/business/rss.xml',
      'https://www.economist.com/united-states/rss.xml',
      'https://www.economist.com/china/rss.xml',
      'https://www.economist.com/asia/rss.xml',
    ],
  },
  'the new york times': {
    label: '紐約時報 New York Times',
    feeds: [
      'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
      'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
      'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
    ],
  },
};

// ── RSS Parser ───────────────────────────────────────────────────────────────
async function fetchArticlesFromRSS(feedUrl) {
  const res = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${feedUrl}`);
  }

  const text = await res.text();
  const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];

  return items.map(item => {
    const titleMatch  = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                        item.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch   = item.match(/<link>([\s\S]*?)<\/link>/) ||
                        item.match(/<guid isPermaLink="true">([\s\S]*?)<\/guid>/);
    const descMatch   = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                        item.match(/<description>([\s\S]*?)<\/description>/);
    const dateMatch   = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const imgMatch    = item.match(/<media:content[^>]+url="([^"]+)"/) ||
                        item.match(/<media:thumbnail[^>]+url="([^"]+)"/) ||
                        item.match(/<enclosure[^>]+url="([^"]+)"/);

    if (!titleMatch || !linkMatch) return null;

    const rawTitle = titleMatch[1].trim()
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const url = linkMatch[1].trim().split('?')[0]; // strip tracking params for dedup key

    const rawDesc = descMatch ? descMatch[1] : '';
    const excerpt = rawDesc
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 300);

    return {
      id: url,
      title: rawTitle,
      excerpt,
      url: linkMatch[1].trim(), // original URL with utm for clicking
      image: imgMatch ? imgMatch[1] : null,
      pubDate: dateMatch ? dateMatch[1] : '',
    };
  }).filter(Boolean);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const HISTORY_FILE = './history.json';
const history = fs.existsSync(HISTORY_FILE)
  ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
  : [];

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
  let totalSent = 0;

  for (const siteName of sites) {
    // Find matching RSS config (case-insensitive)
    const sourceKey = Object.keys(OFFICIAL_RSS_SOURCES).find(k =>
      siteName.toLowerCase().includes(k)
    );

    if (!sourceKey) {
      console.log(`[SKIP] No RSS config for: ${siteName}`);
      continue;
    }

    const source = OFFICIAL_RSS_SOURCES[sourceKey];
    console.log(`\n[CHECK] ${source.label} — fetching ${source.feeds.length} feed(s)...`);

    // Collect all articles from all feeds, deduplicate by id
    const seen = new Set();
    const allArticles = [];

    for (const feedUrl of source.feeds) {
      try {
        const articles = await fetchArticlesFromRSS(feedUrl);
        console.log(`  ↳ ${feedUrl.split('/').pop()}: ${articles.length} items`);
        for (const a of articles) {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            allArticles.push(a);
          }
        }
      } catch (e) {
        console.warn(`  ↳ [WARN] Feed failed: ${e.message}`);
      }
    }

    console.log(`  Total unique articles: ${allArticles.length}`);

    // Push new articles
    for (const article of allArticles) {
      if (history.includes(article.id)) continue;

      console.log(`  [NEW] ${article.title.substring(0, 60)}...`);

      try {
        const [tTitle, tExcerpt] = await Promise.all([
          translate(article.title, { to: 'zh-TW' }),
          article.excerpt
            ? translate(article.excerpt, { to: 'zh-TW' })
            : Promise.resolve({ text: '' }),
        ]);

        // Format pub date
        let pubDateStr = '';
        if (article.pubDate) {
          try {
            const d = new Date(article.pubDate);
            pubDateStr = `📅 ${d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}\n`;
          } catch {}
        }

        const message =
          `*${escapeMarkdown(source.label)}*\n\n` +
          `*${escapeMarkdown(tTitle.text)}*\n` +
          `_${escapeMarkdown(article.title)}_\n\n` +
          (tExcerpt.text ? `${escapeMarkdown(tExcerpt.text)}\n\n` : '') +
          pubDateStr +
          `🔗 [閱讀全文](${article.url})`;

        if (article.image) {
          await bot.sendPhoto(chatId, article.image, {
            caption: message,
            parse_mode: 'Markdown',
          }).catch(() =>
            // Fallback if image fails
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' })
          );
        } else {
          await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }

        history.push(article.id);
        totalSent++;
        console.log(`  [SENT] ✓`);

        // Throttle to avoid Telegram rate limits
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.error(`  [FAIL] ${err.message}`);
      }
    }
  }

  // Save history (keep last 1000 entries)
  const trimmedHistory = history.slice(-1000);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmedHistory, null, 2));
  console.log(`\n=== Done. Sent ${totalSent} new article(s). ===`);
}

// Escape Telegram Markdown special chars
function escapeMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
}

pushArticles().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
