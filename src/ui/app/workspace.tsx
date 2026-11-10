import type { ReactNode, RefObject } from 'react';
import type { Snapshot } from '../../shared';
import { Icon } from '../components/icon';
import { clock, dateTime } from '../lib/format';

export type Tab = 'friends' | 'activity' | 'review' | 'settings';

const tabNames = { friends: '好友', activity: '活动', review: '回顾', settings: '设置' };

const stateNames: Record<Snapshot['status'], string> = {
  demo: '演示模式', 'needs-key': '待配置', idle: '待采集', checking: '正在采集',
  ok: '采集正常', partial: '部分可用', error: '采集异常', paused: '已暂停',
};

export function Workspace({ tab, snapshot, navigate, refresh, contentRef, banner, children }: {
  tab: Tab; snapshot: Snapshot | null; navigate: (tab: Tab) => void; refresh: () => void; children: ReactNode;
  contentRef: RefObject<HTMLElement | null>; banner?: ReactNode;
}) {
  const demo = snapshot?.mode === 'demo';
  const refreshLabel = demo ? '模拟下一次采样' : '立即刷新';
  return <div className="workspace-shell">
    <aside className="workspace-nav">
      <div className="brand"><span className="brand-mark"><Icon name="activity" size={15} /></span>
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
      {snapshot && <div className="nav-system">
        <div className="nav-system-row">
          <button type="button" className={`system-state system-${snapshot.status}`} popoverTarget="collection-status"
            aria-label={stateNames[snapshot.status] + '，查看采集详情'}>
            <span className="dot" /><span className="system-text">{stateNames[snapshot.status]}</span>
          </button>
          <button aria-label={refreshLabel} title={refreshLabel} className={`icon-button${snapshot.status === 'checking' ? ' is-refreshing' : ''}`}
            disabled={!demo && (snapshot.paused || snapshot.status === 'checking')} onClick={refresh}><Icon name="refresh" size={16} /></button>
        </div>
        <span><span className="source-label">{demo ? '示例数据' : 'Steam 数据'}</span> · {snapshot.nextCheckAt ? '下次 ' + clock(snapshot.nextCheckAt)
          : snapshot.lastCheckedAt ? '上次 ' + clock(snapshot.lastCheckedAt) : '等待采集'}</span>
        <span>本机存储 · {snapshot.uiVersion}</span>
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
          <p role="status">{demo ? '演示数据 · 无 Steam API 请求' : snapshot.detail || '公开状态 · 本地采集'}</p>
        </section>
      </div>}
    </aside>
    <div className={`workspace-content${banner ? ' has-banner' : ''}`}>
      {banner}
      <main className="workspace-main" ref={contentRef}>{children}</main>
    </div>
  </div>;
}
