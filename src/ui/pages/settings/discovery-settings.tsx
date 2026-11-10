import { type FormEvent, useEffect, useState } from 'react';
import { consentText, type Snapshot } from '../../../shared';
import { Icon } from '../../components/icon';
import { api, errorText } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { ConsentLog } from '../../components/consent-log';

export function DiscoverySettings({ snapshot, onError, onSaved }: {
  snapshot: Snapshot; onError: (message: string) => void; onSaved: (message: string) => void;
}) {
  const { discovery } = snapshot;
  const [owner, setOwner] = useState(discovery.owner);
  const [enabled, setEnabled] = useState(discovery.enabled);
  const [saving, setSaving] = useState(false);
  const ready = snapshot.mode === 'live' && snapshot.hasKey;
  const [consented, setConsented] = useState(false);
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    let current = true;
    void api.consents(null).then(records => { if (current) setConsented(records.some(record => record.revokedAt === null)); })
      .catch(() => {});
    return () => { current = false; };
  }, [discovery.enabled, discovery.owner, snapshot.mode]);
  // Turning discovery on, or pointing it at another account, takes a confirmation that is logged.
  const confirming = enabled && (!consented || owner.trim() !== discovery.owner);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.configureDiscovery(owner.trim(), enabled, confirming && consent);
      setConsent(false);
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
      {confirming && <label className="check"><input type="checkbox" checked={consent} disabled={!ready || saving}
        onChange={event => setConsent(event.target.checked)} />{consentText.discovery}</label>}
      <div className="setting-actions">
        <button className="primary" disabled={!ready || saving || (enabled && !owner.trim()) || (confirming && !consent)}>保存发现设置</button>
        <button type="button" disabled={!ready || saving || discovery.checking || !discovery.owner || snapshot.paused}
          onClick={() => void api.checkDiscovery().catch(error => onError(errorText(error)))}>立即检查</button>
      </div>
    </form>
    <p className={discovery.error && ready ? 'discovery-error' : 'muted'} role="status">{!ready ? '切换到 Steam 数据并保存 API Key 后可使用。'
      : discovery.checking ? '正在读取公开好友名单…'
        : discovery.error || (discovery.checkedAt ? '最近检查 ' + dateTime(discovery.checkedAt) + ' · 待确认 ' + discovery.pending + ' 人'
          : '首次检查会列出尚未添加的好友。')}</p>
    {ready && <ConsentLog playerId={null} version={`${discovery.enabled}:${discovery.owner}`} empty="" onError={onError} />}
  </section>;
}
