import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  let list = [];

  // 1. Try local subscriptions.json
  try {
    const localPath = path.resolve(process.cwd(), './subscriptions.json');
    if (fs.existsSync(localPath)) {
      const parsed = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      list = Array.isArray(parsed) ? parsed : (parsed.subscriptions || []);
    }
  } catch {}

  // 2. Fallback to GitHub raw subscriptions.json
  if (!list || list.length === 0) {
    try {
      const res = await fetch('https://raw.githubusercontent.com/innnnnnnnnnn/news-pusher/main/subscriptions.json', {
        next: { revalidate: 15 }
      });
      if (res.ok) {
        const parsed = await res.json();
        list = Array.isArray(parsed) ? parsed : (parsed.subscriptions || []);
      }
    } catch {}
  }

  // 3. Fallback default if still empty
  if (!list || list.length === 0) {
    list = ['The Economist', 'Financial Times', 'The New York Times'];
  }

  return NextResponse.json({
    success: true,
    subscriptions: list
  }, {
    headers: {
      'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30'
    }
  });
}

export async function POST(req) {
  try {
    const body = await req.json();
    return NextResponse.json({ success: true, received: body });
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }
}
