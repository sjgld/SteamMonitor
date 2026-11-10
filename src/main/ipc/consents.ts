import type { MonitorHandlers } from '../../shared';
import type { Runtime } from '../runtime';
import { checkId } from './validate';

/** The consent log: what the user confirmed, when, and withdrawing it. */
export function consentHandlers(rt: Runtime) {
  return {
    consents: playerId => {
      if (playerId !== null) checkId(playerId);
      return rt.mode === 'live' ? rt.live.consents(playerId) : [];
    },
    revokeConsent: (rowId, clear) => {
      if (!Number.isSafeInteger(rowId) || rowId < 1 || typeof clear !== 'boolean') throw new Error('无效请求。');
      if (rt.mode !== 'live') throw new Error('请切换到 Steam 数据后管理授权。');
      const record = rt.live.consent(rowId);
      if (!record || record.revokedAt !== null) throw new Error('这条授权已撤回或不存在。');
      const now = Date.now();
      const id = record.playerId;
      if (record.kind === 'discovery' || id === null) {
        rt.discovery.configure(rt.discovery.snapshot().owner, false);
        rt.live.revokeConsent('discovery', null, now);
      } else if (record.kind === 'track') {
        // Withdrawing stops recording: the account stays in the roster, paused, until confirmed again.
        const friend = rt.live.friends().find(item => item.id === id);
        rt.playtime.cancel(id);
        if (friend) rt.live.update(id, friend.note, friend.pinned, true, now);
        rt.live.revokeConsent('track', id, now);
        if (clear) rt.live.clearHistory(id, now);
      } else {
        rt.playtime.cancel(id);
        if (clear) rt.live.clearPlaytime(id, now);
        else rt.live.watchPlaytime(id, false, now);
        rt.live.revokeConsent('playtime', id, now);
      }
      rt.changed();
    },
  } satisfies Partial<MonitorHandlers>;
}
