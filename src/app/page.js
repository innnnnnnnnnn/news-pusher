'use client';
import { useState, useEffect } from 'react';

export default function Home() {
  const [sites, setSites] = useState([]);
  const [subscriptions, setSubscriptions] = useState(new Set());
  const [config, setConfig] = useState({ telegramToken: '', chatId: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const [configRes, sitesRes, subsRes] = await Promise.all([
          fetch('/api/config'),
          fetch('/api/sites'),
          fetch('/api/subscriptions')
        ]);
        
        const configData = await configRes.json();
        const sitesData = await sitesRes.json();
        const subsData = await subsRes.json();

        setConfig(configData.config || { telegramToken: '', chatId: '' });
        setSites(sitesData.sites || []);
        setSubscriptions(new Set(subsData.subscriptions || []));
      } catch (err) {
        console.error('Failed to load data', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const saveConfig = async (e) => {
    e.preventDefault();
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
    setSaving(true);
    try {
      const res = await fetch('/api/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      if (res.ok) {
        showToast('🔔 Test message sent! Please check Telegram.');
      } else {
        showToast('❌ Error: ' + data.error);
      }
    } catch (err) {
      showToast('❌ Connection Failed');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const toggleSubscription = async (site) => {
    const isSubscribed = subscriptions.has(site);
    const newStatus = !isSubscribed;
    
    // Optimistic UI update
    const newSubs = new Set(subscriptions);
    if (newStatus) newSubs.add(site);
    else newSubs.delete(site);
    setSubscriptions(newSubs);

    await fetch('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_name: site, enabled: newStatus })
    });
    showToast(newStatus ? `Subscribed to ${site}` : `Unsubscribed from ${site}`);
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
        <h1>News Pusher</h1>
        <p>Bypass paywalls and push news to your Telegram Bot automatically</p>
      </header>
      
      <div className="grid">
        <section className="glass-panel">
          <h2>Telegram Configuration</h2>
          <form onSubmit={saveConfig} style={{ marginTop: '20px' }}>
            <div className="form-group">
              <label>Bot Token</label>
              <input 
                type="password" 
                className="form-control" 
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                value={config.telegramToken || ''}
                onChange={e => setConfig({...config, telegramToken: e.target.value})}
              />
            </div>
            <div className="form-group">
              <label>Chat ID / Channel ID</label>
              <input 
                type="text" 
                className="form-control" 
                placeholder="e.g. -100123456789"
                value={config.chatId || ''}
                onChange={e => setConfig({...config, chatId: e.target.value})}
              />
            </div>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            <button 
              type="button" 
              className="btn" 
              style={{ background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', marginTop: '10px' }}
              disabled={saving}
              onClick={testTelegram}
            >
              Test Connection
            </button>
          </form>
          
          <div style={{ marginTop: '40px' }}>
            <h2>Testing & Actions</h2>
            <p style={{ fontSize: '0.9rem', opacity: 0.8, margin: '10px 0' }}>
              Manually trigger background job to scrape news and push to Telegram based on active subscriptions.
            </p>
            <button 
              className="btn" 
              style={{ background: 'var(--accent)', marginTop: '10px' }}
              onClick={async () => {
                showToast('Triggering push job...');
                await fetch('/api/cron/trigger', { method: 'POST' });
              }}
            >
              Run Push Job Now
            </button>
          </div>
        </section>

        <section className="glass-panel">
          <h2>News Sources</h2>
          <p style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '15px' }}>
            Select sites to automatically fetch and bypass. ({subscriptions.size} selected)
          </p>
          
          <div className="site-list">
             <p>Select sites to push news from</p>
            {sites.length === 0 ? <p>No sites found in extension config.</p> : sites.map(site => (
              <div key={site} className="site-item">
                <span style={{ fontWeight: 500 }}>{site}</span>
                <label className="switch">
                  <input 
                    type="checkbox" 
                    checked={subscriptions.has(site)}
                    onChange={() => toggleSubscription(site)}
                  />
                  <span className="slider"></span>
                </label>
              </div>
            ))}
          </div>
        </section>
      </div>

      {toast && (
        <div className="toast">{toast}</div>
      )}
    </main>
  );
}
