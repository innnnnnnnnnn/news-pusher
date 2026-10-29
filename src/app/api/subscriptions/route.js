import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const REPO_OWNER = 'innnnnnnnnnn';
const REPO_NAME = 'news-pusher';
const FILE_PATH = 'subscriptions.json';

export async function GET() {
  let list = [];

  // 1. Fetch directly from GitHub raw (latest source of truth)
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${FILE_PATH}?t=${Date.now()}`, {
      cache: 'no-store'
    });
    if (res.ok) {
      const parsed = await res.json();
      list = Array.isArray(parsed) ? parsed : (parsed.subscriptions || []);
    }
  } catch (err) {
    console.warn('Failed to fetch from GitHub raw:', err.message);
  }

  // 2. Fallback to local subscriptions.json
  if (!list || list.length === 0) {
    try {
      const localPath = path.resolve(process.cwd(), './subscriptions.json');
      if (fs.existsSync(localPath)) {
        const parsed = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        list = Array.isArray(parsed) ? parsed : (parsed.subscriptions || []);
      }
    } catch {}
  }

  // 3. Fallback default
  if (!list || list.length === 0) {
    list = [
      'The Economist',
      'Financial Times',
      'The New York Times',
      'The Wall Street Journal',
      'Bloomberg',
      'Reuters',
      'BBC USA',
      'CNBC (news only)'
    ];
  }

  return NextResponse.json({
    success: true,
    subscriptions: list
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0'
    }
  });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const token = body.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT;

    let updatedList = [];

    // Support full array or single toggle
    if (Array.isArray(body.subscriptions)) {
      updatedList = body.subscriptions;
    } else if (body.site_name) {
      // First get current subscriptions
      let currentList = [];
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${FILE_PATH}?t=${Date.now()}`, {
          cache: 'no-store'
        });
        if (res.ok) {
          const parsed = await res.json();
          currentList = Array.isArray(parsed) ? parsed : (parsed.subscriptions || []);
        }
      } catch {}

      const set = new Set(currentList);
      if (body.enabled) {
        set.add(body.site_name);
      } else {
        set.delete(body.site_name);
      }
      updatedList = Array.from(set);
    }

    // Try local write (if local node env)
    try {
      const localPath = path.resolve(process.cwd(), './subscriptions.json');
      if (fs.existsSync(localPath)) {
        fs.writeFileSync(localPath, JSON.stringify({
          updatedAt: new Date().toISOString(),
          subscriptions: updatedList
        }, null, 2), 'utf8');
      }
    } catch {}

    // If GitHub token available, sync to GitHub repository
    let syncedToGitHub = false;
    let githubError = null;

    if (token) {
      try {
        const getUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
        const getRes = await fetch(getUrl, {
          headers: {
            'Authorization': `Bearer ${token.trim()}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'News-Pusher-Vercel'
          }
        });

        let sha = null;
        if (getRes.ok) {
          const fileData = await getRes.json();
          sha = fileData.sha;
        }

        const jsonString = JSON.stringify({
          updatedAt: new Date().toISOString(),
          subscriptions: updatedList
        }, null, 2);

        const base64Content = Buffer.from(jsonString, 'utf8').toString('base64');

        const putBody = {
          message: `update: sync subscriptions via Vercel dashboard [skip ci]`,
          content: base64Content,
          branch: 'main'
        };
        if (sha) putBody.sha = sha;

        const putRes = await fetch(getUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token.trim()}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'News-Pusher-Vercel'
          },
          body: JSON.stringify(putBody)
        });

        if (putRes.ok) {
          syncedToGitHub = true;
        } else {
          const errData = await putRes.json().catch(() => ({}));
          githubError = errData.message || `HTTP ${putRes.status}`;
        }
      } catch (err) {
        githubError = err.message;
      }
    }

    return NextResponse.json({
      success: true,
      subscriptions: updatedList,
      syncedToGitHub,
      githubError
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 400 });
  }
}
