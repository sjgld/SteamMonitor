import { type FormEvent, useState } from 'react';
import { consentText, isApiKey, type Player, type Snapshot } from '../../../shared';
import { Dialog } from '../../components/dialog';
import { Icon } from '../../components/icon';
import { Avatar } from '../../components/media';
import { Stepper } from '../../components/stepper';
import { api, errorText } from '../../lib/api';
import { PlayerChoices } from '../friends/player-choices';

const steps = ['数据源', 'API Key', '记录对象'];

/**
 * Three-step setup: choose Steam data, verify and save the API key, then add the first accounts.
 * Closing it at any point is allowed; the caller returns to demo data when nothing was added.
 */
export function OnboardingDialog({ snapshot, close }: { snapshot: Snapshot; close: (finished: boolean) => void }) {
  const [step, setStep] = useState(0);
  const live = snapshot.mode === 'live' && snapshot.hasKey;
  return <Dialog title="连接 Steam 数据" close={() => close(false)} extra={<Stepper steps={steps} current={step} />}>
    {step === 0 && <SourceStep next={() => setStep(1)} stay={() => close(false)} />}
    {step === 1 && <KeyStep hasKey={snapshot.hasKey} connected={live} back={() => setStep(0)} next={() => setStep(2)} />}
    {step === 2 && <RosterStep tracked={live ? snapshot.friends.length : 0} back={() => setStep(1)} finish={() => close(true)} />}
  </Dialog>;
}

function SourceStep({ next, stay }: { next: () => void; stay: () => void }) {
  return <>
    <h3 className="step-title">① 选择数据源</h3>
    <dl className="source-choice">
      <div><dt>示例数据</dt><dd>内置的几位演示好友，不发出任何 Steam 请求，适合先熟悉界面。</dd></div>
      <div><dt>Steam 数据</dt><dd>用你自己的 Steam Web API Key，每 60 秒查询一次名单内账号的公开状态。</dd></div>
    </dl>
    <p className="muted"><Icon name="database" size={15} /> 好友名单、活动历史和 API Key 只保存在这台电脑上，不会上传。</p>
    <footer><button onClick={stay}>继续看示例</button><button className="primary" autoFocus onClick={next}>连接 Steam</button></footer>
  </>;
}

function KeyStep({ hasKey, connected, back, next }: { hasKey: boolean; connected: boolean; back: () => void; next: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);
  const value = key.trim();
  const malformed = value !== '' && !isApiKey(value);
  const hint = !malformed ? '' : /[^\da-f]/i.test(value) ? 'Key 只包含数字和字母 a–f，请检查是否多复制了其他字符。'
    : `Key 应为 32 位，当前 ${value.length} 位。`;

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setVerified(false);
    try {
      await api.connectSteam(value);
      setKey('');
      setVerified(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return <>
    <h3 className="step-title">② Steam Web API Key</h3>
    <p className="muted">用于查询公开状态，只保存在本机并由 Windows 凭据加密。</p>
    <form onSubmit={verify}>
      <label htmlFor="onboarding-key">API Key</label>
      <div className="input-action">
        <input id="onboarding-key" type="password" autoComplete="off" spellCheck={false} autoFocus value={key} maxLength={64}
          disabled={busy} aria-invalid={malformed} aria-describedby="onboarding-key-status"
          placeholder={hasKey ? '已加密保存，可填写新的 Key 替换' : '32 位十六进制 Key'}
          onChange={event => { setKey(event.target.value); setError(''); setVerified(false); }} />
        <button className="primary" disabled={busy || malformed || (!value && !hasKey)}>
          {busy ? '正在验证…' : value || !hasKey ? '验证并保存' : '验证已保存的 Key'}</button>
      </div>
    </form>
    <div className="key-status" id="onboarding-key-status">
      <span role={error || hint ? 'alert' : 'status'} className={error || hint ? 'field-error' : verified ? 'field-ok' : 'muted'}>
        {hint || error || (verified ? '✓ 已连接 Steam，可以读取公开资料' : connected ? '已保存的 Key 正在使用，可直接进入下一步。' : '保存前会向 Steam 试查一次公开资料。')}
      </span>
      <button type="button" className="link" onClick={() => void api.openSteam('key', '').catch(failure => setError(errorText(failure)))}>
        申请 Key <Icon name="external" size={14} /></button>
    </div>
    <footer><button onClick={back} disabled={busy}>上一步</button>
      <button className="primary" disabled={busy || !(verified || connected)} onClick={next}>下一步</button></footer>
  </>;
}

function RosterStep({ tracked, back, finish }: { tracked: number; back: () => void; finish: () => void }) {
  const [input, setInput] = useState('');
  const [self, setSelf] = useState<Player | null>(null);
  const [added, setAdded] = useState(false);
  const [friends, setFriends] = useState<Player[] | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [consent, setConsent] = useState(false);
  const [discover, setDiscover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  const lookUp = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      setSelf(null); setAdded(false); setFriends(null); setSelected(new Set()); setNotice('');
      setSelf(await api.previewPlayer(input));
    });
  };
  const addSelf = () => void run(async () => {
    await api.addPlayers([self!.id], consent);
    setAdded(true);
    setNotice(`已开始记录 ${self!.name}`);
  });
  const loadFriends = () => void run(async () => {
    setSelected(new Set());
    setFriends(await api.previewFriends(self!.id));
  });
  const addFriends = () => void run(async () => {
    const count = selected.size;
    await api.addPlayers([...selected], consent);
    setFriends(null);
    setSelected(new Set());
    setNotice(`已加入 ${count} 位好友`);
  });
  const complete = () => void run(async () => {
    if (discover && self) await api.configureDiscovery(self.id, true, true);
    finish();
  });

  return <>
    <h3 className="step-title">③ 第一批记录对象</h3>
    <p className="muted">先添加你自己的账号，稍后可以在好友页继续添加。{tracked > 0 && `名单中已有 ${tracked} 人。`}</p>
    <form onSubmit={lookUp}>
      <label htmlFor="onboarding-profile">你的 SteamID64 或个人资料链接</label>
      <div className="input-action">
        <input id="onboarding-profile" autoFocus value={input} maxLength={256} disabled={busy}
          placeholder="https://steamcommunity.com/id/…" onChange={event => setInput(event.target.value)} />
        <button disabled={!input.trim() || busy}>查询</button>
      </div>
    </form>
    {self && <div className="preview-list"><div className="preview-row">
      <label>{self.avatar && <Avatar person={self} />}<span>{self.name} · {self.id}</span></label>
      {added ? <span className="field-ok">✓ 已添加</span> : <button type="button" className="link" onClick={() =>
        void api.openSteam('profile', self.id).catch(failure => setError(errorText(failure)))}>核对资料 <Icon name="external" size={14} /></button>}
    </div></div>}
    {added && (friends ? friends.length ? <>
      <p className="muted">找到 {friends.length} 个可添加的账号，核对后勾选。</p>
      <PlayerChoices players={friends} selected={selected} disabled={busy} onChange={setSelected} onError={setError} />
    </> : <p className="muted">公开好友名单中没有可添加的账号。</p>
      : <p><button type="button" disabled={busy} onClick={loadFriends}>导入我的公开好友名单（可选）</button></p>)}
    {self && <label className="check"><input type="checkbox" checked={consent} disabled={busy}
      onChange={event => setConsent(event.target.checked)} />{consentText.track}</label>}
    {self && !added && <p><button className="primary" disabled={busy || !consent} onClick={addSelf}>开始记录我的账号</button></p>}
    {added && friends && friends.length > 0 && <p><button disabled={busy || !consent || !selected.size} onClick={addFriends}>
      添加所选{selected.size > 0 && ` · ${selected.size} 人`}</button></p>}
    {added && <label className="check"><input type="checkbox" checked={discover} disabled={busy}
      onChange={event => setDiscover(event.target.checked)} />开启好友发现：{consentText.discovery}</label>}
    {error && <p className="message error" role="alert">{error}</p>}
    {notice && !error && <p className="field-ok" role="status">{notice}</p>}
    <footer><button onClick={back} disabled={busy}>上一步</button>
      <button className="primary" disabled={busy || (tracked === 0 && !added)} onClick={complete}>完成</button></footer>
  </>;
}
