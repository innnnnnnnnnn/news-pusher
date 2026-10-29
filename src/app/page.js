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
  const [ghToken, setGhToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncingGh, setSyncingGh] = useState(false);
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

      const cachedGhToken = localStorage.getItem('np_gh_token');
      if (cachedGhToken) setGhToken(cachedGhToken);
    } catch {}

    // Load Sites
    fetch('/api/sites')
      .then(r => r.json())
      .then(data => {
        if (data.sites) setSites(data.sites);
        if (data.siteDetails) setSiteDetails(data.siteDetails);
      })
      .catch(err => console.warn('Failed to load sites:', err));

    // Load canonical subscriptions: ONLY if user has no local subscriptions yet
    try {
      const hasLocalSubs = localStorage.getItem('np_subscriptions');
      if (!hasLocalSubs) {
        fetch('/api/subscriptions', { cache: 'no-store' })
          .then(r => r.json())
          .then(data => {
            if (data.subscriptions && data.subscriptions.length > 0) {
              const subsSet = new Set(data.subscriptions);
              setSubscriptions(subsSet);
              localStorage.setItem('np_subscriptions', JSON.stringify(Array.from(subsSet)));
            }
          })
          .catch(err => console.warn('Failed to load subscriptions:', err));
      }
    } catch {}

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

  // Sync subscriptions list to GitHub repository
  const syncSubscriptionsToGitHub = async (subsArray, explicitToken) => {
    const token = explicitToken || ghToken || (typeof window !== 'undefined' ? localStorage.getItem('np_gh_token') : '');
    setSyncingGh(true);

    try {
      // 1. Call internal API first (which will update local/GitHub if it has backend token)
      const apiRes = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptions: subsArray, token: token || undefined })
      });
      const apiData = await apiRes.json().catch(() => ({}));

      // 2. Direct client-side GitHub REST API sync if token is present in browser
      if (token) {
        const REPO_OWNER = 'innnnnnnnnnn';
        const REPO_NAME = 'news-pusher';
        const FILE_PATH = 'subscriptions.json';
        const getUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;

        const getRes = await fetch(getUrl, {
          headers: {
            'Authorization': `Bearer ${token.trim()}`,
            'Accept': 'application/vnd.github+json'
          }
        });

        let sha = null;
        if (getRes.ok) {
          const fileData = await getRes.json();
          sha = fileData.sha;
        }

        const jsonString = JSON.stringify({
          updatedAt: new Date().toISOString(),
          subscriptions: subsArray
        }, null, 2);

        const base64Content = btoa(unescape(encodeURIComponent(jsonString)));

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
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(putBody)
        });

        if (putRes.ok) {
          showToast('🎉 已成功同步至 GitHub subscriptions.json！推播引擎 20 秒內生效');
          return;
        } else {
          const err = await putRes.json().catch(() => ({}));
          showToast(`⚠️ GitHub 同步失敗: ${err.message || putRes.statusText}`);
          return;
        }
      }

      if (apiData.syncedToGitHub) {
        showToast('🎉 已成功同步至 GitHub 儲存庫！推播引擎 20 秒內生效');
      } else {
        showToast('💾 已更新本地快取。若需即時同步至 GitHub，請在上方設定 GitHub Token');
      }
    } catch (e) {
      console.warn('Sync failed:', e);
      showToast(`⚠️ 同步連線發生問題: ${e.message}`);
    } finally {
      setSyncingGh(false);
    }
  };

  // Toggle single site subscription
  const toggleSubscription = async (siteName) => {
    const isSubscribed = subscriptions.has(siteName);
    const newStatus = !isSubscribed;
    const newSubs = new Set(subscriptions);

    if (newStatus) newSubs.add(siteName);
    else newSubs.delete(siteName);

    setSubscriptions(newSubs);
    const subsArray = Array.from(newSubs);
    try {
      localStorage.setItem('np_subscriptions', JSON.stringify(subsArray));
    } catch {}

    showToast(newStatus ? `✅ 已選取 ${siteName}` : `⚪ 已取消選取 ${siteName}`);
    syncSubscriptionsToGitHub(subsArray);
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
      'BBC USA',
      'CNBC (news only)'
    ];
    const newSubs = new Set(subscriptions);
    topMedia.forEach(m => newSubs.add(m));
    setSubscriptions(newSubs);
    const subsArray = Array.from(newSubs);
    try {
      localStorage.setItem('np_subscriptions', JSON.stringify(subsArray));
    } catch {}

    showToast(`🎉 已一鍵選取 ${topMedia.length} 個頂級主流媒體`);
    syncSubscriptionsToGitHub(subsArray);
  };

  const handleSaveGhToken = (token) => {
    setGhToken(token);
    try {
      localStorage.setItem('np_gh_token', token.trim());
    } catch {}
  };

  const refreshSubscriptionsFromRemote = async () => {
    showToast('🔄 正在從 GitHub 載入最新訂閱設定...');
    try {
      const res = await fetch('/api/subscriptions', { cache: 'no-store' });
      const data = await res.json();
      if (data.subscriptions && data.subscriptions.length > 0) {
        const subsSet = new Set(data.subscriptions);
        setSubscriptions(subsSet);
        try {
          localStorage.setItem('np_subscriptions', JSON.stringify(Array.from(subsSet)));
        } catch {}
        showToast(`✅ 已從 GitHub 載入最新 ${data.subscriptions.length} 個訂閱來源！`);
      }
    } catch (e) {
      showToast(`❌ 載入失敗: ${e.message}`);
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
              <button
                className="btn btn-primary btn-sm"
                onClick={() => syncSubscriptionsToGitHub(Array.from(subscriptions))}
                disabled={syncingGh}
              >
                {syncingGh ? '⏳ 同步中...' : '💾 儲存並同步至 GitHub'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={refreshSubscriptionsFromRemote}
              >
                🔄 從 GitHub 重載
              </button>
              <button className="btn btn-secondary btn-sm" onClick={subscribeRecommended}>
                ⭐ 一鍵選取頂級主流媒體
              </button>
              <button className="btn btn-secondary btn-sm" onClick={copySubscriptions}>
                📋 複製列表
              </button>
            </div>
          </div>

          {/* GitHub Sync Bar */}
          <div style={{
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: '12px',
            padding: '12px 16px',
            marginBottom: '20px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 320px' }}>
              <span style={{ fontSize: '1.1rem' }}>🔑</span>
              <input
                type="password"
                placeholder="貼入 GitHub PAT (以 gho_ 或 ghp_ 開頭，需 repo 權限)"
                value={ghToken}
                onChange={e => handleSaveGhToken(e.target.value)}
                style={{
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '8px',
                  padding: '7px 12px',
                  color: '#fff',
                  fontSize: '0.85rem',
                  flex: 1,
                  outline: 'none'
                }}
              />
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', flex: '1 1 280px' }}>
              {ghToken ? (
                <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  ● 已綁定 Token：點擊開關將<strong>即時同步寫入 GitHub</strong>，下個循環（20 秒內）生效！
                </span>
              ) : (
                <span>
                  💡 填入 Token 可直連寫入 <code>subscriptions.json</code>。若無填寫，將嘗試透過後端同步或保存於本地快取。
                </span>
              )}
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
