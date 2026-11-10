import { type FormEvent, useState } from 'react';
import type { Snapshot } from '../../../shared';
import { api, errorText } from '../../lib/api';
import { locateElement } from '../../lib/motion';
import { DiscoverySettings } from './discovery-settings';
import { PreferencesPanels } from './preferences-panels';
import { SoftwareUpdate } from './software-update';

export function Settings({ snapshot, onError, onSaved }: { snapshot: Snapshot; onError: (text: string) => void; onSaved: (text: string) => void }) {
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
