import fs from 'fs';
import path from 'path';

// Pure JavaScript SQLite-compatible JSON storage adapter.
// Solves Vercel serverless native binary issues and read-only filesystem restrictions.
let dataFilePath = path.resolve(process.cwd(), './news-data.json');
let inMemoryData = null;

function getStore() {
  if (inMemoryData) return inMemoryData;

  const defaultStore = {
    config: {},
    subscriptions: {
      'The Economist': 1,
      'The New York Times': 1,
      'Financial Times': 1,
    },
    pushed_articles: []
  };

  try {
    if (fs.existsSync(dataFilePath)) {
      const raw = fs.readFileSync(dataFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        inMemoryData = parsed;
      }
    }
  } catch (err) {
    // If working directory is read-only (e.g. on Vercel), switch to /tmp
    dataFilePath = path.join('/tmp', 'news-data.json');
    try {
      if (fs.existsSync(dataFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          inMemoryData = parsed;
        }
      }
    } catch {}
  }

  if (!inMemoryData || typeof inMemoryData !== 'object' || Array.isArray(inMemoryData)) {
    inMemoryData = defaultStore;
  }

  inMemoryData.config = inMemoryData.config || {};
  inMemoryData.subscriptions = inMemoryData.subscriptions || {
    'The Economist': 1,
    'The New York Times': 1,
    'Financial Times': 1,
  };
  inMemoryData.pushed_articles = Array.isArray(inMemoryData.pushed_articles) ? inMemoryData.pushed_articles : [];

  saveStore();
  return inMemoryData;
}

function saveStore() {
  if (!inMemoryData) return;
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(inMemoryData, null, 2), 'utf8');
  } catch {
    try {
      dataFilePath = path.join('/tmp', 'news-data.json');
      fs.writeFileSync(dataFilePath, JSON.stringify(inMemoryData, null, 2), 'utf8');
    } catch {
      // Memory fallback if write fails completely
    }
  }
}

const db = {
  pragma: () => {},
  exec: () => {},
  prepare: (sql) => {
    const s = sql.trim();

    return {
      all: (...args) => {
        const store = getStore();

        if (/SELECT\s+key,\s*value\s+FROM\s+config/i.test(s)) {
          return Object.entries(store.config).map(([key, value]) => ({ key, value }));
        }

        if (/SELECT\s+site_name\s+FROM\s+subscriptions\s+WHERE\s+enabled\s*=\s*1/i.test(s)) {
          return Object.entries(store.subscriptions)
            .filter(([, enabled]) => enabled === 1)
            .map(([site_name]) => ({ site_name }));
        }

        if (/SELECT\s+site_name,\s*enabled\s+FROM\s+subscriptions/i.test(s)) {
          return Object.entries(store.subscriptions).map(([site_name, enabled]) => ({ site_name, enabled }));
        }

        if (/SELECT\s+.*FROM\s+pushed_articles/i.test(s)) {
          return store.pushed_articles || [];
        }

        return [];
      },

      get: (...args) => {
        const store = getStore();

        if (/SELECT\s+value\s+FROM\s+config\s+WHERE\s+key\s*=\s*\?/i.test(s)) {
          const key = args[0];
          return store.config[key] ? { value: store.config[key] } : undefined;
        }

        if (/SELECT\s+1\s+FROM\s+pushed_articles\s+WHERE\s+url\s*=\s*\?/i.test(s)) {
          const url = args[0];
          const exists = (store.pushed_articles || []).some(a => a.url === url);
          return exists ? { 1: 1 } : undefined;
        }

        return undefined;
      },

      run: (...args) => {
        const store = getStore();

        if (/INSERT\s+OR\s+REPLACE\s+INTO\s+config/i.test(s)) {
          const [key, val] = args;
          store.config[key] = val;
          saveStore();
          return { changes: 1 };
        }

        if (/INSERT\s+OR\s+REPLACE\s+INTO\s+subscriptions/i.test(s)) {
          const [site_name, enabled] = args;
          store.subscriptions[site_name] = enabled ? 1 : 0;
          saveStore();
          return { changes: 1 };
        }

        if (/INSERT\s+INTO\s+pushed_articles/i.test(s)) {
          const [url, title] = args;
          store.pushed_articles = store.pushed_articles || [];
          store.pushed_articles.push({ url, title, pushed_at: new Date().toISOString() });
          if (store.pushed_articles.length > 500) {
            store.pushed_articles = store.pushed_articles.slice(-500);
          }
          saveStore();
          return { changes: 1 };
        }

        return { changes: 0 };
      }
    };
  }
};

export default db;
