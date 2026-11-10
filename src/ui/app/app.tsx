import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Friend, GameSession, Snapshot } from '../../shared';
import { Banner, Empty } from '../components/feedback';
import { Icon } from '../components/icon';
import { api, errorText } from '../lib/api';
import { ActivityPage } from '../pages/activity/activity-page';
import { AddDialog } from '../pages/friends/add-dialog';
import { EditDialog } from '../pages/friends/edit-dialog';
import { FriendsPage } from '../pages/friends/friends-page';
import { OnboardingDialog } from '../pages/onboarding/onboarding-dialog';
import { ReviewPage } from '../pages/review/review-page';
import { Settings } from '../pages/settings/settings-page';
import { FriendTimeline } from '../pages/timeline/friend-timeline';
import { type Tab, Workspace } from './workspace';

type TimelineRoute = { id: string; session?: GameSession };

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>('friends');
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [adding, setAdding] = useState<'manual' | 'discovered' | null>(null);
  const [editing, setEditing] = useState<Friend | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [bannerClosed, setBannerClosed] = useState(false);
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

  const firstRun = snapshot?.firstRun;
  useEffect(() => {
    if (firstRun) setOnboarding(true);
  }, [firstRun]);

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
  function closeOnboarding(finished: boolean) {
    setOnboarding(false);
    // Decide on a fresh snapshot: the roster may have changed a moment ago inside the guide.
    run(api.snapshot().then(async latest => {
      if (latest.firstRun) await api.finishOnboarding();
      // Leaving before any account is recorded returns to the demo; a saved key is kept.
      if (latest.mode === 'live' && !latest.friends.length) await api.setMode('demo');
      else if (finished) {
        navigate('friends');
        setToast({ text: '已连接 Steam 数据，首次采样马上开始', error: false });
      }
    }));
  }
  const savedCsv = () => setToast({ text: 'CSV 已导出', error: false });
  return <>
    <Workspace tab={active === 'inspection' ? 'activity' : tab} snapshot={snapshot} navigate={navigate}
      refresh={() => run(api.refresh())} contentRef={content}
      banner={demo && !bannerClosed && <Banner action="连接 Steam 数据" onAction={() => setOnboarding(true)}
        onClose={() => setBannerClosed(true)}>正在查看示例数据</Banner>}>
        {!snapshot ? <Empty title="正在读取本地数据" detail="SteamMonitor 正在启动。" /> : <>
          <div hidden={active !== 'friends'}><FriendsPage key={snapshot.mode} activePage={active === 'friends'}
            snapshot={snapshot} version={version} onEdit={setEditing} onTimeline={id => navigate('friends', { id })}
            onAdd={() => demo || !snapshot.hasKey ? setOnboarding(true) : setAdding('manual')}
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
    {onboarding && snapshot && <OnboardingDialog snapshot={snapshot} close={closeOnboarding} />}
    {editing && <EditDialog friend={editing} close={() => setEditing(null)} />}
  </>;
}
