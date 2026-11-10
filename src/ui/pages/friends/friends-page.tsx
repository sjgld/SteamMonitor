import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Friend, Snapshot } from '../../../shared';
import { Badge, Empty } from '../../components/feedback';
import { Icon } from '../../components/icon';
import { Avatar, GamePicture } from '../../components/media';
import { api, errorText } from '../../lib/api';
import { useGameTitles, useLoadGameTitles } from '../../lib/game-titles';
import { type Filter, gameText, matches, rosterGroups } from '../../lib/model';
import { locateElement } from '../../lib/motion';
import { DiscoveryInbox } from './discovery-inbox';
import { FriendDetail } from './friend-detail';

export function FriendsPage({ snapshot, version, activePage, onAdd, onEdit, onTimeline, onDiscovery, onError }: {
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
