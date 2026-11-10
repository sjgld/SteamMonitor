import { useEffect, useState } from 'react';
import { consentText, type Friend } from '../../../shared';
import { Dialog } from '../../components/dialog';
import { api, errorText } from '../../lib/api';

export function EditDialog({ friend, close }: { friend: Friend; close: () => void }) {
  const [note, setNote] = useState(friend.note);
  const [pinned, setPinned] = useState(friend.pinned);
  const [paused, setPaused] = useState(friend.paused);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Resuming an account whose consent was withdrawn takes a new confirmation.
  const [withdrawn, setWithdrawn] = useState(false);
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    let current = true;
    void api.consents(friend.id).then(records => {
      if (current) setWithdrawn(records.find(record => record.kind === 'track')?.revokedAt != null);
    }).catch(() => {});
    return () => { current = false; };
  }, [friend.id]);
  const resuming = withdrawn && friend.paused && !paused;
  async function save(remove = false) {
    setBusy(true);
    try {
      if (remove) await api.removeFriend(friend.id);
      else await api.updateFriend(friend.id, { note, pinned, paused }, resuming && consent);
      close();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }
  return <Dialog title={`编辑 ${friend.name}`} close={close}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor="friend-note">备注</label>
      <input id="friend-note" autoFocus value={note} maxLength={100} onChange={event => setNote(event.target.value)} />
      <label className="check"><input type="checkbox" checked={pinned} onChange={event => setPinned(event.target.checked)} /> 置顶好友</label>
      <label className="check"><input type="checkbox" checked={paused} onChange={event => setPaused(event.target.checked)} /> 暂停此账号的采集</label>
      {resuming && <label className="check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
        {consentText.track}</label>}
      {error && <p className="message error" role="alert">{error}</p>}
      {confirming && <p className="message error">移除后将删除此账号的本地历史。</p>}
      <footer className="split">
        <button className="danger" type="button" disabled={busy}
          onClick={() => confirming ? void save(true) : setConfirming(true)}>{confirming ? '确认移除' : '移除好友'}</button>
        <button className="primary" disabled={busy || (resuming && !consent)}>保存</button>
      </footer>
    </form>
  </Dialog>;
}
