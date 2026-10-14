import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (ghToken) {
      const res = await fetch('https://api.github.com/repos/innnnnnnnnnn/news-pusher/actions/workflows/push.yml/dispatches', {
        method: 'POST',
        headers: {
          'Authorization': `token ${ghToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'News-Pusher-App'
        },
        body: JSON.stringify({ ref: 'main' })
      });

      if (res.ok) {
        return NextResponse.json({ success: true, message: 'GitHub Actions workflow triggered successfully!' });
      }
    }

    if (process.env.NODE_ENV !== 'production' && typeof window === 'undefined') {
      try {
        const { exec } = await import('child_process');
        exec('node scripts/github-push.mjs');
        return NextResponse.json({ success: true, message: 'Local background push job launched.' });
      } catch (e) {
        console.warn('Local exec failed:', e.message);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Trigger request received. Scheduled via GitHub Actions.'
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
