import type { Observation, Presence } from '../shared';
import type { Store } from './store';

function player(number: number, name: string, presence: Presence, gameId: string | null = null,
  gameName: string | null = null): Observation {
  return { id: String(76_561_197_960_265_728n + BigInt(number)), name, presence, gameId, gameName };
}

const lin = player(1, '小林', 'online');
const ze = player(2, '阿泽', 'online');
const zhou = player(3, '小周', 'away');
const chen = player(4, '小陈', 'offline');
const yu = player(5, '小雨', 'unknown');
const mo = player(6, 'Momo', 'online', '730', 'Counter-Strike 2');
const dota = { ...lin, gameId: '570', gameName: 'Dota 2' };
const portal = { ...zhou, presence: 'online' as const, gameId: '620', gameName: 'Portal 2' };
const frames = [
  [dota, ze, zhou, chen, yu, mo],
  [dota, { ...ze, gameId: '570', gameName: 'Dota 2' }, zhou, chen, yu, mo],
  [lin, ze, portal, chen, yu, mo],
  [lin, { ...ze, presence: 'offline' as const }, portal, chen, yu, mo],
];

function apply(store: Store, samples: Observation[], at: number, ids = samples.map(item => item.id)) {
  store.apply(ids, new Map(samples.map(item => [item.id, item])), at, '演示采集中断');
}

export class Demo {
  private step = 0;

  constructor(private readonly store: Store, now: number) {
    store.add(frames[0]);
    store.update(lin.id, '周末开黑', true, false, now);
    store.update(mo.id, 'FPS 小队', false, false, now);
    apply(store, [lin, { ...ze, presence: 'offline' }, zhou, chen, yu, mo], now - 4 * 60 * 60_000);
    apply(store, [dota], now - 3 * 60 * 60_000);
    apply(store, [{ ...lin, presence: 'away' }], now - 115 * 60_000);
    apply(store, [lin], now - 65 * 60_000);
    apply(store, [], now - 46 * 60_000, [lin.id]);
    apply(store, [lin], now - 35 * 60_000);
    apply(store, [ze, portal], now - 24 * 60_000);
    apply(store, [dota, zhou], now - 12 * 60_000);
    apply(store, [{ ...ze, gameId: '570', gameName: 'Dota 2' }], now - 8 * 60_000);
    apply(store, [ze], now - 3 * 60_000);
    apply(store, frames[0], now);
  }

  refresh(now: number) {
    this.step = (this.step + 1) % frames.length;
    apply(this.store, frames[this.step], now);
  }
}
