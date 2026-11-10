import { useEffect, useState } from 'react';
import { consentText, type Friend, type PlaytimeEvent, type PlaytimeReview, type PlaytimeWatch } from '../../../shared';
import { Dialog } from '../../components/dialog';
import { GamePicture } from '../../components/media';
import { PlaytimeEvents } from '../../components/playtime-events';
import { api, errorText } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useGameTitles } from '../../lib/game-titles';
import { gameText } from '../../lib/model';

export function PlaytimeExperiment({ friend, demo, version, events, onError }: {
  friend: Friend; demo: boolean; version: number; events: PlaytimeEvent[]; onError: (text: string) => void;
}) {
  const titles = useGameTitles();
  const [review, setReview] = useState<PlaytimeReview | null>(null);
  const [watch, setWatch] = useState<PlaytimeWatch | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirming, setConfirming] = useState<'manual' | 'auto' | 'clear' | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([api.playtime(friend.id), api.playtimeWatch(friend.id)]).then(([value, settings]) => {
      if (active) { setReview(value); setWatch(settings); }
    })
      .catch(error => { if (active) onError(errorText(error)); });
    return () => { active = false; };
  }, [friend.id, version, onError]);
  async function sample(approved: boolean) {
    setConfirming(null);
    setBusy(true);
    try {
      setReview(await api.samplePlaytime(friend.id, approved));
      setWatch(await api.playtimeWatch(friend.id));
    }
    catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function configure(enabled: boolean) {
    setConfirming(null);
    setBusy(true);
    try {
      await api.setPlaytimeWatch(friend.id, enabled, consent);
      setWatch(await api.playtimeWatch(friend.id));
    } catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function clear() {
    setConfirming(null);
    setBusy(true);
    try { await api.clearPlaytime(friend.id); setReview(null); setConsent(false); setWatch(await api.playtimeWatch(friend.id)); }
    catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  const blocked = busy || Boolean(watch?.checking) || friend.paused;
  return <section className="panel summary-panel">
    <div className="summary-header">
      <div><h2>公开游戏时长对比 <small className="experiment">实验</small></h2>
        <p className="muted">Steam 公开累计时长的增长按发现时间记录。延迟同步和采集缺口会影响匹配。</p></div>
      <div className="playtime-actions">
        {!demo && <button className={watch?.enabled ? undefined : 'primary'}
          disabled={!watch || busy || (!watch.enabled && friend.paused)} onClick={() => {
            if (watch?.enabled) void configure(false);
            else { setConsent(false); setConfirming('auto'); }
          }}>{watch?.enabled ? '关闭自动采样' : '开启自动采样'}</button>}
        <button disabled={blocked} onClick={() => demo || (!watch?.needsConsent && (review || watch?.enabled)) ? void sample(false) :
          (setConsent(false), setConfirming('manual'))}>{review ? '再次采样' : '记录时长基线'}</button>
      </div>
    </div>
    {!demo && <p className="muted" role="status">{watch?.checking ? '正在采样…' : watch?.enabled
      ? watch.paused ? '自动采样已暂停' : watch.nextAt ? '下次自动采样约在 ' + dateTime(watch.nextAt) : '等待首次自动采样'
      : '自动采样关闭 · 启用后约每 30 分钟检查一次'}</p>}
    {watch?.error && <p className="message error" role="status">{watch.error}</p>}
    {review && <div className="playtime-result">
      <p>采样 {dateTime(review.at)}{review.since !== null && ' · 对比 ' + dateTime(review.since)}</p>
      {review.since === null ? <p className="muted">已保存基线。{demo ? '可再次采样查看示例。' : watch?.enabled ? '等待下一次自动采样。' : '至少 10 分钟后可再次采样。'}</p>
        : review.changes.length && !events.some(event => event.at === review.at) ? <ul className="report-games">{review.changes.map(game => <li key={game.appId}>
          <GamePicture id={game.appId} /><strong>{gameText({ gameId: game.appId, gameName: game.name }, titles)}</strong><span>+{game.minutes} 分钟</span>
          <span className="muted">{game.seen ? '时间轴有记录' : '同期未观测到此游戏'}</span>
        </li>)}</ul> : !review.changes.length && <p className="muted">两次采样之间暂无可比较的增长。</p>}
    </div>}
    {events.length > 0 && <div className="playtime-result"><h3>所选范围的时长增长</h3><PlaytimeEvents events={events} /></div>}
    {(review || events.length > 0 || watch?.enabled) && <button className="link" disabled={busy}
      onClick={() => setConfirming('clear')}>清除时长样本与历史</button>}
    {confirming === 'clear' && <Dialog title="清除公开时长记录" close={() => setConfirming(null)}>
      <p>清除这个账号的累计时长样本和增长历史，并关闭自动采样。</p>
      <footer><button className="danger" onClick={() => void clear()}>确认清除</button></footer>
    </Dialog>}
    {(confirming === 'manual' || confirming === 'auto') && <Dialog title={confirming === 'auto' ? '开启自动时长采样' : '开始公开时长对比'}
      close={() => setConfirming(null)}>
      <p className="muted">{confirming === 'auto' ? '程序运行时约每 30 分钟采样一次，首次采样建立基线。' : '采样会把该账号的 Steam 公开游戏累计分钟数保存到本机。'}</p>
      <label className="check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
        {consentText.playtime}</label>
      <footer><button className="primary" disabled={!consent}
        onClick={() => confirming === 'auto' ? void configure(true) : void sample(consent)}>{confirming === 'auto' ? '确认开启' : '保存首次样本'}</button></footer>
    </Dialog>}
  </section>;
}
