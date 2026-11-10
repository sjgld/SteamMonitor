import { useEffect, useState } from 'react';
import type { Friend, NoticeOptions, Preferences } from '../../../shared';
import { api, errorText } from '../../lib/api';

export function PreferencesPanels({ friends, onError, onSaved }: {
  friends: Friend[]; onError: (text: string) => void; onSaved: (text: string) => void;
}) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveResult, setSaveResult] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    void api.preferences().then(value => { if (active) setPreferences(value); })
      .catch(error => { if (active) onError(errorText(error)); });
    return () => { active = false; };
  }, [onError]);
  if (!preferences) return null;
  const notices = preferences.notices;
  function updateNotice(edit: Partial<NoticeOptions>) {
    setPreferences(value => value && { ...value, notices: { ...value.notices, ...edit } });
  }
  async function run(action: () => Promise<boolean | void>, text: string) {
    setBusy(true);
    try { if (await action() !== false) onSaved(text); }
    catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <>
    <section id="settings-notice" tabIndex={-1} className="panel setting"><h2>好友通知</h2><p>仅对新观测到的变化提醒。启动与重连后的首笔状态用于建立基线。</p>
      <fieldset className="preference-fields" disabled={busy}>
        <label className="check"><input type="checkbox" checked={notices.online}
          onChange={event => updateNotice({ online: event.target.checked })} />好友上线</label>
        <label className="check"><input type="checkbox" checked={notices.game}
          onChange={event => updateNotice({ game: event.target.checked })} />好友开始玩游戏</label>
        <label className="check"><input type="checkbox" checked={notices.party}
          onChange={event => updateNotice({ party: event.target.checked })} />同一游戏凑够人数</label>
        <div className="preference-grid">
          <label>个人提醒对象<select value={notices.friendId} onChange={event => updateNotice({ friendId: event.target.value })}>
            <option value="">全部好友</option>
            {notices.friendId && !friends.some(friend => friend.id === notices.friendId) &&
              <option value={notices.friendId}>{notices.friendId}</option>}
            {friends.map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}
          </select></label>
          <label>游戏名或 App ID<input maxLength={100} value={notices.gameFilter} placeholder="不限游戏"
            onChange={event => updateNotice({ gameFilter: event.target.value })} /></label>
          <label>凑人门槛<input type="number" min="2" max="8" value={Number.isNaN(notices.partySize) ? '' : notices.partySize}
            onChange={event => updateNotice({ partySize: event.target.valueAsNumber })} /></label>
          <label>重复提醒冷却（分钟）<input type="number" min="1" max="240" value={Number.isNaN(notices.cooldown) ? '' : notices.cooldown}
            onChange={event => updateNotice({ cooldown: event.target.valueAsNumber })} /></label>
          <label>免打扰开始<input type="time" value={notices.quietStart} onChange={event => updateNotice({ quietStart: event.target.value })} /></label>
          <label>免打扰结束<input type="time" value={notices.quietEnd} onChange={event => updateNotice({ quietEnd: event.target.value })} /></label>
        </div>
      </fieldset>
      <div className="setting-actions"><button disabled={busy} onClick={() => void run(() => api.testNotice(), '测试通知已发送')}>发送测试通知</button></div>
    </section>
    <section id="settings-data" tabIndex={-1} className="panel setting"><h2>数据管理</h2><p>备份包含 Steam 好友名单、活动和公开时长样本。API Key 独立保存在本机。</p>
      <fieldset className="preference-fields" disabled={busy}>
        <div className="preference-grid"><label>历史保留天数<input type="number" min="7" max="365"
          value={Number.isNaN(preferences.retentionDays) ? '' : preferences.retentionDays}
          onChange={event => setPreferences({ ...preferences, retentionDays: event.target.valueAsNumber })} /></label></div>
        <label className="check"><input type="checkbox" checked={preferences.autoStart}
          onChange={event => setPreferences({ ...preferences, autoStart: event.target.checked })} />登录 Windows 后在托盘启动</label>
      </fieldset>
      <div className="setting-actions">
        <button className="primary" disabled={busy} onClick={() => {
          setBusy(true);
          setSaveResult(null);
          void api.savePreferences(preferences).then(() => setSaveResult({ text: '通知与数据设置已保存', error: false }))
            .catch(error => setSaveResult({ text: errorText(error), error: true })).finally(() => setBusy(false));
        }}>保存通知与数据设置</button>
        <button disabled={busy} onClick={() => void run(() => api.backup(), '备份已保存')}>备份数据</button>
        <button disabled={busy} onClick={() => void run(() => api.restore(), '备份已恢复')}>恢复备份</button>
        <button className="danger" disabled={busy} onClick={() => void run(() => api.clearHistory(), '活动历史已清除')}>清除所有历史</button>
      </div>
      {saveResult && <p className={`setting-feedback${saveResult.error ? ' error' : ''}`}
        role={saveResult.error ? 'alert' : 'status'}>{saveResult.text}</p>}
    </section>
  </>;
}
