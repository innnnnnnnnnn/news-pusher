'use client';
import { useState, useEffect } from 'react';

export default function Home() {
  const [sites, setSites] = useState([]);
  const [subscriptions, setSubscriptions] = useState(new Set());
  const [history, setHistory] = useState([]);
  const [config, setConfig] = useState({ telegramToken: '', chatId: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [isStatic, setIsStatic] = useState(false);

  useEffect(() => {
    async function loadData() {
      const isGithub = typeof window !== 'undefined' && window.location.hostname.includes('github.io');
      setIsStatic(isGithub);

      try {
        if (isGithub) {
          // Static Mode: Just load history
          try {
            const histRes = await fetch('./history.json');
            if (histRes.ok) setHistory(await histRes.json());
          } catch (e) {}
        } else {
          // Local/Dynamic Mode
          const [configRes, sitesRes, subsRes] = await Promise.all([
            fetch('/api/config'),
            fetch('/api/sites'),
            fetch('/api/subscriptions')
          ]);
          
          if (configRes.ok) setConfig((await configRes.json()).config || { telegramToken: '', chatId: '' });
          if (sitesRes.ok) setSites((await sitesRes.json()).sites || []);
          if (subsRes.ok) setSubscriptions(new Set((await subsRes.json()).subscriptions || []));
        }
      } catch (err) {
        console.error('Failed to load data', err);
        setIsStatic(true); // Fallback to static if APIs fail
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const saveConfig = async (e) => {
    e.preventDefault();
    if (isStatic) return;
    setSaving(true);
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    setSaving(false);
    showToast('Configuration Saved!');
  };

  const testTelegram = async () => {
    if (isStatic) return;
    setSaving(true);
    try {
      const res = await fetch('/api/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      if (res.ok) {
        showToast('🔔 Test message sent!');
      } else {
        showToast('❌ Error: ' + data.error);
      }
    } catch (err) {
      showToast('❌ Connection Failed');
    } finally {
      setSaving(false);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  if (loading) {
    return (
      <div className="container" style={{ display: 'flex', justifyContent: 'center', marginTop: '100px' }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <main className="container">
      <header className="header">
        <h1>News Pusher {isStatic && <span style={{fontSize: '1rem', opacity: 0.6}}>(Cloud Dashboard)</span>}</h1>
        <p>Bypass paywalls and push news to your Telegram Bot automatically</p>
      </header>
      
      {isStatic && (
        <div className="glass-panel" style={{ marginBottom: '30px', border: '1px solid var(--accent)' }}>
          <h3 style={{ color: 'var(--accent)' }}>☁️ Cloud Mode Active</h3>
          <p>
            You are viewing the <strong>GitHub Pages</strong> dashboard. 
            Settings and manual triggers are disabled here. To update configuration, 
            please use <strong>GitHub Secrets</strong> or run the application locally.
          </p>
        </div>
      )}

      <div className="grid">
        <section className="glass-panel" style={{ opacity: isStatic ? 0.6 : 1, pointerEvents: isStatic ? 'none' : 'auto' }}>
          <h2>Telegram Configuration</h2>
          <form onSubmit={saveConfig} style={{ marginTop: '20px' }}>
             <div className="form-group">
              <label>Bot Token</label>
              <input 
                type="password" 
                className="form-control" 
                disabled={isStatic}
                value={config.telegramToken || ''}
                autoComplete="off"
                onChange={e => setConfig({...config, telegramToken: e.target.value})}
              />
            </div>
            <div className="form-group">
              <label>Chat ID / Channel ID</label>
              <input 
                type="text" 
                className="form-control" 
                disabled={isStatic}
                value={config.chatId || ''}
                onChange={e => setConfig({...config, chatId: e.target.value})}
              />
            </div>
            <button type="submit" className="btn" disabled={saving || isStatic}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            <button 
              type="button" 
              className="btn" 
              style={{ background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', marginTop: '10px' }}
              disabled={saving || isStatic}
              onClick={testTelegram}
            >
              Test Connection
            </button>
          </form>
        </section>

        <section className="glass-panel">
          <h2>{isStatic ? 'Recently Pushed' : 'News Sources'}</h2>
          
          {isStatic ? (
             <div className="site-list" style={{maxHeight: '400px', overflowY: 'auto'}}>
               {history.length === 0 ? <p>No logs found yet.</p> : history.slice().reverse().map((url, i) => (
                 <div key={i} className="site-item" style={{display: 'block', padding: '10px 0'}}>
                   <a href={url} target="_blank" rel="noreferrer" style={{color: 'var(--primary)', fontSize: '0.85rem', wordBreak: 'break-all'}}>
                     {url.substring(0, 100)}{url.length > 100 ? '...' : ''}
                   </a>
                 </div>
               ))}
             </div>
          ) : (
            <div className="site-list">
              {sites.map(site => (
                <div key={site} className="site-item">
                  <span>{site}</span>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={subscriptions.has(site)}
                      onChange={() => {/* toggling subscription logic */}}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {toast && (
        <div className="toast">{toast}</div>
      )}
    </main>
  );
}
