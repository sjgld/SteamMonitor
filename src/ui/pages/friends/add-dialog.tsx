import { type FormEvent, useEffect, useState } from 'react';
import { consentText, type Player } from '../../../shared';
import { Dialog } from '../../components/dialog';
import { api, errorText } from '../../lib/api';
import { PlayerChoices } from './player-choices';

export function AddDialog({ close, saved, discovered = false }: { close: () => void; saved: () => void; discovered?: boolean }) {
  const [method, setMethod] = useState<'one' | 'list'>('one');
  const [input, setInput] = useState('');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(discovered);
  const [error, setError] = useState('');
  const reset = () => { setPlayers(null); setSelected(new Set()); setConsent(false); setError(''); };

  useEffect(() => {
    if (!discovered) return;
    let active = true;
    void api.previewDiscovery().then(items => { if (active) setPlayers(items); })
      .catch(failure => { if (active) setError(errorText(failure)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [discovered]);

  async function preview(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    reset();
    try {
      const items = method === 'one' ? [await api.previewPlayer(input)] : await api.previewFriends(input);
      setPlayers(items);
      if (method === 'one') setSelected(new Set(items.map(item => item.id)));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    setBusy(true);
    setError('');
    try {
      await api.addPlayers([...selected], consent);
      saved();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }

  return <Dialog title={discovered ? '待确认的好友' : '添加记录对象'} close={close}>
    {discovered ? <p className="muted">{busy && !players ? '正在读取发现结果…' : '核对资料后勾选需要记录的账号。'}</p> : <>
    <div className="segmented">
      <button aria-pressed={method === 'one'} disabled={busy} onClick={() => { setMethod('one'); reset(); }}>单个账号</button>
      <button aria-pressed={method === 'list'} disabled={busy} onClick={() => { setMethod('list'); reset(); }}>导入公开好友名单</button>
    </div>
    <form onSubmit={preview}>
      <label htmlFor="profile-input">{method === 'one' ? '账号的 SteamID64 或个人资料链接' : '好友名单所有者的 SteamID64 或资料链接'}</label>
      <div className="input-action">
        <input id="profile-input" autoFocus value={input} maxLength={256} disabled={busy}
          placeholder="https://steamcommunity.com/id/…"
          onChange={event => { setInput(event.target.value); reset(); }} />
        <button disabled={!input.trim() || busy}>查询</button>
      </div>
    </form>
    </>}
    {error && <p className="message error" role="alert">{error}</p>}
    {players && (players.length ? <>
      {!discovered && <p className="muted">{method === 'one' ? '确认昵称和 SteamID64。' : `找到 ${players.length} 个可添加的账号，点击资料核对后勾选。`}</p>}
      <PlayerChoices players={players} selected={selected} disabled={busy} onChange={setSelected} onError={setError} />
      <label className="check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
        {consentText.track}
      </label>
      <footer><button className="primary" disabled={!selected.size || !consent || busy} onClick={() => void add()}>
        开始记录{selected.size > 0 && ` · ${selected.size} 人`}
      </button></footer>
    </> : <p className="muted">没有可添加的账号。</p>)}
  </Dialog>;
}
