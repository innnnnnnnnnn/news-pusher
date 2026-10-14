'use client';
import { useState, useEffect, useMemo } from 'react';

export default function Home() {
  const [activeTab, setActiveTab] = useState('history'); // 'history' | 'sources' | 'settings'

  // Sites & Subscriptions
  const [sites, setSites] = useState([]);
  const [siteDetails, setSiteDetails] = useState([]);
  const [subscriptions, setSubscriptions] = useState(new Set(['The Economist', 'The New York Times', 'Financial Times']));
  const [siteSearch, setSiteSearch] = useState('');
  const [siteFilter, setSiteFilter] = useState('all'); // 'all' | 'recommended' | 'rss' | 'subscribed'

  // Pushed History
  const [historyArticles, setHistoryArticles] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historySourceFilter, setHistorySourceFilter] = useState('all');

  // Telegram Config
  const [config, setConfig] = useState({ telegramToken: '', chatId: '' });
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [toast, setToast] = useState('');

  // 1. Load data independently with resilience
  useEffect(() => {
    // Load local storage cache if available
    try {
      const cachedConfig = localStorage.getItem('np_config');
      if (cachedConfig) setConfig(JSON.parse(cachedConfig));

      const cachedSubs = localStorage.getItem('np_subscriptions');
      if (cachedSubs) setSubscriptions(new Set(JSON.parse(cachedSubs)));
    } catch {}

    // Load Sites
    fetch('/api/sites')
      .then(r => r.json())
      .then(data => {
        if (data.sites) setSites(data.sites);
        if (data.siteDetails) setSiteDetails(data.siteDetails);
      })
      .catch(err => console.warn('Failed to load sites:', err));

    // Load Subscriptions
    fetch('/api/subscriptions')
      .then(r => r.json())
      .then(data => {
        if (data.subscriptions && data.subscriptions.length > 0) {
          const subsSet = new Set(data.subscriptions);
          setSubscriptions(subsSet);
          localStorage.setItem('np_subscriptions', JSON.stringify(Array.from(subsSet)));
        }
      })
      .catch(err => console.warn('Failed to load subscriptions:', err));

    // Load Config
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        if (data.config && (data.config.telegramToken || data.config.chatId)) {
          setConfig(data.config);
          localStorage.setItem('np_config', JSON.stringify(data.config));
        }
      })
      .catch(err => console.warn('Failed to load config:', err));

    // Load History
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      if (data.articles) {
        setHistoryArticles(data.articles);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  // Toggle single site subscription
  const toggleSubscription = async (siteName) => {
    const isSubscribed = subscriptions.has(siteName);
    const newStatus = !isSubscribed;
    const newSubs = new Set(subscriptions);

    if (newStatus) newSubs.add(siteName);
    else newSubs.delete(siteName);

    setSubscriptions(newSubs);
    try {
      localStorage.setItem('np_subscriptions', JSON.stringify(Array.from(newSubs)));
    } catch {}

    showToast(newStatus ? `✅ 已訂閱 ${siteName}` : `⚪ 已取消訂閱 ${siteName}`);

    try {
      await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_name: siteName, enabled: newStatus })
      });
    } catch {}
  };

  // Quick subscribe to recommended media
  const subscribeRecommended = async () => {
    const topMedia = [
      'The Economist',
      'Financial Times',
      'The New York Times',
      'The Wall Street Journal',
      'Bloomberg',
      'Reuters',
      'The Washington Post'
    ];
    const newSubs = new Set(subscriptions);
    topMedia.forEach(m => newSubs.add(m));
    setSubscriptions(newSubs);
    localStorage.setItem('np_subscriptions', JSON.stringify(Array.from(newSubs)));
    showToast(`🎉 已一鍵啟用 ${topMedia.length} 個頂級主流媒體`);

    for (const site of topMedia) {
      fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_name: site, enabled: true })
      }).catch(() => {});
    }
  };

  // Copy active subscriptions for GitHub Actions
  const copySubscriptions = () => {
    const subsArray = Array.from(subscriptions);
    if (subsArray.length === 0) {
      showToast('⚠️ 目前尚未選取任何推播來源');
      return;
    }
    const str = subsArray.join(', ');
    navigator.clipboard.writeText(str);
    showToast('📋 已複製訂閱列表！可貼入 GitHub Actions 變數 SUBSCRIPTIONS');
  };

  // Save Telegram Config
  const saveConfig = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      localStorage.setItem('np_config', JSON.stringify(config));
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      showToast('💾 Telegram 設定已儲存！');
    } catch {
      showToast('⚠️ 儲存至本地快取成功');
    } finally {
      setSaving(false);
    }
  };

  // Test Telegram Connection
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
        showToast('🔔 測試訊息已成功發送！請檢查 Telegram。');
      } else {
        showToast('❌ 發送失敗：' + (data.error || '請檢查 Token 與 Chat ID'));
      }
    } catch (err) {
      showToast('❌ 連線失敗');
    } finally {
      setSaving(false);
    }
  };

  // Trigger Push Job Now
  const triggerPushJob = async () => {
    setTriggering(true);
    showToast('🚀 正在觸發新聞推播任務...');
    try {
      const res = await fetch('/api/cron/trigger', { method: 'POST' });
      const data = await res.json();
      showToast('⚡ ' + (data.message || '推播任務已啟動！'));
      setTimeout(loadHistory, 4000);
    } catch {
      showToast('❌ 觸發請求失敗');
    } finally {
      setTriggering(false);
    }
  };

  // Filtered Sites for Sources Management
  const filteredSites = useMemo(() => {
    return siteDetails.filter(site => {
      // 1. Search filter
      const q = siteSearch.trim().toLowerCase();
      const matchSearch = !q || site.name.toLowerCase().includes(q) || site.domain.toLowerCase().includes(q);
      if (!matchSearch) return false;

      // 2. Chip filter
      if (siteFilter === 'recommended') return site.isRecommended;
      if (siteFilter === 'rss') return site.hasRss;
      if (siteFilter === 'subscribed') return subscriptions.has(site.name);
      return true;
    });
  }, [siteDetails, siteSearch, siteFilter, subscriptions]);

  // Filtered Articles for History View
  const filteredArticles = useMemo(() => {
    return historyArticles.filter(a => {
      // Source filter
      if (historySourceFilter !== 'all') {
        if (!a.source.toLowerCase().includes(historySourceFilter.toLowerCase())) return false;
      }
      // Search filter
      const q = historySearch.trim().toLowerCase();
      if (!q) return true;
      return (
        (a.title && a.title.toLowerCase().includes(q)) ||
        (a.titleZh && a.titleZh.toLowerCase().includes(q)) ||
        (a.url && a.url.toLowerCase().includes(q))
      );
    });
  }, [historyArticles, historySourceFilter, historySearch]);

  const getSourceClass = (source) => {
    const s = (source || '').toLowerCase();
    if (s.includes('economist')) return 'economist';
    if (s.includes('financial') || s.includes('ft')) return 'ft';
    if (s.includes('york times') || s.includes('nyt')) return 'nyt';
    return '';
  };

  const formatPushedDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <main className="container">
      {/* Header */}
      <header className="header">
        <div className="header-badge">
          <span className="pulse-dot"></span>
          <span>即時新聞推播引擎 • 全球媒體無障礙直達</span>
        </div>
        <h1>News Pusher 控制台</h1>
        <p>自動繞過付費牆，精選全球主流深度媒體並翻譯推送至 Telegram</p>
      </header>

      {/* Navigation Tabs */}
      <nav className="tabs-nav">
        <button
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <span>📰 即時推播紀錄</span>
          <span className="tab-count">{historyArticles.length}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'sources' ? 'active' : ''}`}
          onClick={() => setActiveTab('sources')}
        >
          <span>🌐 推播來源管理</span>
          <span className="tab-count">{subscriptions.size} / {siteDetails.length || 581}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <span>⚙️ Telegram 設定 & 觸發</span>
        </button>
      </nav>

      {/* TAB 1: 即時推播紀錄 (History) */}
      {activeTab === 'history' && (
        <section className="glass-panel">
          <div className="panel-top">
            <div className="panel-title">
              <span>📰 最近推送文章紀錄</span>
              <span className="subtitle">共 {filteredArticles.length} 篇</span>
            </div>

            <div className="controls-row">
              <div className="search-wrapper">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  className="search-input"
                  placeholder="搜尋文章標題或關鍵字..."
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                />
              </div>

              <button
                className="btn btn-secondary btn-sm"
                onClick={loadHistory}
                disabled={historyLoading}
              >
                {historyLoading ? '載入中...' : '🔄 重新整理'}
              </button>
            </div>
          </div>

          {/* Source Filter Chips */}
          <div className="chip-group">
            <button
              className={`chip ${historySourceFilter === 'all' ? 'active' : ''}`}
              onClick={() => setHistorySourceFilter('all')}
            >
              全部來源 ({historyArticles.length})
            </button>
            <button
              className={`chip ${historySourceFilter === 'economist' ? 'active' : ''}`}
              onClick={() => setHistorySourceFilter('economist')}
            >
              經濟學人
            </button>
            <button
              className={`chip ${historySourceFilter === 'financial' ? 'active' : ''}`}
              onClick={() => setHistorySourceFilter('financial')}
            >
              金融時報
            </button>
            <button
              className={`chip ${historySourceFilter === 'york times' ? 'active' : ''}`}
              onClick={() => setHistorySourceFilter('york times')}
            >
              紐約時報
            </button>
          </div>

          {/* Articles Feed */}
          {historyLoading && historyArticles.length === 0 ? (
            <div className="empty-box">
              <div className="pulse-dot" style={{ margin: '0 auto 10px' }}></div>
              <p>正在載入最新推播歷史...</p>
            </div>
          ) : filteredArticles.length === 0 ? (
            <div className="empty-box">
              <p>未找到符合條件的推送紀錄</p>
            </div>
          ) : (
            <div className="articles-list">
              {filteredArticles.map((article, idx) => (
                <article key={article.id || idx} className="article-card">
                  <div className="article-top">
                    <span className={`source-badge ${getSourceClass(article.source)}`}>
                      {article.source}
                    </span>
                    <span className="article-time">
                      📅 {formatPushedDate(article.pushedAt)}
                    </span>
                  </div>

                  {article.titleZh && (
                    <h3 className="article-title-zh">{article.titleZh}</h3>
                  )}

                  <p className="article-title-en">{article.title}</p>

                  <div className="article-footer">
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                      狀態: <span style={{ color: 'var(--success)' }}>● 已推播至 Telegram</span>
                    </span>
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="article-link"
                    >
                      閱讀全文 ↗
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: 推播來源管理 (Sources) */}
      {activeTab === 'sources' && (
        <section className="glass-panel">
          <div className="panel-top">
            <div>
              <h2 className="panel-title">
                <span>🌐 全球媒體推播來源</span>
                <span className="subtitle">已訂閱 {subscriptions.size} 個 / 來源總數 {siteDetails.length || 581} 個</span>
              </h2>
            </div>

            <div className="controls-row">
              <button className="btn btn-secondary btn-sm" onClick={subscribeRecommended}>
                ⭐ 一鍵選取頂級主流媒體
              </button>
              <button className="btn btn-secondary btn-sm" onClick={copySubscriptions}>
                📋 複製訂閱列表
              </button>
            </div>
          </div>

          {/* Search & Filter bar */}
          <div className="controls-row" style={{ marginBottom: '16px' }}>
            <div className="search-wrapper">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="search-input"
                placeholder="搜尋媒體名稱或網域（如 economist, ft, nyt, wsj）..."
                value={siteSearch}
                onChange={e => setSiteSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Chips */}
          <div className="chip-group">
            <button
              className={`chip ${siteFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSiteFilter('all')}
            >
              全部 ({siteDetails.length || 581})
            </button>
            <button
              className={`chip ${siteFilter === 'recommended' ? 'active' : ''}`}
              onClick={() => setSiteFilter('recommended')}
            >
              ⭐ 推薦主流
            </button>
            <button
              className={`chip ${siteFilter === 'rss' ? 'active' : ''}`}
              onClick={() => setSiteFilter('rss')}
            >
              ⚡ 官方 RSS 直推
            </button>
            <button
              className={`chip ${siteFilter === 'subscribed' ? 'active' : ''}`}
              onClick={() => setSiteFilter('subscribed')}
            >
              ✅ 已訂閱 ({subscriptions.size})
            </button>
          </div>

          {/* Sources Grid */}
          <div className="site-grid">
            {filteredSites.map(site => {
              const isSub = subscriptions.has(site.name);
              return (
                <div key={site.name} className={`site-card ${isSub ? 'subscribed' : ''}`}>
                  <div className="site-info">
                    <span className="site-name" title={site.name}>{site.name}</span>
                    <div className="site-tags">
                      <span className="tag-domain">{site.domain || 'bypass-source'}</span>
                      {site.hasRss && <span className="tag-rss">即時 RSS</span>}
                      {site.isRecommended && <span className="tag-star">推薦</span>}
                    </div>
                  </div>

                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={isSub}
                      onChange={() => toggleSubscription(site.name)}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* TAB 3: Telegram 設定與手動觸發 (Settings) */}
      {activeTab === 'settings' && (
        <div className="config-grid">
          {/* Telegram Config */}
          <section className="glass-panel">
            <h2 className="panel-title" style={{ marginBottom: '16px' }}>
              <span>🤖 Telegram Bot 連線設定</span>
            </h2>
            <form onSubmit={saveConfig}>
              <div className="form-group">
                <label>Telegram Bot Token</label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                  value={config.telegramToken || ''}
                  onChange={e => setConfig({ ...config, telegramToken: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Chat ID / Channel ID</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="例如: -100123456789 或個人聊天 ID"
                  value={config.chatId || ''}
                  onChange={e => setConfig({ ...config, chatId: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" className="btn" style={{ flex: 1 }} disabled={saving}>
                  {saving ? '儲存中...' : '💾 儲存設定'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving}
                  onClick={testTelegram}
                >
                  🔔 測試發送
                </button>
              </div>
            </form>
          </section>

          {/* Push Actions & GitHub Integration */}
          <section className="glass-panel">
            <h2 className="panel-title" style={{ marginBottom: '16px' }}>
              <span>⚡ 手動觸發與排程資訊</span>
            </h2>

            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '16px' }}>
              新聞推送已由 GitHub Actions 定時執行（每 30 分鐘自動檢查最新 48 小時內新聞並推送）。您也可以點擊下方按鈕隨時立即手動執行。
            </p>

            <button
              className="btn btn-accent"
              style={{ width: '100%', marginBottom: '16px' }}
              onClick={triggerPushJob}
              disabled={triggering}
            >
              {triggering ? '推播啟動中...' : '🚀 立即手動執行推播 (Run Push Job)'}
            </button>

            <div style={{ marginTop: '20px', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>GitHub Actions 排程狀態</span>
                <span style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 700 }}>● 每 30 分鐘自動推播</span>
              </div>
              <a
                href="https://github.com/innnnnnnnnnn/news-pusher/actions"
                target="_blank"
                rel="noopener noreferrer"
                className="article-link"
                style={{ fontSize: '0.85rem' }}
              >
                前往查看 GitHub Actions 執行紀錄 ↗
              </a>
            </div>
          </section>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="toast">
          <span>{toast}</span>
        </div>
      )}
    </main>
  );
}
