import { useEffect, useState } from 'react';
import type { Activity, Friend } from '../../../shared';
import { Timeline } from '../../components/activity-list';
import { Badge } from '../../components/feedback';
import { Icon } from '../../components/icon';
import { Avatar } from '../../components/media';
import { api, errorText } from '../../lib/api';
import { clock } from '../../lib/format';
import { useGameTitles, useLoadGameTitles } from '../../lib/game-titles';
import { gameText } from '../../lib/model';
import { ConsentLog } from '../../components/consent-log';

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
    {real && <>
      <div className="timeline-header"><h3>授权</h3><span>确认时间与文字</span></div>
      <ConsentLog playerId={friend.id} version={version} empty="这个账号在 0.8 之前添加，当时没有保存授权记录。" onError={onError} />
    </>}
    <div className="timeline-header"><h3>最近活动</h3><span>首次观测时间</span></div>
    <Timeline rows={rows} />
  </>;
}
