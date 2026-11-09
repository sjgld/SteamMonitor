import type { ReactNode, RefObject } from 'react';
import type { Friend, Snapshot } from '../shared';
import { Icon } from './components';
import { clock, dateTime, statusOf } from './model';

export type Tab = 'friends' | 'activity' | 'review' | 'settings';
export type Filter = 'all' | 'playing' | 'online' | 'offline' | 'unknown';
const tabNames = { friends: '好友', activity: '活动', review: '回顾', settings: '设置' };
const stateNames: Record<Snapshot['status'], string> = {
  demo: '演示模式', 'needs-key': '待配置', idle: '待采集', checking: '正在采集',
  ok: '采集正常', partial: '部分可用', error: '采集异常', paused: '已暂停',
};

export function Workspace({ tab, snapshot, navigate, refresh, contentRef, children }: {
  tab: Tab; snapshot: Snapshot | null; navigate: (tab: Tab) => void; refresh: () => void; children: ReactNode;
  contentRef: RefObject<HTMLElement | null>;
}) {
  const demo = snapshot?.mode === 'demo';
  const refreshLabel = demo ? '模拟下一次采样' : '立即刷新';
  return <div className="workspace-shell">
    <aside className="workspace-nav">
      <div className="brand"><span className="brand-mark"><Icon name="activity" size={21} /></span>
        <span className="brand-wordmark">SteamMonitor</span>
      </div>
      <nav aria-label="主导航">
        {(Object.keys(tabNames) as Tab[]).map(name => <button key={name} aria-current={tab === name ? 'page' : undefined}
          aria-label={tabNames[name]} title={tabNames[name]} onClick={() => navigate(name)}>
          <Icon name={name} /><span>{tabNames[name]}</span>
          {name === 'friends' && !demo && Boolean(snapshot?.discovery.pending) &&
            <b className="nav-count">{snapshot!.discovery.pending}</b>}
        </button>)}
      </nav>
      <div className="nav-local"><Icon name="database" size={17} />
        <div><strong>本机存储</strong><span>SteamMonitor {snapshot?.uiVersion}</span></div>
      </div>
    </aside>
    <div className="workspace-content">
      <header className="workspace-bar">
        <span className="breadcrumb"><Icon name={tab} size={16} /><strong>{tabNames[tab]}</strong></span>
        {snapshot && <div className="workspace-actions">
          <span className="source-label">{demo ? '示例数据' : 'Steam 数据'}</span>
          <button type="button" className={`system-state system-${snapshot.status}`} popoverTarget="collection-status"
            aria-label={stateNames[snapshot.status] + '，查看采集详情'}>
            <span className="dot" />{stateNames[snapshot.status]}
          </button>
          <section id="collection-status" popover="auto" className="collection-popover" aria-label="采集详情">
            <div className="collection-heading"><h2>采集详情</h2>
              <button type="button" className="icon-button" aria-label="关闭采集详情" popoverTarget="collection-status" popoverTargetAction="hide"><Icon name="close" size={14} /></button></div>
            <dl>
              <div><dt>当前状态</dt><dd>{stateNames[snapshot.status]}</dd></div>
              <div><dt>最后成功观测</dt><dd>{snapshot.lastSuccessAt ? dateTime(snapshot.lastSuccessAt) : '暂无成功记录'}</dd></div>
              <div><dt>上次检查</dt><dd>{snapshot.lastCheckedAt ? dateTime(snapshot.lastCheckedAt) : '尚未检查'}</dd></div>
              <div><dt>{snapshot.status === 'error' || snapshot.status === 'partial' ? '下次尝试' : '下次采样'}</dt>
                <dd>{snapshot.nextCheckAt ? dateTime(snapshot.nextCheckAt) : snapshot.status === 'checking' ? '正在检查' : '未安排'}</dd></div>
            </dl>
            {snapshot.detail && <p role="status">{snapshot.detail}</p>}
          </section>
          <button aria-label={refreshLabel} title={refreshLabel} className={`icon-button${snapshot.status === 'checking' ? ' is-refreshing' : ''}`}
            disabled={!demo && (snapshot.paused || snapshot.status === 'checking')} onClick={refresh}><Icon name="refresh" size={17} /></button>
        </div>}
      </header>
      <main className="workspace-main" ref={contentRef}>{children}</main>
      <footer className="workspace-footer">
        <span>{demo ? '演示数据 · 无 Steam API 请求' : snapshot?.detail || '公开状态 · 本地采集'}</span>
        <span>{snapshot?.nextCheckAt ? '下次尝试 ' + clock(snapshot.nextCheckAt) :
          snapshot?.lastCheckedAt ? '上次检查 ' + clock(snapshot.lastCheckedAt) : '等待采集'}</span>
      </footer>
    </div>
  </div>;
}

export function matches(friend: Friend, filter: Filter) {
  const status = statusOf(friend);
  return filter === 'all' || (filter === 'online' ? ['online', 'playing', 'busy', 'away'].includes(status) : status === filter);
}
