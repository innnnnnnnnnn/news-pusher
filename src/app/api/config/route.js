import db from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  const stmt = db.prepare('SELECT key, value FROM config');
  const rows = stmt.all();
  const config = {};
  rows.forEach(row => { config[row.key] = row.value; });
  return NextResponse.json({ config });
}

export async function POST(req) {
  const { telegramToken, chatId } = await req.json();
  const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  stmt.run('telegramToken', telegramToken || '');
  stmt.run('chatId', chatId || '');
  return NextResponse.json({ success: true });
}
