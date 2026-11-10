import { consentText, type Friend, type PlaytimeEvent, type PlaytimeReview, type PlaytimeWatch } from '../../shared';
import { comparePlaytime, spansFor } from '../data/analytics';
import { SteamRequestError, type OwnedGame, type SteamApi } from '../steam/api';
import type { SavedPlaytime, Store } from '../data/store';

export const playtimeInterval = 30 * 60_000;
const lateWindow = 45 * 60_000;
const missingWindow = 150_000;
const manualInterval = 10 * 60_000;

export function reviewPlaytime(store: Store, friend: Friend, previous: SavedPlaytime | null, games: OwnedGame[], at: number) {
  if (!previous || previous.review.at >= at) {
    return { sample: comparePlaytime(null, games, new Set(), at), events: [] };
  }
  const since = previous.review.at;
  const start = Math.min(since, at - lateWindow);
  const history = store.historyRange(start, at + 1, friend.id);
  const inWindow = spansFor(history, friend, since, at);
  const visible = new Set([
    ...inWindow.map(span => span.gameId),
    ...history.filter(row => row.at >= since).map(row => row.gameId),
  ]);
  const recent = new Set(spansFor(history, friend, start, since)
    .filter(span => span.gameId && at - span.end <= lateWindow).map(span => span.gameId));
  const gap = inWindow.some(span => span.state === 'gap' || (span.state === 'empty' && span.end - span.start > missingWindow));
  const sample = comparePlaytime(previous, games, new Set([...visible].filter((id): id is string => id !== null)), at);
  const events: Omit<PlaytimeEvent, 'rowId'>[] = sample.review.changes.map(game => ({
    appId: game.appId, name: game.name, minutes: game.minutes, from: since, at,
    match: game.seen ? 'observed' : recent.has(game.appId) ? 'recent' : 'unmatched',
    gap,
  }));
  return { sample, events };
}

export class PlaytimeSampler {
  private readonly pending = new Map<string, AbortController>();
  private ticking = false;
  private backoffUntil = 0;

  constructor(
    private readonly store: Store,
    private readonly api: () => SteamApi | null,
    private readonly automaticAllowed: () => boolean,
    private readonly changed: () => void,
    private readonly now = Date.now,
  ) {}

  status(id: string): PlaytimeWatch {
    const row = this.store.watch(id);
    return { enabled: Boolean(row), checking: this.pending.has(id),
      paused: !this.automaticAllowed() || Boolean(this.store.friends().find(friend => friend.id === id)?.paused),
      nextAt: row?.nextAt ?? null, error: row?.error ?? '', needsConsent: this.store.consentWithdrawn('playtime', id) };
  }

  cancel(id?: string) {
    if (id) this.pending.get(id)?.abort();
    else for (const controller of this.pending.values()) controller.abort();
  }

  credentialsChanged() {
    this.cancel();
    this.backoffUntil = 0;
  }

  configure(id: string, enabled: boolean, approved: boolean) {
    const friend = this.store.friends().find(item => item.id === id);
    if (!friend) throw new Error('该账号不在记录名单中。');
    const existing = this.store.watch(id);
    if (Boolean(existing) === enabled) return;
    if (enabled && (approved !== true || !this.api())) {
      throw new Error('请确认时长采样授权并保存有效的 Steam API Key。');
    }
    this.cancel(id);
    if (enabled) this.store.grantConsent('playtime', id, consentText.playtime, this.now());
    this.store.watchPlaytime(id, enabled, this.now());
    this.changed();
    if (enabled) void this.tick();
  }

  async sample(id: string, approved: boolean, automatic = false): Promise<PlaytimeReview> {
    const api = this.api();
    const friend = this.store.friends().find(item => item.id === id);
    if (!api || !friend || friend.paused) throw new Error('该账号暂时不可采样。');
    const watch = this.store.watch(id);
    if (automatic && (!watch || !this.automaticAllowed())) throw new Error('自动采样已暂停。');
    if (this.pending.has(id)) throw new Error('正在采样，请稍候。');
    const now = this.now();
    if (now < this.backoffUntil) throw new Error('Steam 正在限流，请稍后再试。');
    const saved = this.store.playtime(id);
    const previous = watch && saved && saved.review.at < watch.enabledAt ? null : saved;
    const withdrawn = !automatic && this.store.consentWithdrawn('playtime', id);
    if (((!previous && !watch) || withdrawn) && approved !== true) throw new Error('请先确认该账号已授权保存公开时长。');
    if (!automatic && previous && now - previous.review.at < manualInterval) {
      throw new Error('同一账号的公开时长采样至少间隔 10 分钟。');
    }

    if (!automatic && approved === true) this.store.grantConsent('playtime', id, consentText.playtime, now);
    const controller = new AbortController();
    this.pending.set(id, controller);
    this.changed();
    try {
      const games = await api.ownedGames(id, controller.signal);
      if (controller.signal.aborted || (automatic && !this.automaticAllowed())) throw new Error('时长采样已取消。');
      const latest = this.store.friends().find(item => item.id === id && !item.paused);
      if (!latest) throw new Error('时长采样已取消。');
      const at = this.now();
      const { sample, events } = reviewPlaytime(this.store, latest, previous, games, at);
      this.store.recordPlaytime(id, sample, events);
      if (watch) this.store.scheduleWatch(id, at + playtimeInterval);
      return sample.review;
    } catch (error) {
      if (!controller.signal.aborted) {
        const retry = error instanceof SteamRequestError ? error.retryAfter : 0;
        if (retry > 0) this.backoffUntil = this.now() + retry;
        if (watch) {
          this.store.scheduleWatch(id, this.now() + Math.max(playtimeInterval, retry),
            error instanceof Error ? error.message : '时长采样失败。');
        }
      }
      throw error;
    } finally {
      this.pending.delete(id);
      this.changed();
    }
  }

  async tick() {
    if (this.ticking || !this.automaticAllowed() || this.now() < this.backoffUntil) return;
    this.ticking = true;
    try {
      for (const id of this.store.dueWatches(this.now())) {
        if (!this.automaticAllowed() || this.now() < this.backoffUntil) break;
        if (this.pending.has(id) || !this.store.watch(id)) continue;
        try { await this.sample(id, false, true); }
        catch { /* Each account records its own retry state. */ }
      }
    } finally {
      this.ticking = false;
    }
  }
}
