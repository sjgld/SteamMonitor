import type { DiscoverySnapshot, Player } from '../shared';
import { isSteamId, SteamRequestError, type SteamApi } from './steam';
import type { Store } from './store';

interface ListState {
  known: string[];
  pending: string[];
}

export function compareFriendList(previous: ListState, current: string[], tracked: Set<string>): ListState {
  const known = new Set(previous.known);
  const pending = new Set(previous.pending);
  const unique = [...new Set(current)];
  return { known: unique, pending: unique.filter(id => !tracked.has(id) && (pending.has(id) || !known.has(id))) };
}

interface DiscoveryState extends ListState {
  owner: string;
  enabled: boolean;
  checkedAt: number | null;
}

const empty: DiscoveryState = { owner: '', enabled: false, checkedAt: null, known: [], pending: [] };
const interval = 30 * 60_000;

export class Discovery {
  private state: DiscoveryState = empty;
  private attempt: object | null = null;
  private error = '';
  private attemptedAt = 0;
  private retryAt = 0;

  constructor(
    private readonly store: Store,
    private readonly api: () => SteamApi | null,
    private readonly changed: () => void,
  ) {
    const saved = store.preference('friendDiscovery');
    if (!saved) return;
    try {
      const state = JSON.parse(saved) as DiscoveryState;
      if (!isSteamId(state.owner) || typeof state.enabled !== 'boolean' ||
        (state.checkedAt !== null && !Number.isSafeInteger(state.checkedAt)) ||
        !Array.isArray(state.known) || !state.known.every(isSteamId) ||
        !Array.isArray(state.pending) || !state.pending.every(isSteamId)) return;
      this.state = state;
      this.attemptedAt = state.checkedAt ?? 0;
    } catch {
      // A missing or invalid local preference starts with discovery disabled.
    }
  }

  private save(state: DiscoveryState) {
    this.store.setPreference('friendDiscovery', JSON.stringify(state));
    this.state = state;
    this.changed();
  }

  snapshot(): DiscoverySnapshot {
    return {
      owner: this.state.owner, enabled: this.state.enabled, pending: this.state.pending.length,
      checkedAt: this.state.checkedAt, checking: Boolean(this.attempt), error: this.error,
    };
  }

  configure(owner: string, enabled: boolean) {
    this.invalidate();
    if (owner !== this.state.owner) this.attemptedAt = 0;
    this.save({ ...(owner === this.state.owner ? this.state : empty), owner, enabled });
  }

  invalidate() {
    this.attempt = null;
    this.error = '';
  }

  credentialsChanged() {
    this.invalidate();
    this.retryAt = 0;
    this.attemptedAt = 0;
  }

  async check(manual = false) {
    if (this.attempt || !this.state.owner ||
      (!manual && (!this.state.enabled || Date.now() - this.attemptedAt < interval))) return;
    if (Date.now() < this.retryAt) {
      if (manual) throw new Error('Steam 正在限流，请稍后再检查。');
      return;
    }
    const api = this.api();
    if (!api) {
      if (manual) throw new Error('请先启用 Steam 数据采集并保存 Web API Key。');
      return;
    }
    const attempt = {};
    this.attempt = attempt;
    this.attemptedAt = Date.now();
    this.error = '';
    this.changed();
    try {
      const ids = await api.friendIds(this.state.owner);
      if (attempt !== this.attempt) return;
      const tracked = new Set(this.store.friends().map(friend => friend.id));
      this.save({ ...this.state, ...compareFriendList(this.state, ids, tracked), checkedAt: Date.now() });
    } catch (error) {
      if (attempt === this.attempt) {
        this.error = error instanceof Error ? error.message : '好友名单检查失败。';
        if (error instanceof SteamRequestError && error.retryAfter > 0) this.retryAt = Date.now() + error.retryAfter;
      }
    } finally {
      if (attempt === this.attempt) {
        this.attempt = null;
        this.changed();
      }
    }
  }

  preview(): Player[] {
    return this.state.pending.map(id => ({ id, name: id }));
  }

  dismiss(ids?: string[]) {
    const accepted = new Set(ids ?? this.state.pending);
    const pending = this.state.pending.filter(id => !accepted.has(id));
    if (pending.length !== this.state.pending.length) this.save({ ...this.state, pending });
  }
}
