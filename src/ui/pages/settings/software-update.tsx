import { useState } from 'react';
import type { ReleaseCheck, Snapshot } from '../../../shared';
import { api, errorText } from '../../lib/api';

export function SoftwareUpdate({ snapshot }: { snapshot: Snapshot }) {
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
