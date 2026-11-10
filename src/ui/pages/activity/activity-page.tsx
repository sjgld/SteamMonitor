import { useEffect, useMemo, useRef, useState } from 'react';
import { type Activity, type ActivityBoard, type ActivityWindow, type DisplayBand, displayBands, type Friend, type GameSession, type GapRecord, hideGapEvent, shortGap, type Snapshot } from '../../../shared';
import { Empty } from '../../components/feedback';
import { GapThreshold, RemoveGapButton } from '../../components/gap-controls';
import { Icon } from '../../components/icon';
import { Avatar, GamePicture } from '../../components/media';
import { spanLabel } from '../../components/timeline-band';
import { api, errorText } from '../../lib/api';
import { clock, dateTime, day, localDateInput, segmentDuration } from '../../lib/format';
import { useGameTitles, useLoadGameTitles } from '../../lib/game-titles';
import { describeActivity, gameText, makeFilter } from '../../lib/model';
import { locateElement } from '../../lib/motion';
import { minTimelineWindow, placeWindow, timeInView, zoomWindow } from '../../lib/timeline-navigation';
import { activityKey, type BoardSpan, type Focus, type Growth, growthKey, Lanes, Overview } from './activity-chart';
import './activity.css';

const hour = 3_600_000;

const presets = { '6h': '近 6 小时', '24h': '近 24 小时', today: '今天', '7d': '近 7 天', custom: '自定义' } as const;

type Preset = keyof typeof presets;

type EventType = 'all' | 'status' | 'gap' | 'playtime';

type Entry = { key: string; playerId: string; at: number } & ({ activity: Activity } | { growth: Growth });

const pageSize = 80;

function baseWindow(preset: Preset, from: string, until: string): ActivityWindow {
  const now = Date.now() + 1;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  if (preset === 'today') return { from: midnight.getTime(), until: now };
  if (preset === 'custom') {
    const date = makeFilter('', '', from, until);
    return { from: date.from ?? NaN, until: Math.min(date.until ?? NaN, now) };
  }
  const hours = preset === '6h' ? 6 : preset === '7d' ? 168 : 24;
  return { from: now - hours * hour, until: now };
}

function entryMatches(entry: Entry, window: ActivityWindow, type: EventType) {
  if (entry.at >= window.until) return false;
  if ('growth' in entry) return entry.at >= window.from && (type === 'all' || type === 'playtime');
  if (entry.activity.kind === 'gap') {
    return (entry.activity.endedAt ?? Infinity) > window.from && (type === 'all' || type === 'gap');
  }
  return entry.at >= window.from && (type === 'all' || type === 'status');
}

function EventIcon({ entry }: { entry: Entry }) {
  if ('growth' in entry) return <GamePicture id={entry.growth.appId} />;
  const row = entry.activity;
  const current = gameText(row);
  const previous = gameText({ gameId: row.previousGameId, gameName: row.previousGameName });
  if (!current && !previous) return <span className="board-event-symbol"><Icon name={row.kind === 'gap' ? 'layers' : 'activity'} size={15} /></span>;
  return <span className="event-games">
    {current && previous && (row.gameId ?? current) !== (row.previousGameId ?? previous) &&
      <><span title={previous}><GamePicture id={row.previousGameId} /></span><Icon name="arrow" size={12} /></>}
    <span title={current || previous}><GamePicture id={current ? row.gameId : row.previousGameId} /></span>
  </span>;
}

function FocusDetail({ focus, band, friend, entry, onEvent, canLocate, onLocate, id }: {
  focus: Focus | null; friend?: Friend; entry?: Entry; onEvent: (key: string) => void;
  band?: DisplayBand<BoardSpan>;
  canLocate: boolean; onLocate: () => void; id: string;
}) {
  const titles = useGameTitles();
  const span = band ?? focus?.span;
  const growth = focus?.growth;
  return <aside className="board-detail" id={id} tabIndex={-1}>
    <div className="board-detail-heading"><Icon name="layers" size={16} /><h3>所选活动</h3>
      {canLocate && <button className="link board-back-to-lane" onClick={onLocate}>返回泳道</button>}
    </div>
    {!focus ? <p className="muted">点选色带、菱形或下方事件查看详情。</p> :
      <>
        {friend && <div className="board-detail-person"><Avatar person={friend} /><strong>{friend.name}</strong></div>}
        {span && <div className="board-detail-segment">
          {gameText(span) && <GamePicture id={span.gameId} large />}
          <div><strong>{spanLabel(span, titles)}</strong><p>{dateTime(span.start)} – {dateTime(span.end)}</p>
            <p>{span.state === 'gap' ? '窗口内缺口' : '观测时长'} · {segmentDuration(band?.elapsed ?? span.end - span.start)}
              {band && band.hidden > 0 && ` · 已扣除 ${segmentDuration(band.hidden)} 采集缺口`}</p></div>
        </div>}
        {entry && 'activity' in entry && <p>{describeActivity(entry.activity, titles)}<br />
          <span className="muted">{dateTime(entry.at)}{entry.activity.kind === 'gap' &&
            (entry.activity.endedAt === null ? ' · 恢复采集前' : ' – ' + dateTime(entry.activity.endedAt))}</span></p>}
        {growth?.map(item => <div className="board-growth-detail" key={item.rowId}>
          <GamePicture id={item.appId} />
          <div><strong>{gameText({ gameId: item.appId, gameName: item.name }, titles)} · +{item.minutes} 分钟</strong>
            <p>{dateTime(item.at)} 发现增长</p>
            <p>对比自 {dateTime(item.from)}{item.gap ? ' · 期间有采集缺口' : ''}</p>
            <p>{{ observed: '对比窗口内看到过该游戏', recent: '对比窗口前看到过该游戏', unmatched: '未匹配到游戏观测' }[item.match]}</p>
            {growth.length > 1 && <button className="link" onClick={() => onEvent(growthKey(item))}>定位事件</button>}
          </div>
        </div>)}
        {growth && <p className="board-detail-note">标记对应时长发现时间。增长无法确定实际开玩时间或在线状态。</p>}
        {focus.key && !(growth && growth.length > 1) && <button className="link" onClick={() => onEvent(focus.key!)}>定位到事件列表</button>}
      </>}
  </aside>;
}

export function ActivityPage({ snapshot, version, activePage, inspection, onBack, onError, onSaved }: {
  snapshot: Snapshot; version: number; activePage: boolean; inspection?: GameSession; onBack?: () => void;
  onError: (text: string) => void; onSaved: () => void;
}) {
  const [preset, setPreset] = useState<Preset>(inspection ? 'custom' : '24h');
  const [from, setFrom] = useState(() => localDateInput(new Date(inspection?.start ?? Date.now())));
  const [until, setUntil] = useState(() => inspection ? localDateInput(new Date(inspection.end - 1)) : from);
  const [player, setPlayer] = useState(inspection?.playerId ?? '');
  const [gameInput, setGameInput] = useState('');
  const [type, setType] = useState<EventType>('all');
  const [anchor, setAnchor] = useState<ActivityWindow | null>(null);
  const [visible, setVisible] = useState<ActivityWindow | null>(() => inspection ? placeWindow(baseWindow('custom', from, until),
    inspection.start - 10 * 60_000, inspection.end - inspection.start + 20 * 60_000) : null);
  const [selection, setFocus] = useState<Focus | null>(null);
  const openedInspection = useRef(false);
  const [returnEvent, setReturnEvent] = useState('');
  const [removedCount, setRemovedCount] = useState(0);
  const [count, setCount] = useState(pageSize);
  const [jump, setJump] = useState<{ id: string; eventKey?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; base: ActivityWindow; data: ActivityBoard } | null>(null);
  const [failed, setFailed] = useState('');
  const [retry, setRetry] = useState(0);
  const [axisVersion, setAxisVersion] = useState(0);
  const idPrefix = inspection ? 'inspection-' : '';
  const titles = useGameTitles();
  const people = useMemo(() => new Map(snapshot.friends.map(friend => [friend.id, friend])), [snapshot.friends]);
  const playerId = people.has(player) ? player : '';
  const game = gameInput.trim();
  const localizedMatches = game ? [...titles].filter(([, name]) => name.toLowerCase().includes(game.toLowerCase())).map(([id]) => id).join(',') : '';
  const queryKey = JSON.stringify([preset, preset === 'custom' ? from : '', preset === 'custom' ? until : '', playerId, game]);
  const today = localDateInput(new Date());
  const customDays = (Date.parse(until) - Date.parse(from)) / (24 * hour) + 1;
  const invalid = preset === 'custom' && (!from || !until || until > today || from > until || customDays > 31);

  useEffect(() => {
    if (invalid || !activePage) return;
    let active = true;
    const base = anchor ?? baseWindow(preset, from, until);
    void api.activityBoard({ ...base, playerId: playerId || undefined, game: game || undefined })
      .then(data => {
        if (!active) return;
        setLoaded({ key: queryKey, base, data });
        setFailed('');
      }).catch(error => {
        if (!active) return;
        setFailed(queryKey);
        onError(errorText(error));
      });
    return () => { active = false; };
  }, [activePage, anchor, from, game, invalid, localizedMatches, onError, playerId, preset, queryKey, retry, until, version]);

  const result = loaded?.key === queryKey ? loaded : null;
  const data = result?.data;
  const gameIds = useMemo(() => data ? [
    ...data.tracks.flatMap(track => track.spans.map(span => span.gameId)),
    ...data.events.flatMap(event => [event.gameId, event.previousGameId]),
    ...data.playtime.map(event => event.appId),
  ] : [], [data]);
  useLoadGameTitles(gameIds);
  const base = result?.base;
  const view = visible ?? base;
  const gapMinutes = snapshot.gapThresholdMinutes;
  const bands = useMemo(() => new Map(data?.tracks.map(track =>
    [track.playerId, displayBands(track.spans, gapMinutes)])), [data?.tracks, gapMinutes]);
  const entries = useMemo<Entry[]>(() => {
    if (!data) return [];
    const combined: Entry[] = [
      ...data.events.map(activity => ({ key: activityKey(activity.rowId), playerId: activity.playerId, at: activity.at, activity })),
      ...data.playtime.map(growth => ({ key: growthKey(growth), playerId: growth.playerId, at: growth.at, growth })),
    ];
    return combined.sort((a, b) => b.at - a.at);
  }, [data]);
  const visibleEntries = useMemo(() => !data ? entries : entries.filter(entry =>
    !('activity' in entry) || !hideGapEvent(entry.activity, data.unchangedRecoveries, gapMinutes)), [data, entries, gapMinutes]);
  const matching = useMemo(() => view ? visibleEntries.filter(entry => entryMatches(entry, view, type)) : [], [visibleEntries, view, type]);
  const rawEntry = selection?.key ? entries.find(entry => entry.key === selection.key) : undefined;
  const hiddenEntry = rawEntry && 'activity' in rawEntry && data && hideGapEvent(rawEntry.activity, data.unchangedRecoveries, gapMinutes);
  const focus = selection?.span?.gapRecord?.removed || shortGap(selection?.span?.gapDuration, gapMinutes) ||
    (hiddenEntry && rawEntry && 'activity' in rawEntry && rawEntry.activity.kind === 'gap') ? null : selection;
  const focusBand = focus?.span && bands.get(focus.playerId)?.find(band => band.parts.some(part =>
    part.start === focus.span?.start || (part.sourceId !== undefined && activityKey(part.sourceId) === focus.key)));
  const selectedEntry = hiddenEntry ? visibleEntries.find(entry => entry.playerId === focus?.playerId && view &&
    entryMatches(entry, view, 'all') && focusBand?.parts.some(part => part.sourceId !== undefined && activityKey(part.sourceId) === entry.key)) : rawEntry;

  useEffect(() => {
    if (!inspection || openedInspection.current || !data) return;
    openedInspection.current = true;
    const span = data.tracks.find(track => track.playerId === inspection.playerId)?.spans.find(item =>
      item.start <= inspection.start && item.end > inspection.start &&
      (item.gameId ?? item.gameName) === (inspection.gameId ?? inspection.gameName));
    if (span) setFocus({ playerId: inspection.playerId, at: inspection.start, span,
      key: span.sourceId === undefined ? undefined : activityKey(span.sourceId) });
  }, [data, inspection]);

  useEffect(() => {
    if (!jump || !activePage) return;
    const row = document.getElementById(idPrefix + jump.id);
    const element = jump.eventKey ? row?.querySelector(`[data-timeline-event~="${jump.eventKey}"]`) ?? row : row;
    if (element) locateElement(element);
    setJump(null);
  }, [activePage, count, idPrefix, jump, type]);

  function reset() {
    setAnchor(null);
    setVisible(null);
    setFocus(null);
    setCount(pageSize);
  }

  function chooseWindow(next: ActivityWindow) {
    if (!base || !view || (next.from === view.from && next.until === view.until)) return;
    setAnchor(value => value ?? base);
    setVisible(next);
  }

  function zoom(factor: number) {
    if (!base || !view) return;
    const position = focus && timeInView(view, focus.at) ? (focus.at - view.from) / (view.until - view.from) : 0.5;
    chooseWindow(zoomWindow(base, view, factor, position));
  }

  function pan(direction: number) {
    if (!base || !view) return;
    const size = view.until - view.from;
    chooseWindow(placeWindow(base, view.from + size * direction * 0.25, size));
  }

  function locateFocus() {
    if (!focus || !base || !view) return;
    if (!timeInView(view, focus.at)) {
      const size = view.until - view.from;
      chooseWindow(placeWindow(base, focus.at - size / 2, size));
    }
    setJump({ id: 'board-player-' + focus.playerId, eventKey: focus.key });
  }

  function selectEntry(entry: Entry) {
    if (!view) return;
    const span = 'activity' in entry ? data?.tracks.find(track => track.playerId === entry.playerId)
      ?.spans.find(item => item.sourceId === entry.activity.rowId && item.start < view.until && item.end > view.from) : undefined;
    setFocus({ playerId: entry.playerId, at: Math.max(view.from, entry.at), key: entry.key,
      span, growth: 'growth' in entry ? [entry.growth] : undefined });
    setReturnEvent(entry.key);
    setJump({ id: 'board-player-' + entry.playerId, eventKey: entry.key });
  }

  function goToEvent(key: string, updateSelection = true) {
    if (!view) return;
    const all = visibleEntries.filter(entry => entryMatches(entry, view, 'all'));
    const index = all.findIndex(entry => entry.key === key);
    if (index < 0) return;
    const currentIndex = matching.findIndex(entry => entry.key === key);
    if (currentIndex < 0) setType('all');
    setCount(value => Math.max(value, (currentIndex < 0 ? index : currentIndex) + 1));
    if (updateSelection) setFocus(value => value ? { ...value, key, at: Math.max(view.from, all[index].at) } : value);
    setJump({ id: 'board-event-' + key });
  }

  async function exportCsv() {
    if (!view) return;
    setExporting(true);
    try {
      if (await api.exportActivity({ ...view, playerId: playerId || undefined, game: game || undefined })) onSaved();
    } catch (error) {
      onError(errorText(error));
    } finally {
      setExporting(false);
    }
  }

  const focusInList = focus && view && (focus.growth?.some(item => item.at >= view.from && item.at < view.until) ||
    (selectedEntry && entryMatches(selectedEntry, view, 'all')));
  const focusTitle = focus?.span ? spanLabel(focus.span, titles) + ' · ' + segmentDuration(focusBand?.elapsed ?? focus.span.end - focus.span.start) : focus?.growth
    ? focus.growth.length > 1 ? `${focus.growth.length} 条时长增长`
      : gameText({ gameId: focus.growth[0].appId, gameName: focus.growth[0].name }, titles) + ' · 时长增长'
    : selectedEntry && 'activity' in selectedEntry ? describeActivity(selectedEntry.activity, titles) : '';
  const gapEvent = selectedEntry && 'activity' in selectedEntry && selectedEntry.activity.kind === 'gap' ? selectedEntry.activity : undefined;
  const focusGap: GapRecord | undefined = focus?.span?.gapRecord ?? (gapEvent
    ? { rowId: gapEvent.rowId, at: gapEvent.at, endedAt: gapEvent.endedAt } : undefined);
  return <section className="page activity-page">
    {onBack && <button className="link" onClick={onBack}>‹ 返回好友时间轴</button>}
    <div className="page-heading">
      <h1>活动</h1>
      <div className="page-actions">
        <button disabled={invalid || !data?.tracks.length} onClick={() => setJump({ id: 'board-event-list' })}>事件列表</button>
        <button disabled={invalid || exporting || !view || !entries.some(entry => 'activity' in entry && entryMatches(entry, view, 'all'))}
          title="导出当前时间范围的活动记录" onClick={() => void exportCsv()}><Icon name="download" />导出 CSV</button>
      </div>
    </div>
    <section className="panel board-panel">
      <div className="board-toolbar">
        <div className="board-toolbar-line">
          <div className="board-presets" aria-label="时间范围">
            {(Object.keys(presets) as Preset[]).map(value => <button key={value} aria-pressed={preset === value}
              onClick={() => { if (value !== preset) setAxisVersion(current => current + 1); setPreset(value); reset(); }}>{presets[value]}</button>)}
          </div>
          <GapThreshold minutes={gapMinutes} preferred={snapshot.preferredGapThresholdMinutes} onError={onError} />
        </div>
        <div className="board-filters">
          <label>好友<select value={playerId} onChange={event => { setPlayer(event.target.value); setFocus(null); setCount(pageSize); }}>
            <option value="">全部好友</option>{snapshot.friends.map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}
          </select></label>
          <label>游戏<input placeholder="游戏名或 ID" maxLength={160} value={gameInput}
            onChange={event => { setGameInput(event.target.value); setFocus(null); setCount(pageSize); }} /></label>
          {preset === 'custom' && <>
            <label>从<input type="date" max={today} value={from} onChange={event => { setFrom(event.target.value); reset(); }} /></label>
            <label>至<input type="date" max={today} value={until} onChange={event => { setUntil(event.target.value); reset(); }} /></label>
          </>}
        </div>
      </div>
      {invalid ? <p className="message error board-message" role="alert">请选择今天或更早的有效日期，最长 31 个日历日。</p>
        : failed === queryKey && !data ? <div className="board-message"><p role="alert">读取活动失败。</p>
          <button onClick={() => { setFailed(''); setRetry(value => value + 1); }}>重试</button></div>
        : !data || !base || !view ? <p className="muted board-message" role="status">正在读取活动…</p>
        : !data.tracks.length ? <Empty title="暂无可显示的好友" detail="添加好友并完成采样后，活动会显示在这里。" />
        : <>
          <Overview tracks={data.tracks} base={base} view={view} game={game} onView={chooseWindow} />
          <div className="board-viewbar">
            <div><strong>{dateTime(view.from)} – {dateTime(view.until)}</strong><span> · {data.tracks.length} 位好友</span>
              {preset !== 'custom' && <span className={anchor ? 'board-history-mode' : 'board-live-mode'}>{anchor ? '回看中' : '跟随最新'}</span>}</div>
            <div className="board-zoom">
              <button aria-label="向前平移时间轴" title="查看更早时间" disabled={view.from <= base.from} onClick={() => pan(-1)}>‹</button>
              <button aria-label="向后平移时间轴" title="查看更晚时间" disabled={view.until >= base.until} onClick={() => pan(1)}>›</button>
              <button aria-label="缩小时间轴" title="缩小时间轴" disabled={view.until - view.from >= base.until - base.from} onClick={() => zoom(2)}>−</button>
              <button aria-label="放大时间轴" title="放大时间轴" disabled={view.until - view.from <= minTimelineWindow} onClick={() => zoom(0.5)}>＋</button>
              <button disabled={view.from === base.from && view.until === base.until} onClick={() => setVisible(null)}>适应范围</button>
              {preset !== 'custom' && <button disabled={!anchor} onClick={() => { setAnchor(null); setVisible(null); }}>回到最新</button>}
            </div>
          </div>
          <div className="board-selection" id={idPrefix + 'board-timeline'} tabIndex={-1}>
            <div aria-live="polite">{focus ? <>
              <strong>{people.get(focus.playerId)?.name} · {focusTitle}</strong>
              <span>{focusBand ? dateTime(focusBand.start) + ' – ' + dateTime(focusBand.end) : dateTime(focus.at)}
                {!timeInView(view, focus.at) && ' · 当前视野外'}</span>
            </> : <span>{removedCount > 0 ? `已删除 ${removedCount} 条缺口` : '点选区段查看详情 · Ctrl + 滚轮缩放'}</span>}</div>
            {focus && <div className="board-selection-actions">
              <RemoveGapButton key={focusGap?.rowId ?? 'none'} mode={snapshot.mode} playerId={focus.playerId} record={focusGap}
                onError={onError} onRemoved={targets => { setFocus(null); setRemovedCount(targets.length); }} />
              {returnEvent && matching.some(entry => entry.key === returnEvent) &&
                <button className="link" onClick={() => goToEvent(returnEvent, false)}>返回事件</button>}
              {!timeInView(view, focus.at) && timeInView(base, focus.at) && <button className="link" onClick={locateFocus}>找回选中项</button>}
              <button className="link" onClick={() => setJump({ id: 'board-focus-detail' })}>查看详情</button>
              <button className="link" onClick={() => setFocus(null)}>清除</button>
            </div>}
          </div>
          <Lanes board={data} bands={bands} people={people} base={base} view={view} focus={focus} game={game}
            axisVersion={axisVersion} idPrefix={idPrefix}
            onFocus={setFocus} onView={chooseWindow} />
          <div className="board-legend">
            <span className="board-tone-playing">游戏中</span><span className="board-tone-online">在线</span>
            <span className="board-tone-away">离开</span><span className="board-tone-busy">忙碌</span>
            <span className="board-tone-offline">显示离线</span><span className="board-tone-unknown">未知</span>
            <span className="board-tone-gap">采集缺口</span><span className="board-tone-empty">无记录</span>
            <span className="board-tone-growth">时长增长</span>
          </div>
          <FocusDetail id={idPrefix + 'board-focus-detail'} focus={focus && { ...focus, key: focusInList ? selectedEntry?.key ?? focus.key : undefined }}
            band={focusBand} friend={focus && people.get(focus.playerId) || undefined}
            entry={selectedEntry} onEvent={goToEvent} canLocate={Boolean(focus && timeInView(base, focus.at))} onLocate={locateFocus} />
        </>}
    </section>
    {!invalid && data && Boolean(data.tracks.length) && <section className="panel board-events" id={idPrefix + 'board-event-list'} tabIndex={-1}>
      <div className="board-viewbar">
        <div><h2>事件记录</h2><span>当前窗口 · {matching.length} 条</span></div>
        <button className="link" onClick={() => setJump({ id: 'board-timeline' })}>返回时间轴</button>
        <label>类型<select aria-label="事件类型" value={type} onChange={event => { setType(event.target.value as EventType); setCount(pageSize); }}>
          <option value="all">全部事件</option><option value="status">状态与游戏</option>
          <option value="gap">采集缺口</option><option value="playtime">时长增长</option>
        </select></label>
      </div>
      {!matching.length ? <Empty title="当前窗口没有符合条件的事件" detail="持续状态仍可在上方泳道查看。" /> :
        <ol className="board-event-list">{matching.slice(0, count).map((entry, index) => {
          const person = people.get(entry.playerId);
          const newDay = index === 0 || new Date(entry.at).toDateString() !== new Date(matching[index - 1].at).toDateString();
          const label = 'growth' in entry
            ? `${gameText({ gameId: entry.growth.appId, gameName: entry.growth.name }, titles)} · 时长 +${entry.growth.minutes} 分钟`
            : describeActivity(entry.activity, titles);
          return <li key={entry.key}>
            {newDay && <h3>{day(entry.at)}</h3>}
            <button className="board-event" id={idPrefix + 'board-event-' + entry.key} aria-pressed={entry.key === focus?.key}
              onClick={() => selectEntry(entry)}>
              <time dateTime={new Date(entry.at).toISOString()}>{clock(entry.at)}</time>
              {person && <Avatar person={person} />}
              <strong>{person?.name ?? ('activity' in entry ? entry.activity.name : entry.playerId)}</strong>
              <EventIcon entry={entry} /><span className="board-event-text">{label}</span>
            </button>
          </li>;
        })}</ol>}
      {matching.length > count && <button className="board-more" onClick={() => setCount(value => value + pageSize)}>显示更多事件</button>}
    </section>}
  </section>;
}
