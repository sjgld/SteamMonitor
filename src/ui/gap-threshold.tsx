import { useState } from 'react';
import { maxGapThreshold, validGapThreshold } from '../gap-display';
import type { GapBatch, GapRecord, GapTarget, Snapshot } from '../shared';
import { Dialog } from './components';
import { api, errorText } from './model';

const gapTime = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const gapRange = (gap: GapTarget) => gapTime.format(gap.at) + ' – ' + gapTime.format(gap.endedAt);

export function RemoveGapButton({ mode, playerId, record, onRemoved, onError }: {
  mode: Snapshot['mode']; playerId: string; record?: GapRecord;
  onRemoved: (records: GapTarget[]) => void; onError: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<GapBatch | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [error, setError] = useState('');
  if (!record || record.removed || record.endedAt === null) return null;
  const anchor = { playerId, rowId: record.rowId, at: record.at, endedAt: record.endedAt };

  async function preview(anchor: GapTarget) {
    setBusy(true);
    try {
      setSelected(new Set());
      setError('');
      setBatch(await api.previewGapBatch(mode, anchor));
    } catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  const candidates = batch ? [...batch.exact, ...batch.nearby.filter(item => selected.has(item.rowId))] : [];
  async function remove(scope: 'single' | 'batch') {
    if (!batch || busy) return;
    const targets = scope === 'single' ? [batch.anchor] : candidates;
    setBusy(true);
    setError('');
    try {
      await api.removeGapBatch(mode, batch.anchor, targets, scope);
      setBatch(null);
      onRemoved(targets);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="danger" disabled={busy} onClick={() => void preview(anchor)}>删除缺口…</button>
    {batch && <Dialog title="删除采集缺口" close={() => { if (!busy) setBatch(null); }}>
      <p><strong>{batch.anchor.name}</strong> · {gapRange(batch.anchor)}</p>
      <p className="muted">{batch.reason ?? '采集缺口'} · 中断时间仍从观测时长扣除。</p>
      {batch.exact.length > 1 && <details className="gap-batch-list">
        <summary>同期 {batch.exact.length} 条 · {new Set(batch.exact.map(item => item.playerId)).size} 位好友</summary>
        <ul>{batch.exact.map(item => <li key={item.rowId}>{item.name}{item.rowId === batch.anchor.rowId ? '（当前）' : ''}</li>)}</ul>
      </details>}
      {batch.nearby.length > 0 && <details className="gap-batch-list">
        <summary>时间相近 · {batch.nearby.length} 条可选</summary>
        <p className="muted">原因相同，开始和恢复时间各相差 10 秒以内。</p>
        <ul>{batch.nearby.map(item => <li key={item.rowId}><label className="check">
          <input type="checkbox" checked={selected.has(item.rowId)} disabled={busy} onChange={event => {
            const next = new Set(selected);
            if (event.target.checked) next.add(item.rowId);
            else next.delete(item.rowId);
            setSelected(next);
          }} /><span>{item.name}<small>{gapRange(item)}</small></span>
        </label></li>)}</ul>
      </details>}
      {error && <p className="message error" role="alert">{error}</p>}
      <footer className="gap-batch-actions">
        <button type="button" autoFocus disabled={busy} onClick={() => setBatch(null)}>取消</button>
        <button type="button" className="danger" disabled={busy} onClick={() => void remove('single')}>
          {candidates.length > 1 ? '仅删除这一条' : '删除这一条'}
        </button>
        {candidates.length > 1 && <button type="button" className="danger danger-filled" disabled={busy} onClick={() => void remove('batch')}>
          删除{selected.size ? '所选' : '同期'} {candidates.length} 条
        </button>}
      </footer>
    </Dialog>}
  </>;
}

export function GapThreshold({ minutes, preferred, onError }: {
  minutes: number; preferred: number; onError: (text: string) => void;
}) {
  return <GapThresholdInput key={minutes} minutes={minutes} preferred={preferred} onError={onError} />;
}

function GapThresholdInput({ minutes, preferred, onError }: { minutes: number; preferred: number; onError: (text: string) => void }) {
  const [draft, setDraft] = useState(String(minutes));
  const [saving, setSaving] = useState(false);
  const value = draft === '' ? NaN : Number(draft);
  async function apply(next: number) {
    if (saving || !validGapThreshold(next) || next === minutes) return;
    setSaving(true);
    try { await api.setGapThreshold(next); }
    catch (error) { onError(errorText(error)); }
    finally { setSaving(false); }
  }
  return <div className="gap-controls">
    <button type="button" disabled={saving} onClick={() => void apply(minutes === 0 ? preferred : 0)}>
      {minutes === 0 ? '隐藏短缺口' : '显示全部缺口'}
    </button>
    <details className="gap-settings">
      <summary>{minutes === 0 ? '缺口阈值' : `缺口阈值 · ${minutes} 分`}</summary>
      <form className="gap-threshold" onSubmit={event => { event.preventDefault(); void apply(value); }}>
        <label>
          <span>收起不超过</span>
          <input type="number" min={0} max={maxGapThreshold} step={1} value={draft} required
            aria-label="缺口阈值（分钟）" onChange={event => setDraft(event.target.value)} />
          <span>分钟的缺口</span>
        </label>
        <button disabled={saving || !validGapThreshold(value) || value === minutes}>应用</button>
      </form>
    </details>
  </div>;
}
