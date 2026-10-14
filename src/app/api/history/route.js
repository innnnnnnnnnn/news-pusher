import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function slugToTitle(slug) {
  if (!slug) return '';
  return slug
    .replace(/\.html?$/i, '')
    .split(/[-_]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function parseUrlHistoryItem(url) {
  let source = '全球新聞 Global News';
  let title = '';
  let dateStr = '';

  try {
    const u = new URL(url);
    const pathname = u.pathname;
    const parts = pathname.split('/').filter(Boolean);
    const lastPart = parts[parts.length - 1] || '';

    if (u.hostname.includes('economist.com')) {
      source = '經濟學人 The Economist';
      title = slugToTitle(lastPart);
      // Format: /section/YYYY/MM/DD/slug
      const dateMatch = pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      if (dateMatch) {
        dateStr = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      }
    } else if (u.hostname.includes('ft.com')) {
      source = '金融時報 Financial Times';
      title = slugToTitle(lastPart);
    } else if (u.hostname.includes('nytimes.com')) {
      source = '紐約時報 New York Times';
      title = slugToTitle(lastPart);
      const dateMatch = pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      if (dateMatch) {
        dateStr = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      }
    } else {
      source = u.hostname.replace(/^www\./, '');
      title = slugToTitle(lastPart);
    }
  } catch {
    title = url;
  }

  return {
    id: url,
    url,
    title: title || url,
    titleZh: '',
    source,
    pushedAt: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
  };
}

export async function GET() {
  let rawList = [];

  // 1. Try local history.json
  try {
    const localPath = path.resolve(process.cwd(), './history.json');
    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, 'utf8');
      rawList = JSON.parse(content);
    }
  } catch (err) {
    console.warn('Local history read failed:', err.message);
  }

  // 2. Fallback to GitHub raw if local is empty (common in fresh Vercel deploys)
  if (!rawList || rawList.length === 0) {
    try {
      const res = await fetch('https://raw.githubusercontent.com/innnnnnnnnnn/news-pusher/main/history.json', {
        next: { revalidate: 60 }
      });
      if (res.ok) {
        rawList = await res.json();
      }
    } catch (err) {
      console.warn('Remote history fetch failed:', err.message);
    }
  }

  // Normalize each article item
  const articles = (rawList || []).map(item => {
    if (typeof item === 'string') {
      return parseUrlHistoryItem(item);
    }
    return {
      id: item.id || item.url,
      url: item.url || item.id,
      title: item.title || '',
      titleZh: item.titleZh || '',
      source: item.source || '新聞來源',
      image: item.image || null,
      pushedAt: item.pushedAt || new Date().toISOString()
    };
  });

  // Reverse so the newest pushed articles are shown first
  articles.reverse();

  return NextResponse.json({
    success: true,
    count: articles.length,
    articles
  }, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120'
    }
  });
}
