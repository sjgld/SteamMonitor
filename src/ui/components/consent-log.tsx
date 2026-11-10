import { useEffect, useState } from 'react';
import { consentLabels, type ConsentRecord } from '../../shared';
import { Dialog } from './dialog';
import { api, errorText } from '../lib/api';
import { dateTime } from '../lib/format';

const revokeEffect = {
  track: '撤回后会暂停这个账号的采集。恢复记录时需要重新确认。',
  playtime: '撤回后会关闭这个账号的自动时长采样，再次采样时需要重新确认。',
  discovery: '撤回后会停止定期读取公开好友名单。',
};
const clearLabel = { track: '同时清除这个账号的活动历史和时长样本', playtime: '同时清除这个账号的时长样本和增长历史' };

/** The consent log of a friend (`playerId`) or of friend discovery (`null`), with withdrawal. */
export function ConsentLog({ playerId, version, empty, onError }: {
  playerId: string | null; version: unknown; empty: string; onError: (text: string) => void;
}) {
  const [records, setRecords] = useState<ConsentRecord[] | null>(null);
  const [revoking, setRevoking] = useState<ConsentRecord | null>(null);
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    void api.consents(playerId).then(items => { if (current) setRecords(items); })
      .catch(error => { if (current) onError(errorText(error)); });
    return () => { current = false; };
  }, [playerId, version, reload, onError]);

  async function revoke(record: ConsentRecord) {
    setBusy(true);
    try {
      await api.revokeConsent(record.rowId, clear);
      setRevoking(null);
      setReload(value => value + 1);
    } catch (error) {
      setRevoking(null);
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  if (!records) return null;
  return <>
    {records.length ? <ul className="consent-list">{records.map(record => <li key={record.rowId}
      className={record.revokedAt === null ? undefined : 'revoked'}>
      <div className="consent-heading"><strong>{consentLabels[record.kind]}</strong>
        <span>{record.revokedAt === null ? '确认于 ' + dateTime(record.grantedAt)
          : `${dateTime(record.grantedAt)} 确认 · ${dateTime(record.revokedAt)} 撤回`}</span>
        {record.revokedAt === null && <button className="link" onClick={() => { setClear(false); setRevoking(record); }}>撤回</button>}
      </div>
      <p>「{record.text}」</p>
    </li>)}</ul> : empty && <p className="muted consent-empty">{empty}</p>}
    {revoking && <Dialog title={`撤回${consentLabels[revoking.kind]}授权`} close={() => setRevoking(null)}>
      <p>{revokeEffect[revoking.kind]}</p>
      {revoking.kind !== 'discovery' && <label className="check"><input type="checkbox" checked={clear}
        onChange={event => setClear(event.target.checked)} />{clearLabel[revoking.kind]}</label>}
      <footer><button className="danger" disabled={busy} onClick={() => void revoke(revoking)}>确认撤回</button></footer>
    </Dialog>}
  </>;
}
