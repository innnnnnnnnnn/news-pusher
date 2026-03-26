import { NextResponse } from 'next/server';
import { runPushJob } from '@/lib/worker';

export async function POST(req) {
  try {
    // Run in background without awaiting so API returns fast
    runPushJob().catch(console.error);
    return NextResponse.json({ success: true, message: 'Push job started' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
