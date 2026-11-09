import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Friend, GameSession, ReleaseCheck, Snapshot } from '../shared';
import { AddDialog, Avatar, Badge, EditDialog, Empty, FriendDetail, GamePicture, Icon } from './components';
import { ActivityPage } from './activity';
import { DiscoveryInbox, DiscoverySettings } from './discovery';
import { FriendTimeline, ReviewPage } from './history';
import { useGameTitles, useLoadGameTitles } from './game-titles';
import { api, errorText, gameText, rosterGroups } from './model';
import { locateElement } from './motion';
import { PreferencesPanels } from './preferences';
import { matches, Workspace, type Filter, type Tab } from './workspace';
import './style.css';
import './workspace.css';
import './motion.css';

type TimelineRoute = { id: string; session?: GameSession };

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>('friends');
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [adding, setAdding] = useState<'manual' | 'discovered' | null>(null);
  const [editing, setEditing] = useState<Friend | null>(null);
  const [timeline, setTimeline] = useState<TimelineRoute | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set(['friends']));
  const content = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, number>());
  const returnFocus = useRef(new Map<string, Element>());
  const onError = useCallback((text: string) => setToast({ text, error: true }), []);

  useEffect(() => {
    let active = true;
    let request = 0;
    function update() {
      const sequence = ++request;
      void api.snapshot().then(value => {
        if (!active || sequence !== request) return;
        setSnapshot(value);
        setVersion(sequence);
      }).catch(error => { if (active) onError(errorText(error)); });
    }
    const unsubscribe = api.onChange(update);
    update();
    return () => { active = false; unsubscribe(); };
  }, [onError]);

  const loaded = snapshot !== null;
  useEffect(() => {
    if (loaded) void api.uiReady().catch(error => onError(errorText(error)));
  }, [loaded, onError]);

  const updateResult = snapshot?.uiUpdateResult;
  useEffect(() => {
    if (updateResult) setToast(updateResult);
  }, [updateResult?.text, updateResult?.error]);

  useEffect(() => {
    if (!toast || toast.error) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const run = (action: Promise<unknown>) => void action.catch(error => onError(errorText(error)));
  const demo = snapshot?.mode === 'demo';
  const tracked = snapshot?.friends.find(friend => friend.id === timeline?.id);
  const session = tracked ? timeline?.session : undefined;
  const active = tracked ? inspecting && session ? 'inspection' : 'timeline' : tab;
  const viewKey = JSON.stringify([snapshot?.mode, active, tracked?.id, session?.start]);
  useLayoutEffect(() => {
    content.current?.scrollTo({ top: positions.current.get(viewKey) ?? 0, behavior: 'instant' });
    const target = returnFocus.current.get(viewKey);
    if (target instanceof HTMLElement && target.isConnected && !target.closest('[hidden]')) target.focus({ preventScroll: true });
    returnFocus.current.delete(viewKey);
  }, [viewKey]);

  function navigate(next: Tab, target: TimelineRoute | null = null, inspect = false) {
    if (content.current) {
      positions.current.set(viewKey, content.current.scrollTop);
      if (document.activeElement && content.current.contains(document.activeElement)) {
        returnFocus.current.set(viewKey, document.activeElement);
      }
    }
    setVisited(value => value.has(next) ? value : new Set(value).add(next));
    setTab(next);
    setTimeline(target);
    setInspecting(inspect);
  }
  const savedCsv = () => setToast({ text: 'CSV 已导出', error: false });
  return <>
    <Workspace tab={active === 'inspection' ? 'activity' : tab} snapshot={snapshot} navigate={navigate}
      refresh={() => run(api.refresh())} contentRef={content}>
        {!snapshot ? <Empty title="正在读取本地数据" detail="SteamMonitor 正在启动。" /> : <>
          <div hidden={active !== 'friends'}><FriendsPage key={snapshot.mode} activePage={active === 'friends'}
            snapshot={snapshot} version={version} onEdit={setEditing} onTimeline={id => navigate('friends', { id })}
            onAdd={() => demo || !snapshot.hasKey ? navigate('settings') : setAdding('manual')}
            onDiscovery={() => setAdding('discovered')} onError={onError} /></div>
          {visited.has('activity') && <div hidden={active !== 'activity'}><ActivityPage key={snapshot.mode} activePage={active === 'activity'}
            snapshot={snapshot} version={version} onError={onError} onSaved={savedCsv} /></div>}
          {visited.has('review') && <div hidden={active !== 'review'}><ReviewPage key={snapshot.mode} activePage={active === 'review'}
            friends={snapshot.friends} version={version} onError={onError}
            onSession={item => navigate('review', { id: item.playerId, session: item })} /></div>}
          {tracked && <div hidden={active !== 'timeline'}><FriendTimeline key={`${snapshot.mode}:${tracked.id}:${session?.start}`}
            friend={tracked} version={version} activePage={active === 'timeline'} session={session} demo={demo}
            gapMinutes={snapshot.gapThresholdMinutes} preferredGapMinutes={snapshot.preferredGapThresholdMinutes}
            onBack={() => navigate(session ? 'review' : 'friends')} onError={onError}
            onInspect={session ? () => navigate('review', { id: tracked.id, session }, true) : undefined} /></div>}
          {active === 'inspection' && session && <ActivityPage key={viewKey} activePage snapshot={snapshot} version={version}
            inspection={session} onBack={() => navigate('review', { id: session.playerId, session })}
            onError={onError} onSaved={savedCsv} />}
          {tab === 'settings' && <Settings snapshot={snapshot} onError={onError}
            onSaved={text => setToast({ text, error: false })} />}
        </>}
    </Workspace>
    {toast && <div className={`toast${toast.error ? ' error' : ''}`} role={toast.error ? 'alert' : 'status'}>
      <span>{toast.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast(null)}><Icon name="close" size={14} /></button>
    </div>}
    {adding && <AddDialog discovered={adding === 'discovered'} close={() => setAdding(null)} saved={() => {
      setAdding(null);
      setToast({ text: '已加入记录名单', error: false });
    }} />}
    {editing && <EditDialog friend={editing} close={() => setEditing(null)} />}
  </>;
}

function FriendsPage({ snapshot, version, activePage, onAdd, onEdit, onTimeline, onDiscovery, onError }: {
  snapshot: Snapshot; version: number; activePage: boolean; onAdd: () => void; onEdit: (friend: Friend) => void;
  onTimeline: (id: string) => void; onDiscovery: () => void; onError: (text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState('');
  const [grouped, setGrouped] = useState(false);
  const [flashed, setFlashed] = useState<ReadonlySet<string>>(() => new Set());
  const previous = useRef(new Map<string, string>());
  const flashTimer = useRef<number>(undefined);
  const roster = useRef<HTMLElement>(null);
  const anchor = useRef<{ id: string; y: number; filterKey: string } | null>(null);
  const titles = useGameTitles();
  useLoadGameTitles(snapshot.friends.map(friend => friend.gameId));
  useEffect(() => {
    if (!activePage) return;
    function focusSearch(event: KeyboardEvent) {
      if (!event.ctrlKey || event.key.toLowerCase() !== 'k' || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      document.getElementById('friends-search')?.focus();
    }
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [activePage]);
  useEffect(() => {
    const next = new Map(snapshot.friends.map(friend => [friend.id, JSON.stringify([friend.presence, friend.gameId ?? friend.gameName,
      friend.paused, friend.gapSince !== null])]));
    const changed = [...next].filter(([id, state]) => previous.current.has(id) && previous.current.get(id) !== state).map(([id]) => id);
    previous.current = next;
    if (!activePage || !changed.length) return;
    window.clearTimeout(flashTimer.current);
    setFlashed(new Set(changed));
    flashTimer.current = window.setTimeout(() => setFlashed(new Set()), 450);
  }, [activePage, snapshot.friends]);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const filters: [Filter, string][] = [['all', '全部'], ['playing', '游戏中'], ['online', '在线'],
    ['offline', '显示离线'], ['unknown', '未知 / 中断']];
  const byQuery = snapshot.friends.filter(friend =>
    [friend.name, friend.note, friend.id, gameText(friend), gameText(friend, titles)]
      .some(text => text.toLowerCase().includes(query.trim().toLowerCase())));
  const groups = rosterGroups(byQuery.filter(friend => matches(friend, filter)), snapshot.favoriteGames, titles);
  const visible = groups.flatMap(group => group.friends);
  const active = visible.find(friend => friend.id === selected) ?? visible[0];
  const order = visible.map(friend => friend.id).join(',');
  const filterKey = JSON.stringify([query, filter, grouped]);
  useLayoutEffect(() => {
    const list = roster.current;
    const scroller = list?.closest('.workspace-main');
    if (!activePage || !list || !scroller) {
      anchor.current = null;
      return;
    }
    const prior = anchor.current;
    const top = () => scroller.getBoundingClientRect().top;
    const items = () => list.querySelectorAll<HTMLElement>('[data-roster-id]');
    if (prior?.filterKey === filterKey && scroller.scrollTop > 0) {
      const row = [...items()].find(element => element.dataset.rosterId === prior.id);
      if (row) scroller.scrollTop += row.getBoundingClientRect().top - top() - prior.y;
    }
    function capture() {
      const bounds = scroller!.getBoundingClientRect();
      const row = [...items()].find(element => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      anchor.current = row?.dataset.rosterId ? { id: row.dataset.rosterId, y: row.getBoundingClientRect().top - bounds.top, filterKey } : null;
    }
    capture();
    scroller.addEventListener('scroll', capture, { passive: true });
    return () => scroller.removeEventListener('scroll', capture);
  }, [activePage, order, filterKey]);

  function row(friend: Friend) {
    return <button key={friend.id} className={`friend-row${flashed.has(friend.id) ? ' friend-row-changed' : ''}`}
      data-roster-id={friend.id} aria-pressed={active?.id === friend.id}
      onClick={() => {
        setSelected(friend.id);
        if (window.matchMedia('(max-width: 760px)').matches) {
          window.requestAnimationFrame(() => {
            const detail = document.querySelector('.friends-page .detail');
            if (detail) locateElement(detail);
          });
        }
      }}>
      <Avatar person={friend} />
      <span className="identity"><strong>{friend.name}{friend.pinned && <Icon name="star" size={13} />}</strong>
        <span>{friend.note || (snapshot.mode === 'demo' ? '演示好友' : friend.id)}</span>
      </span>
      <span className="row-state"><Badge friend={friend} />
        {gameText(friend) && <span className="row-game"><GamePicture id={friend.gameId} />
          <span>{friend.gapSince !== null ? '上次 · ' : ''}{gameText(friend, titles)}</span></span>}
      </span>
      <Icon name="arrow" size={15} />
    </button>;
  }

  return <section className="page friends-page">
    <div className="page-heading">
      <h1>好友</h1>
      <button className="primary" onClick={onAdd}><Icon name={snapshot.mode === 'demo' ? 'settings' : 'plus'} />
        {snapshot.mode === 'demo' ? '连接 Steam 数据' : '添加好友'}</button>
    </div>
    {snapshot.mode === 'live' && <DiscoveryInbox discovery={snapshot.discovery} review={onDiscovery} onError={onError} />}
    <div className="workspace">
      <section className="panel roster" aria-label="好友列表" ref={roster}>
        <div className="section-bar"><h2>记录名单</h2><div className="roster-heading-actions">
          <span className="list-counter">{visible.length} 人</span>
          {active && <button type="button" className="roster-timeline" onClick={() => onTimeline(active.id)}
            aria-label={active.name + '的横向时间轴'}>时间轴</button>}
        </div></div>
        <div className="list-toolbar">
          <label className="search"><Icon name="search" size={17} /><input id="friends-search" aria-label="搜索好友、备注或游戏"
            placeholder="搜索好友、备注或游戏" value={query} onChange={event => setQuery(event.target.value)} /><kbd>Ctrl K</kbd></label>
          <button className="roster-group-toggle" aria-pressed={grouped} aria-label="按游戏分组"
            onClick={() => setGrouped(!grouped)}><Icon name="game" size={15} />按游戏分组</button>
        </div>
        <div className="filters">{filters.map(([key, label]) =>
          <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label}<span>{byQuery.filter(friend => matches(friend, key)).length}</span>
          </button>)}</div>
        {visible.length === 0 ? <Empty title={snapshot.friends.length ? '没有匹配的好友' : '还没有添加好友'}
          detail={snapshot.friends.length ? '换个搜索词或筛选条件试试。' : '添加自己的 Steam 账号或已授权的好友。'} /> :
          <div className="friend-list">{grouped
            ? groups.map(({ key, name, status, friends }) => <section className="game-group" key={key}>
                <h3>{status === 'playing' && <GamePicture id={friends[0].gameId} />}{name}<span>{friends.length}</span>
                  {status === 'playing' && <button className="icon-button" aria-label={'置顶 ' + name}
                    aria-pressed={snapshot.favoriteGames.includes(key)}
                    onClick={() => void api.favoriteGame(key, !snapshot.favoriteGames.includes(key))
                      .catch(error => onError(errorText(error)))}><Icon name="star" size={13} /></button>}
                </h3>{friends.map(row)}
              </section>)
            : visible.map(row)}</div>}
      </section>
      <aside className="panel detail" aria-label="好友详情">
        <div className="section-bar detail-section"><h2>好友详情</h2>
          {active && <button type="button" className="detail-timeline" onClick={() => onTimeline(active.id)}>
            <Icon name="activity" size={15} />横向时间轴
          </button>}</div>
        {active ? <FriendDetail key={active.id} friend={active} version={version} activePage={activePage} real={snapshot.mode === 'live'}
          editable={() => onEdit(active)} onError={onError} /> :
          <Empty title="好友详情" detail="选择一位好友查看最近活动。" />}
      </aside>
    </div>
  </section>;
}

function SoftwareUpdate({ snapshot }: { snapshot: Snapshot }) {
  const [result, setResult] = useState<ReleaseCheck | null>(null);
  const [busy, setBusy] = useState<'check' | 'apply' | 'open' | 'local' | null>(null);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>, task: NonNullable<typeof busy>) {
    setBusy(task);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  return <section id="settings-update" tabIndex={-1} className="panel setting">
    <h2>软件更新</h2>
    <p>界面 {snapshot.uiVersion} · 采集程序 {snapshot.collectorVersion}</p>
    <div className="input-action">
      <button className="primary" disabled={busy !== null} onClick={() => void run(async () => {
        setResult(null);
        setResult(await api.checkRelease());
      }, 'check')}>{busy === 'check' ? '正在检查…' : '检查更新'}</button>
      <button disabled={busy !== null} onClick={() => void run(api.installUiUpdate, 'local')}>加载本地界面…</button>
    </div>
    {error && <p className="setting-feedback error" role="alert">{error}</p>}
    {result?.kind === 'unpublished' && <p className="setting-feedback" role="status">GitHub 暂无正式发布。</p>}
    {result?.kind === 'current' && <p className="setting-feedback" role="status">已是最新版本 {result.version}。</p>}
    {result?.kind === 'interface' && <div className="setting-field">
      <p className="setting-feedback" role="status">界面 {result.version} 可直接更新，后台采集继续运行。</p>
      <button disabled={busy !== null} onClick={() => void run(api.applyReleaseUi, 'apply')}>立即更新界面</button>
    </div>}
    {result?.kind === 'full' && <div className="setting-field">
      <p className="setting-feedback" role="status">完整版本 {result.version} 已发布。下载后退出旧版，再打开新版。</p>
      <button disabled={busy !== null} onClick={() => void run(api.openRelease, 'open')}>打开下载页</button>
    </div>}
  </section>;
}

function Settings({ snapshot, onError, onSaved }: { snapshot: Snapshot; onError: (text: string) => void; onSaved: (text: string) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  type Section = 'source' | 'collection';
  const [feedback, setFeedback] = useState<{ section: Section; text: string; error: boolean } | null>(null);
  const groups = [['source', '数据源'], ['collection', '后台采集'], ['update', '软件更新'], ['notice', '通知'], ['data', '数据管理']] as const;
  async function run(action: () => Promise<unknown>, section: Section, message?: string) {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      if (message) setFeedback({ section, text: message, error: false });
    } catch (error) {
      setFeedback({ section, text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => { await api.setKey(key); setKey(''); }, 'source', 'API Key 已保存');
  }
  const status = (section: Section) => feedback?.section === section &&
    <p className={`setting-feedback${feedback.error ? ' error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>;
  return <section className="page">
    <div className="page-heading"><h1>设置</h1></div>
    <nav className="settings-jump" aria-label="设置分组">{groups.map(([id, label]) =>
      <button key={id} onClick={() => {
        const target = document.getElementById('settings-' + id);
        if (target) locateElement(target);
      }}>{label}</button>)}</nav>
    <div className="settings">
      <section id="settings-source" tabIndex={-1} className="panel setting"><h2>数据源</h2>
        <p>切到演示模式会暂停 Steam 采集。</p>
        <div className="segmented">
          <button aria-pressed={snapshot.mode === 'demo'} disabled={busy} onClick={() => void run(() => api.setMode('demo'), 'source')}>演示数据</button>
          <button aria-pressed={snapshot.mode === 'live'} disabled={busy} onClick={() => void run(() => api.setMode('live'), 'source')}>Steam 数据</button>
        </div>
        <div className="setting-field"><h3>Steam Web API Key</h3>
        <p>{snapshot.hasKey ? '已保存。填写新的 Key 可以替换现有凭据。' : '填写你自己的 Steam Web API Key，程序即可查询公开状态。'}</p>
        <form onSubmit={save}>
          <label htmlFor="steam-key">API Key</label><div className="input-action">
            <input id="steam-key" type="password" autoComplete="off" spellCheck={false} value={key} maxLength={64}
              placeholder={snapshot.hasKey ? '已加密保存' : '32 位十六进制 Key'} onChange={event => setKey(event.target.value)} />
            <button className="primary" disabled={busy || !key.trim()}>保存</button>
            {snapshot.hasKey && <button type="button" disabled={busy} onClick={() =>
              void run(async () => { await api.setKey(''); setKey(''); }, 'source', 'API Key 已清除')}>清除</button>}
          </div>
        </form>
        <p>Key 存在本机，可在 Steam 社区的开发者页面申请。</p>
        {status('source')}
        </div>
      </section>
      <section id="settings-collection" tabIndex={-1} className="panel setting"><h2>后台采集</h2>
        <p>Steam 数据默认每 60 秒采样。关闭窗口后可从系统托盘重新打开或退出。</p>
        <button disabled={busy || snapshot.mode === 'demo'} onClick={() =>
          void run(() => api.setPaused(!snapshot.paused), 'collection', snapshot.paused ? '已恢复采集' : '已暂停采集')}>
          {snapshot.paused ? '恢复采集' : '暂停采集'}
        </button>
        {status('collection')}
      </section>
      <SoftwareUpdate snapshot={snapshot} />
      <DiscoverySettings key={snapshot.discovery.owner} snapshot={snapshot} onError={onError} onSaved={onSaved} />
      <PreferencesPanels friends={snapshot.mode === 'live' ? snapshot.friends : []} onError={onError} onSaved={onSaved} />
    </div>
  </section>;
}

createRoot(document.getElementById('root')!).render(<App />);
