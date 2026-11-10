import type { ReactNode } from 'react';
import { type Friend, presenceLabels } from '../../shared';
import { statusOf } from '../lib/model';
import { Icon } from './icon';

export function Badge({ friend }: { friend: Friend }) {
  const status = statusOf(friend);
  const label = friend.paused ? '已暂停' : friend.gapSince !== null ? '采集中断'
    : status === 'playing' ? '游戏中' : presenceLabels[friend.presence];
  return <span className={`badge status-${status}`}><span className="dot" />{label}</span>;
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><Icon name="activity" size={24} /><strong>{title}</strong><span>{detail}</span></div>;
}

/** A thin strip under the top bar for a standing condition, with one action and a dismiss button. */
export function Banner({ children, action, onAction, onClose }: {
  children: ReactNode; action: string; onAction: () => void; onClose: () => void;
}) {
  return <div className="banner" role="status">
    <span>{children}</span><span aria-hidden="true">·</span>
    <button className="link" onClick={onAction}>{action}</button>
    <button className="icon-button" aria-label="关闭横幅" onClick={onClose}><Icon name="close" size={14} /></button>
  </div>;
}
