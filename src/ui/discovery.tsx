import { useState, type FormEvent } from 'react';
import type { DiscoverySnapshot, Snapshot } from '../shared';
import { Icon } from './components';
import { api, dateTime, errorText } from './model';

export function DiscoveryInbox({ discovery, review, onError }: {
  discovery: DiscoverySnapshot; review: () => void; onError: (message: string) => void;
}) {
  if (discovery.pending === 0) return null;
  return <section className="panel discovery-inbox" aria-label="好友发现">
    <span className="module-icon"><Icon name="radar" /></span>
    <div><strong>{discovery.pending} 位好友待确认</strong><p>公开好友名单中有可以添加的账号。</p></div>
    <div className="inbox-actions">
      <button className="link" onClick={() => void api.dismissDiscovery().catch(error => onError(errorText(error)))}>忽略本批</button>
      <button onClick={review}>查看名单 <Icon name="arrow" size={14} /></button>
    </div>
  </section>;
}

export function DiscoverySettings({ snapshot, onError, onSaved }: {
  snapshot: Snapshot; onError: (message: string) => void; onSaved: (message: string) => void;
}) {
  const { discovery } = snapshot;
  const [owner, setOwner] = useState(discovery.owner);
  const [enabled, setEnabled] = useState(discovery.enabled);
  const [saving, setSaving] = useState(false);
  const ready = snapshot.mode === 'live' && snapshot.hasKey;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.configureDiscovery(owner.trim(), enabled);
      onSaved('好友发现设置已保存');
    } catch (error) { onError(errorText(error)); }
    finally { setSaving(false); }
  }
  return <section className="panel setting">
    <div className="module-heading"><span className="module-icon"><Icon name="radar" /></span>
      <div><h2>好友发现</h2><p>在采集运行时每 30 分钟检查一次自己的公开好友名单。</p></div>
    </div>
    <form onSubmit={save}>
      <label htmlFor="discovery-owner">你自己的 SteamID64 或资料链接</label>
      <input id="discovery-owner" value={owner} maxLength={256}
        disabled={!ready || saving} placeholder="https://steamcommunity.com/id/…"
        onChange={event => setOwner(event.target.value)} />
      <label className="check"><input type="checkbox" checked={enabled} disabled={!ready || saving}
        onChange={event => setEnabled(event.target.checked)} />定期检查公开好友名单</label>
      <div className="setting-actions">
        <button className="primary" disabled={!ready || saving || (enabled && !owner.trim())}>保存发现设置</button>
        <button type="button" disabled={!ready || saving || discovery.checking || !discovery.owner || snapshot.paused}
          onClick={() => void api.checkDiscovery().catch(error => onError(errorText(error)))}>立即检查</button>
      </div>
    </form>
    <p className={discovery.error && ready ? 'discovery-error' : 'muted'} role="status">{!ready ? '切换到 Steam 数据并保存 API Key 后可使用。'
      : discovery.checking ? '正在读取公开好友名单…'
        : discovery.error || (discovery.checkedAt ? '最近检查 ' + dateTime(discovery.checkedAt) + ' · 待确认 ' + discovery.pending + ' 人'
          : '首次检查会列出尚未添加的好友。')}</p>
  </section>;
}
