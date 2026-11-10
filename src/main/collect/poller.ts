import type { Friend, Snapshot } from '../../shared';
import { SteamApi, SteamRequestError } from '../steam/api';
import type { Store } from '../data/store';

const interval = 60_000;
const maxRetry = 15 * 60_000;
export type PollState = Pick<Snapshot, 'status' | 'detail' | 'lastCheckedAt' | 'nextCheckAt'>;

export class Poller {
  private timer: NodeJS.Timeout | undefined;
  private request: AbortController | undefined;
  private running = false;
  private attempts = 0;
  private blockedUntil = 0;
  private lastPoll = 0;
  state: PollState = { status: 'idle', detail: '', lastCheckedAt: null, nextCheckAt: null };

  constructor(
    private readonly store: Store,
    private readonly api: () => SteamApi | null,
    private readonly changed: () => void,
    private readonly completed?: (before: Friend[], after: Friend[], now: number) => void,
  ) {}

  private update(state: Partial<PollState>) {
    this.state = { ...this.state, ...state };
    this.changed();
  }

  private schedule(delay: number) {
    this.timer = setTimeout(() => void this.refresh(), delay);
    this.update({ nextCheckAt: Date.now() + delay });
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.refresh();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.request?.abort();
    this.request = undefined;
    this.lastPoll = 0;
    this.state.nextCheckAt = null;
  }

  credentialsChanged() {
    this.stop();
    this.attempts = 0;
    this.blockedUntil = 0;
    this.state.lastCheckedAt = null;
  }

  async refresh() {
    if (!this.running || this.request || Date.now() < this.blockedUntil) {
      if (this.running && !this.request && Date.now() < this.blockedUntil) {
        clearTimeout(this.timer);
        this.schedule(this.blockedUntil - Date.now());
      }
      return;
    }
    clearTimeout(this.timer);
    const api = this.api();
    if (!api) {
      this.update({ status: 'needs-key', detail: '在设置中填写 Steam Web API Key。', nextCheckAt: null });
      return;
    }
    const ids = this.store.friends().filter(friend => !friend.paused).map(friend => friend.id);
    if (ids.length === 0) {
      this.update({ status: 'idle', detail: '添加好友或恢复记录后开始采集。', nextCheckAt: null });
      return;
    }
    const request = new AbortController();
    this.request = request;
    const now = Date.now();
    if (this.lastPoll && now - this.lastPoll > 2.5 * interval) {
      this.store.gap(now, '采集间隔过长', true);
    }
    const before = this.completed ? this.store.friends() : [];
    this.lastPoll = now;
    this.update({ status: 'checking', nextCheckAt: null });
    let received = 0;
    let offset = 0;
    try {
      for (; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const samples = await api.summaries(batch, request.signal);
        if (this.request !== request) return;
        this.store.apply(batch, samples, Date.now(), 'Steam 未返回该账号');
        received += samples.size;
      }
      this.attempts = 0;
      this.blockedUntil = 0;
      this.update({
        status: received === ids.length ? 'ok' : 'partial',
        detail: received === ids.length ? '' : `${ids.length - received} 位好友未返回数据。`,
        lastCheckedAt: Date.now(),
      });
      this.schedule(interval);
      this.completed?.(before, this.store.friends(), Date.now());
    } catch (error) {
      if (this.request !== request) return;
      const message = error instanceof SteamRequestError ? error.message : '采集或本地写入失败。';
      this.store.apply(ids.slice(offset), new Map(), Date.now(), message);
      const status = error instanceof SteamRequestError ? error.status : undefined;
      const retryAfter = error instanceof SteamRequestError ? error.retryAfter : 0;
      this.attempts += 1;
      const delay = Math.max(retryAfter, Math.min(interval * 2 ** Math.min(this.attempts, 4), maxRetry));
      this.blockedUntil = Date.now() + delay;
      this.update({ status: received ? 'partial' : 'error', detail: message, lastCheckedAt: Date.now() });
      if (status !== 401 && status !== 403) this.schedule(delay);
      else this.blockedUntil = 0;
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }
}
