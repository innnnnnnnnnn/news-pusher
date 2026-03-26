import db from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  const stmt = db.prepare('SELECT site_name FROM subscriptions WHERE enabled = 1');
  const rows = stmt.all();
  return NextResponse.json({ subscriptions: rows.map(r => r.site_name) });
}

export async function POST(req) {
  const { site_name, enabled } = await req.json();
  const stmt = db.prepare('INSERT OR REPLACE INTO subscriptions (site_name, enabled) VALUES (?, ?)');
  stmt.run(site_name, enabled ? 1 : 0);
  return NextResponse.json({ success: true });
}
