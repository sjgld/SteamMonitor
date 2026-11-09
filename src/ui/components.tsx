import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { presenceLabels, type Activity, type Friend, type Player } from '../shared';
import { api, clock, describeActivity, errorText, gameImage, gameText, statusOf } from './model';
import { useGameTitles, useLoadGameTitles } from './game-titles';

const paths = {
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  friends: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0m4-4a4 4 0 0 1 0 8',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  refresh: 'M20 7v5h-5M4 17v-5h5m-4-2a7 7 0 0 1 12-4l3 3M4 15l3 3a7 7 0 0 0 12-4',
  plus: 'M12 5v14M5 12h14',
  search: 'm21 21-4.3-4.3m2.3-5.7a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  star: 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  arrow: 'm9 5 7 7-7 7',
  external: 'M13 5h6v6m0-6-9 9m7-1v6H5V7h6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  edit: 'm4 16 12-12 4 4L8 20H4zm9-9 4 4',
  game: 'M7 7h10c2 0 4 2 4 5l1 4c.5 3-2 4-4 2l-2-2H8l-2 2c-2 2-4.5 1-4-2l1-4c0-3 2-5 4-5zm0 3v4m-2-2h4m6 0h.01m3 0h.01',
  close: 'm6 6 12 12M18 6 6 18',
  review: 'M4 20h16M6 16v-4m6 4V4m6 12V8',
  radar: 'M12 12l7-7m2 7a9 9 0 1 1-9-9m5 9a5 5 0 1 1-5-5m0 5h.01',
  layers: 'm12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5',
  database: 'M4 6c0-2 3.6-3 8-3s8 1 8 3-3.6 3-8 3-8-1-8-3zm0 0v6c0 2 3.6 3 8 3s8-1 8-3V6m-16 6v6c0 2 3.6 3 8 3s8-1 8-3v-6',
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Avatar({ person, big }: { person: Player; big?: boolean }) {
  const tone = Number(person.id.slice(-2)) % 5;
  return <span className={`avatar tone-${tone}${big ? ' avatar-big' : ''}`} aria-hidden="true">
    {Array.from(person.name).slice(0, 2).join('')}
    {person.avatar && <img key={person.avatar} src={person.avatar} alt="" referrerPolicy="no-referrer"
      onError={event => { event.currentTarget.hidden = true; }} />}
  </span>;
}

export function GamePicture({ id, large = false }: { id: string | null; large?: boolean }) {
  return <GamePictureContent key={id} id={id} large={large} />;
}

function useGameArtwork(id: string | null) {
  const [failed, setFailed] = useState(false);
  return { image: failed ? null : gameImage(id), onError: () => setFailed(true) };
}

function GamePictureContent({ id, large }: { id: string | null; large: boolean }) {
  useLoadGameTitles([id]);
  const { image, onError } = useGameArtwork(id);
  return <span className={large ? 'game-picture game-picture-large' : 'game-picture'}><Icon name="game" size={large ? 18 : 13} />
    {image && <img key={image} src={image} alt="" referrerPolicy="no-referrer" onError={onError} />}
  </span>;
}

type ArtworkBounds = { x?: number; y: number; width: number; height: number };

export function TimelineGamePicture({ id, ...bounds }: ArtworkBounds & { id: string | null }) {
  return <TimelineArtwork key={id} id={id} {...bounds} />;
}

function TimelineArtwork({ id, ...bounds }: ArtworkBounds & { id: string | null }) {
  const { image, onError } = useGameArtwork(id);
  return image
    ? <image key={image} {...bounds} href={image} preserveAspectRatio="xMidYMid slice" onError={onError} />
    : <svg {...bounds} viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths.game} fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
}

export function Badge({ friend }: { friend: Friend }) {
  const status = statusOf(friend);
  const label = friend.paused ? '已暂停' : friend.gapSince !== null ? '采集中断'
    : status === 'playing' ? '游戏中' : presenceLabels[friend.presence];
  return <span className={`badge status-${status}`}><span className="dot" />{label}</span>;
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><Icon name="activity" size={24} /><strong>{title}</strong><span>{detail}</span></div>;
}

export function Timeline({ rows, people }: { rows: Activity[]; people?: ReadonlyMap<string, Player> }) {
  const titles = useGameTitles();
  useLoadGameTitles(rows.flatMap(row => [row.gameId, row.previousGameId]));
  if (!rows.length) return <Empty title="暂无活动" detail="有效采样后，状态变化会出现在这里。" />;
  return <ol className={people ? 'timeline activity-timeline' : 'timeline'}>
    {rows.map(row => {
      const person = people?.get(row.playerId) ?? { id: row.playerId, name: row.name };
      const current = gameText(row, titles);
      const previous = gameText({ gameId: row.previousGameId, gameName: row.previousGameName }, titles);
      const switching = current && previous && (row.gameId ?? current) !== (row.previousGameId ?? previous);
      return <li key={row.rowId} className={row.kind === 'gap' ? 'gap-event' : ''}>
        <span className="event-marker" />
        {people && <Avatar person={person} />}
        <div className="event-meta">
          <time dateTime={new Date(row.at).toISOString()}>{clock(row.at)}</time>
          {row.kind === 'gap' && <span>至 {row.endedAt === null ? '恢复采集前' : clock(row.endedAt)}</span>}
          {people && <span className="event-person">{row.name}</span>}
        </div>
        <div className="event-text">
          {people && (current || previous) && <span className="event-games">
            {switching && <><span title={previous}><GamePicture id={row.previousGameId} /></span><Icon name="arrow" size={12} /></>}
            <span title={current || previous}><GamePicture id={current ? row.gameId : row.previousGameId} /></span>
          </span>}
          <span>{describeActivity(row, titles)}</span>
        </div>
      </li>;
    })}
  </ol>;
}

export function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return <dialog className="modal" aria-label={title} ref={element => {
    if (element && !element.open) element.showModal();
  }} onCancel={event => { event.preventDefault(); close(); }}>
    <header><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={close}><Icon name="close" /></button></header>
    {children}
  </dialog>;
}

export function AddDialog({ close, saved, discovered = false }: { close: () => void; saved: () => void; discovered?: boolean }) {
  const [method, setMethod] = useState<'one' | 'list'>('one');
  const [input, setInput] = useState('');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(discovered);
  const [error, setError] = useState('');
  const reset = () => { setPlayers(null); setSelected(new Set()); setConsent(false); setError(''); };

  useEffect(() => {
    if (!discovered) return;
    let active = true;
    void api.previewDiscovery().then(items => { if (active) setPlayers(items); })
      .catch(failure => { if (active) setError(errorText(failure)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [discovered]);

  async function preview(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    reset();
    try {
      const items = method === 'one' ? [await api.previewPlayer(input)] : await api.previewFriends(input);
      setPlayers(items);
      if (method === 'one') setSelected(new Set(items.map(item => item.id)));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    setBusy(true);
    setError('');
    try {
      await api.addPlayers([...selected]);
      saved();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }

  return <Dialog title={discovered ? '待确认的好友' : '添加记录对象'} close={close}>
    {discovered ? <p className="muted">{busy && !players ? '正在读取发现结果…' : '核对资料后勾选需要记录的账号。'}</p> : <>
    <div className="segmented">
      <button aria-pressed={method === 'one'} disabled={busy} onClick={() => { setMethod('one'); reset(); }}>单个账号</button>
      <button aria-pressed={method === 'list'} disabled={busy} onClick={() => { setMethod('list'); reset(); }}>导入公开好友名单</button>
    </div>
    <form onSubmit={preview}>
      <label htmlFor="profile-input">{method === 'one' ? '账号的 SteamID64 或个人资料链接' : '好友名单所有者的 SteamID64 或资料链接'}</label>
      <div className="input-action">
        <input id="profile-input" autoFocus value={input} maxLength={256} disabled={busy}
          placeholder="https://steamcommunity.com/id/…"
          onChange={event => { setInput(event.target.value); reset(); }} />
        <button disabled={!input.trim() || busy}>查询</button>
      </div>
    </form>
    </>}
    {error && <p className="message error" role="alert">{error}</p>}
    {players && (players.length ? <>
      {!discovered && <p className="muted">{method === 'one' ? '确认昵称和 SteamID64。' : `找到 ${players.length} 个可添加的账号，点击资料核对后勾选。`}</p>}
      <div className="preview-list">
        {players.map(player => <div key={player.id} className="preview-row">
          <label><input type="checkbox" checked={selected.has(player.id)} disabled={busy} onChange={event => {
            const checked = event.target.checked;
            setSelected(previous => {
              const next = new Set(previous);
              if (checked) next.add(player.id);
              else next.delete(player.id);
              return next;
            });
          }} /> {player.avatar && <Avatar person={player} />}<span>{player.name === player.id ? player.id : `${player.name} · ${player.id}`}</span></label>
          <button type="button" className="link" onClick={() => {
            void api.openSteam('profile', player.id).catch(failure => setError(errorText(failure)));
          }}>核对资料 <Icon name="external" size={14} /></button>
        </div>)}
      </div>
      <label className="check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
        我确认所选账号属于我，或账号持有人已请求记录并知悉保存内容。
      </label>
      <footer><button className="primary" disabled={!selected.size || !consent || busy} onClick={() => void add()}>
        开始记录{selected.size > 0 && ` · ${selected.size} 人`}
      </button></footer>
    </> : <p className="muted">没有可添加的账号。</p>)}
  </Dialog>;
}

export function EditDialog({ friend, close }: { friend: Friend; close: () => void }) {
  const [note, setNote] = useState(friend.note);
  const [pinned, setPinned] = useState(friend.pinned);
  const [paused, setPaused] = useState(friend.paused);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(remove = false) {
    setBusy(true);
    try {
      if (remove) await api.removeFriend(friend.id);
      else await api.updateFriend(friend.id, { note, pinned, paused });
      close();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }
  return <Dialog title={`编辑 ${friend.name}`} close={close}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor="friend-note">备注</label>
      <input id="friend-note" autoFocus value={note} maxLength={100} onChange={event => setNote(event.target.value)} />
      <label className="check"><input type="checkbox" checked={pinned} onChange={event => setPinned(event.target.checked)} /> 置顶好友</label>
      <label className="check"><input type="checkbox" checked={paused} onChange={event => setPaused(event.target.checked)} /> 暂停此账号的采集</label>
      {error && <p className="message error" role="alert">{error}</p>}
      {confirming && <p className="message error">移除后将删除此账号的本地历史。</p>}
      <footer className="split">
        <button className="danger" type="button" disabled={busy}
          onClick={() => confirming ? void save(true) : setConfirming(true)}>{confirming ? '确认移除' : '移除好友'}</button>
        <button className="primary" disabled={busy}>保存</button>
      </footer>
    </form>
  </Dialog>;
}

export function FriendDetail({ friend, version, activePage, editable, real, onError }: {
  friend: Friend; version: number; activePage: boolean; editable: () => void;
  real: boolean; onError: (text: string) => void;
}) {
  const [rows, setRows] = useState<Activity[]>([]);
  useEffect(() => {
    if (!activePage) return;
    let current = true;
    void api.activity({ playerId: friend.id }).then(items => { if (current) setRows(items.slice(0, 8)); })
      .catch(error => { if (current) onError(errorText(error)); });
    return () => { current = false; };
  }, [friend.id, version, activePage, onError]);
  const titles = useGameTitles();
  useLoadGameTitles([friend.gameId]);
  const game = gameText(friend, titles);
  return <>
    <div className="detail-heading">
      <Avatar person={friend} big />
      <div className="detail-name"><h2>{friend.name}</h2><span>{friend.note || (real ? friend.id : '演示好友')}</span></div>
      <button className="icon-button" aria-label="编辑好友" onClick={editable}><Icon name="edit" /></button>
    </div>
    <div className="detail-status">
      <Badge friend={friend} />
      {game && <span>{friend.gapSince !== null ? '上次观测 · ' : ''}{game}</span>}
      {!game && friend.presence !== 'unknown' && friend.presence !== 'offline' && <span>未看到游戏活动</span>}
      <span className="observed">上次成功观测 {friend.observedAt === null ? '—' : clock(friend.observedAt)}</span>
    </div>
    <div className="detail-links">
      {real && <button className="link" onClick={() => void api.openSteam('profile', friend.id).catch(error => onError(errorText(error)))}>
        Steam 资料 <Icon name="external" size={15} />
      </button>}
      {friend.gameId && Number(friend.gameId) <= 0xFFFFFF && <button className="link"
        onClick={() => void api.openSteam('game', friend.gameId!).catch(error => onError(errorText(error)))}>
        游戏商店 <Icon name="external" size={15} />
      </button>}
    </div>
    <div className="timeline-header"><h3>最近活动</h3><span>首次观测时间</span></div>
    <Timeline rows={rows} />
  </>;
}
