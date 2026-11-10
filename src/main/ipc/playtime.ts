import type { MonitorHandlers } from '../../shared';
import { reviewPlaytime } from '../collect/playtime';
import type { Runtime } from '../runtime';
import { checkId } from './validate';

/** Public playtime samples: manual sampling, automatic watch and clearing. */
export function playtimeHandlers(rt: Runtime) {
  return {
    playtime: id => {
      checkId(id);
      return rt.currentStore().playtime(id)?.review ?? null;
    },
    samplePlaytime: async (id, approved) => {
      checkId(id);
      if (rt.mode === 'live') return rt.playtime.sample(id, approved);
      // Demo mode simulates six more minutes of Dota 2 on every sample.
      const friend = rt.demoStore.friends().find(item => item.id === id && !item.paused);
      if (!friend) throw new Error('该账号暂时不可采样。');
      const previous = rt.demoStore.playtime(id);
      const at = Math.max(Date.now(), (previous?.review.at ?? 0) + 1);
      const games = [{ appId: '570', name: 'Dota 2', minutes: (previous?.games[0]?.minutes ?? 34) + 6 }];
      const { sample, events } = reviewPlaytime(rt.demoStore, friend, previous, games, at);
      rt.demoStore.recordPlaytime(id, sample, events);
      rt.changed();
      return sample.review;
    },
    playtimeWatch: id => {
      checkId(id);
      return rt.mode === 'live' ? rt.playtime.status(id) : { enabled: false, checking: false, paused: false, nextAt: null, error: '', needsConsent: false };
    },
    setPlaytimeWatch: (id, enabled, approved) => {
      checkId(id);
      if (rt.mode !== 'live' || typeof enabled !== 'boolean') throw new Error('请切换到 Steam 数据后设置自动采样。');
      rt.playtime.configure(id, enabled, approved);
    },
    clearPlaytime: id => {
      checkId(id);
      if (rt.mode === 'live') rt.playtime.cancel(id);
      rt.currentStore().clearPlaytime(id);
      rt.changed();
    },
  } satisfies Partial<MonitorHandlers>;
}
