import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';

// ── DeepL Translator ─────────────────────────────────────────────────────────
/**
 * Translate text using DeepL Free API.
 * Falls back to original text if API key is missing or request fails.
 */
async function safeTranslate(text) {
  if (!text || !text.trim()) return text || '';

  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    console.warn('  [TRANSLATE] No DEEPL_API_KEY set, skipping translation.');
    return text;
  }

  // DeepL Free tier uses api-free.deepl.com (key ends with :fx)
  const endpoint = 'https://api-free.deepl.com/v2/translate';
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [text],
          target_lang: 'ZH-HANT',  // Traditional Chinese (繁體中文)
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`DeepL HTTP ${res.status}: ${errText.substring(0, 100)}`);
      }

      const data = await res.json();
      return data?.translations?.[0]?.text || text;
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = attempt * 1500;
        console.warn(`  [TRANSLATE] Retry ${attempt}/${maxRetries} after ${delay}ms: ${err.message.substring(0, 80)}`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.warn(`  [TRANSLATE] All retries failed, using original text: ${err.message.substring(0, 80)}`);
        return text;
      }
    }
  }
  return text;
}

// ── Config ────────────────────────────────────────────────────────────────────
// Only push articles published within this many hours
// ── Config ────────────────────────────────────────────────────────────────────
// Only push articles published within this many hours (prevents pushing obsolete articles)
const MAX_AGE_HOURS = 168; // 7 days window for rich rotation pool

// Minimum title word count — filters out stub items
const MIN_TITLE_WORDS = 3;

// Category labels to filter out
const STUB_PATTERNS = [
  /^(politics|business|cartoon|letters|corrections|leaders|briefing|world this week|special report|graphic detail|finance & economics)$/i,
  /^cartoon:\s*$/i,
];

// ── RSS Feed Definitions ──────────────────────────────────────────────────────
const OFFICIAL_RSS_SOURCES = {
  'financial times': {
    label: '金融時報 Financial Times',
    feeds: [
      'https://www.ft.com/rss/home',
      'https://www.ft.com/rss/home/uk',
      'https://www.ft.com/global-economy?format=rss',
      'https://www.ft.com/world?format=rss',
      'https://www.ft.com/companies?format=rss',
    ],
  },
  'the economist': {
    label: '經濟學人 The Economist',
    feeds: [
      'https://www.economist.com/leaders/rss.xml',
      'https://www.economist.com/finance-and-economics/rss.xml',
      'https://www.economist.com/business/rss.xml',
      'https://www.economist.com/united-states/rss.xml',
      'https://www.economist.com/china/rss.xml',
      'https://www.economist.com/asia/rss.xml',
      'https://www.economist.com/international/rss.xml',
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Sanitize text by stripping CDATA wrappers, HTML tags, and decoding entities.
 */
function sanitizeText(text) {
  if (!text) return '';
  return decodeEntities(
    text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<!\[CDATA\[/gi, '')
      .replace(/\]\]>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Extract text from a tag that may use CDATA or plain text.
 */
function extractTagText(item, tagName) {
  const cdataRe = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`, 'i');
  const cdataMatch = item.match(cdataRe);
  if (cdataMatch) return sanitizeText(cdataMatch[1]);

  const plainRe = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const plainMatch = item.match(plainRe);
  if (plainMatch) return sanitizeText(plainMatch[1]);

  return null;
}

/** Escape Telegram MarkdownV1 special characters */
function escapeMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[');
}

// ── RSS Parser ────────────────────────────────────────────────────────────────
async function fetchArticlesFromRSS(feedUrl) {
  const res = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${feedUrl}`);

  const text = await res.text();
  const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
  const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;

  return items.map(item => {
    const rawTitle = extractTagText(item, 'title');
    const rawLink  = extractTagText(item, 'link') ||
                     (item.match(/<guid[^>]*isPermaLink="true"[^>]*>([\s\S]*?)<\/guid>/i) || [])[1];
    const rawDesc  = extractTagText(item, 'description');
    const rawDate  = extractTagText(item, 'pubDate');

    if (!rawTitle || !rawLink) return null;

    const title = sanitizeText(rawTitle);
    const url   = sanitizeText(rawLink).replace(/\?.*$/, '');

    // ── Date filter: require valid pubDate within MAX_AGE_HOURS ──
    if (rawDate) {
      const pubTime = new Date(rawDate).getTime();
      if (!isNaN(pubTime) && pubTime < cutoff) return null;
    }

    // ── Title quality filter: skip short stubs or section titles ──
    if (title.split(/\s+/).length < MIN_TITLE_WORDS) return null;
    if (STUB_PATTERNS.some(p => p.test(title))) return null;

    // Extract image
    const imgMatch = item.match(/media:content[^>]+url="([^"]+)"/i) ||
                     item.match(/media:thumbnail[^>]+url="([^"]+)"/i) ||
                     item.match(/enclosure[^>]+url="([^"]+)"/i);

    // Clean description
    const excerpt = rawDesc ? sanitizeText(rawDesc).substring(0, 280) : '';

    return {
      id: url,
      title,
      excerpt,
      url: rawLink.trim(),
      image: imgMatch ? imgMatch[1] : null,
      pubDate: rawDate || '',
    };
  }).filter(Boolean);
}

// ── History ───────────────────────────────────────────────────────────────────
const HISTORY_FILE = './history.json';
const history = fs.existsSync(HISTORY_FILE)
  ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
  : [];

function recordPushedArticle(article, sourceLabel, titleZh) {
  const existingIndex = history.findIndex(item => (typeof item === 'string' ? item : item.id) === article.id);
  const record = {
    id: article.id,
    title: article.title,
    titleZh: titleZh,
    source: sourceLabel,
    url: article.url,
    image: article.image || null,
    pushedAt: new Date().toISOString()
  };

  if (existingIndex !== -1) {
    history[existingIndex] = record;
  } else {
    history.push(record);
  }
}

async function sendArticleToTelegram(bot, chatId, article, sourceLabel, cachedTitleZh = null) {
  const titleZh = cachedTitleZh || await safeTranslate(article.title);
  let excerptZh = '';
  if (article.excerpt) {
    excerptZh = await safeTranslate(article.excerpt);
  }

  // Format pub date
  let pubDateStr = '';
  if (article.pubDate) {
    try {
      const d = new Date(article.pubDate);
      pubDateStr = `📅 ${d.toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })}\n`;
    } catch {}
  }

  const message =
    `*${escapeMarkdown(sourceLabel)}*\n\n` +
    `*${escapeMarkdown(titleZh)}*\n` +
    `_${escapeMarkdown(article.title)}_\n\n` +
    (excerptZh ? `${escapeMarkdown(excerptZh)}\n\n` : '') +
    pubDateStr +
    `🔗 [閱讀全文](${article.url})`;

  if (article.image) {
    await bot.sendPhoto(chatId, article.image, {
      caption: message,
      parse_mode: 'Markdown',
    }).catch(() =>
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' })
    );
  } else {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  recordPushedArticle(article, sourceLabel, titleZh);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function pushArticles() {
  const telegramToken = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.CHAT_ID;
  const subscriptionsString = process.env.SUBSCRIPTIONS || 'The Economist, The New York Times, Financial Times';
  const sites = subscriptionsString.split(',').map(s => s.trim());

  if (!telegramToken || !chatId) {
    console.error('Missing TELEGRAM_TOKEN or CHAT_ID environment variables.');
    process.exit(1);
  }

  const bot = new TelegramBot(telegramToken, { polling: false });
  let newSent = 0;
  let replayedSent = 0;

  // Collect unique articles across all feeds
  const seen = new Set();
  const allArticles = [];

  for (const siteName of sites) {
    const sourceKey = Object.keys(OFFICIAL_RSS_SOURCES).find(k =>
      siteName.toLowerCase().includes(k)
    );

    if (!sourceKey) {
      console.log(`[SKIP] No RSS config for: ${siteName}`);
      continue;
    }

    const source = OFFICIAL_RSS_SOURCES[sourceKey];
    console.log(`\n[CHECK] ${source.label} — fetching ${source.feeds.length} feed(s)...`);

    for (const feedUrl of source.feeds) {
      try {
        const articles = await fetchArticlesFromRSS(feedUrl);
        for (const a of articles) {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            allArticles.push({ article: a, source });
          }
        }
      } catch (e) {
        console.warn(`  ↳ [WARN] Feed failed (${feedUrl}): ${e.message}`);
      }
    }
  }

  console.log(`\n📊 總共自訂閱來源抓取 ${allArticles.length} 篇有效文章`);

  // Identify brand new articles (not present in history)
  const newArticles = allArticles.filter(item =>
    !history.some(h => (typeof h === 'string' ? h : h.id) === item.article.id)
  );

  if (newArticles.length > 0) {
    console.log(`📢 發現 ${newArticles.length} 篇全新新聞，優先推播：`);
    for (const { article, source } of newArticles) {
      console.log(`  [NEW] ${article.title.substring(0, 70)}`);
      try {
        await sendArticleToTelegram(bot, chatId, article, source.label);
        newSent++;
        console.log(`  [SENT NEW] ✓`);
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.error(`  [FAIL NEW] ${err.message}`);
      }
    }
  } else {
    console.log(`🔄 目前無全新文章，啟動無縫輪播機制（Round-Robin Carousel）...`);
    // Find candidates from allArticles sorted by last pushed timestamp ascending
    const candidates = allArticles.map(item => {
      const histEntry = history.find(h => (typeof h === 'string' ? h : h.id) === item.article.id);
      const lastPushedAt = (histEntry && typeof histEntry === 'object' && histEntry.pushedAt)
        ? new Date(histEntry.pushedAt).getTime()
        : 0;
      return {
        ...item,
        histEntry,
        lastPushedAt,
      };
    }).sort((a, b) => a.lastPushedAt - b.lastPushedAt);

    if (candidates.length > 0) {
      const target = candidates[0];
      const lastTimeStr = target.lastPushedAt ? new Date(target.lastPushedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '首次推播';
      console.log(`  [CAROUSEL] 輪播文章: ${target.article.title.substring(0, 60)} (前次推播: ${lastTimeStr})`);
      try {
        const cachedZh = (target.histEntry && typeof target.histEntry === 'object' && target.histEntry.titleZh)
          ? target.histEntry.titleZh
          : null;
        await sendArticleToTelegram(bot, chatId, target.article, target.source.label, cachedZh);
        replayedSent++;
        console.log(`  [SENT CAROUSEL] ✓`);
      } catch (err) {
        console.error(`  [FAIL CAROUSEL] ${err.message}`);
      }
    } else {
      console.log(`⚠️ 無候選文章可供輪播`);
    }
  }

  // Save history (keep last 1000 entries)
  const trimmedHistory = history.slice(-1000);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmedHistory, null, 2));

  // Write status flag for workflow commit decision
  try {
    fs.writeFileSync('./.last_push_status.json', JSON.stringify({
      newSent,
      replayedSent,
      timestamp: new Date().toISOString()
    }));
  } catch {}

  console.log(`\n=== 推播完成：全新 ${newSent} 則 / 輪播 ${replayedSent} 則 ===`);
}

pushArticles().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
