// Types shared by the main process, the preload bridge and the renderer.
// Keep this file free of runtime code: the sandboxed preload may only import types from it.

export type Presence = 'online' | 'away' | 'busy' | 'offline' | 'unknown';

export interface Player {
  id: string;
  name: string;
  avatar?: string | null;
}

export interface Observation extends Player {
  presence: Presence;
  gameId: string | null;
  gameName: string | null;
}

export interface Friend extends Observation {
  note: string;
  pinned: boolean;
  paused: boolean;
  observedAt: number | null;
  gapSince: number | null;
}

export interface Activity {
  rowId: number;
  playerId: string;
  name: string;
  kind: 'baseline' | 'change' | 'gap';
  at: number;
  endedAt: number | null;
  reason: string | null;
  presence: Presence | null;
  previousPresence: Presence | null;
  gameId: string | null;
  gameName: string | null;
  previousGameId: string | null;
  previousGameName: string | null;
  gapRemoved?: boolean;
}

export interface GapRecord {
  rowId: number;
  at: number;
  endedAt: number | null;
  removed?: boolean;
}

export interface GapTarget {
  rowId: number;
  playerId: string;
  at: number;
  endedAt: number;
}

export interface GapCandidate extends GapTarget {
  name: string;
}

export interface GapBatch {
  anchor: GapCandidate;
  reason: string | null;
  exact: GapCandidate[];
  nearby: GapCandidate[];
}

export interface ActivityFilter {
  playerId?: string;
  from?: number;
  until?: number;
  game?: string;
}

export interface ActivityWindow {
  from: number;
  until: number;
}

export interface ActivityBoard {
  tracks: { playerId: string; spans: (Span & { sourceId?: number })[] }[];
  events: Activity[];
  playtime: (PlaytimeEvent & { playerId: string })[];
  unchangedRecoveries: Record<number, { duration: number; removed?: boolean }>;
}

export interface Snapshot {
  mode: 'demo' | 'live';
  collectorVersion: string;
  uiVersion: string;
  uiUpdateResult: { text: string; error: boolean } | null;
  hasKey: boolean;
  /** Nothing is configured yet and the setup guide has not been shown. */
  firstRun: boolean;
  paused: boolean;
  status: 'demo' | 'needs-key' | 'idle' | 'checking' | 'ok' | 'partial' | 'error' | 'paused';
  detail: string;
  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  nextCheckAt: number | null;
  friends: Friend[];
  favoriteGames: string[];
  gapThresholdMinutes: number;
  preferredGapThresholdMinutes: number;
  discovery: DiscoverySnapshot;
}

export interface DiscoverySnapshot {
  owner: string;
  enabled: boolean;
  pending: number;
  checkedAt: number | null;
  checking: boolean;
  error: string;
}

export type RangeDays = 0.25 | 1 | 7 | 30;
export interface Span {
  start: number;
  end: number;
  state: Presence | 'gap' | 'empty';
  gameId: string | null;
  gameName: string | null;
  gapDuration?: number;
  gapRecord?: GapRecord;
}

export interface GameTotals {
  id: string;
  name: string;
  minutes: number;
  sharedMinutes: number;
}

export interface GameSession {
  playerId: string;
  playerName: string;
  gameId: string | null;
  gameName: string;
  start: number;
  end: number;
  observedMs: number;
}

export interface Report {
  start: number;
  end: number;
  spans: Span[];
  coverage: number;
  games: GameTotals[];
  shared: { game: string; start: number; end: number; names: string[] }[];
  playtimeEvents?: PlaytimeEvent[];
  sessions?: GameSession[];
}

export interface NoticeOptions {
  online: boolean;
  game: boolean;
  party: boolean;
  friendId: string;
  gameFilter: string;
  partySize: number;
  quietStart: string;
  quietEnd: string;
  cooldown: number;
}

export interface Preferences {
  retentionDays: number;
  autoStart: boolean;
  notices: NoticeOptions;
}

export interface PlaytimeDelta {
  appId: string;
  name: string;
  minutes: number;
  seen: boolean;
}

export interface PlaytimeReview {
  at: number;
  since: number | null;
  changes: PlaytimeDelta[];
}

export interface PlaytimeEvent {
  rowId: number;
  appId: string;
  name: string;
  minutes: number;
  from: number;
  at: number;
  match: 'observed' | 'recent' | 'unmatched';
  gap: boolean;
}

export interface PlaytimeWatch {
  enabled: boolean;
  checking: boolean;
  paused: boolean;
  nextAt: number | null;
  error: string;
  /** The playtime consent was withdrawn; the next sample needs a new confirmation. */
  needsConsent: boolean;
}

export type ConsentKind = 'track' | 'playtime' | 'discovery';

/** One confirmation the user ticked. `playerId` is null for friend discovery (the user's own account). */
export interface ConsentRecord {
  rowId: number;
  kind: ConsentKind;
  playerId: string | null;
  text: string;
  grantedAt: number;
  revokedAt: number | null;
}

export type ReleaseCheck =
  | { kind: 'unpublished' }
  | { kind: 'current' | 'interface' | 'full'; version: string };

export interface MonitorApi {
  snapshot(): Promise<Snapshot>;
  uiReady(): Promise<void>;
  installUiUpdate(): Promise<boolean>;
  checkRelease(): Promise<ReleaseCheck>;
  applyReleaseUi(): Promise<void>;
  openRelease(): Promise<void>;
  onChange(callback: () => void): () => void;
  setMode(mode: Snapshot['mode']): Promise<void>;
  setKey(key: string): Promise<void>;
  /**
   * Tries a key against Steam (an empty string tries the saved one). Only a working key is saved, and
   * the data source then switches to Steam. Rejects with the reason otherwise.
   */
  connectSteam(key: string): Promise<void>;
  /** Records that the setup guide was shown, so it no longer opens by itself. */
  finishOnboarding(): Promise<void>;
  refresh(): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  setGapThreshold(minutes: number): Promise<void>;
  previewPlayer(input: string): Promise<Player>;
  previewFriends(input: string): Promise<Player[]>;
  /** `approved` is the ticked consent statement; it is logged for every added account. */
  addPlayers(ids: string[], approved: boolean): Promise<void>;
  /** Resuming an account whose consent was withdrawn requires `approved`. */
  updateFriend(id: string, edit: { note: string; pinned: boolean; paused: boolean }, approved?: boolean): Promise<void>;
  removeFriend(id: string): Promise<void>;
  activity(filter: ActivityFilter): Promise<Activity[]>;
  activityBoard(filter: ActivityFilter & ActivityWindow): Promise<ActivityBoard>;
  exportActivity(filter: ActivityFilter): Promise<boolean>;
  gameTitle(appId: string): Promise<string | null>;
  openSteam(kind: 'profile' | 'game' | 'key', id: string): Promise<void>;
  report(id: string | null, days: RangeDays, calendarDay?: string, fixed?: ActivityWindow): Promise<Report>;
  favoriteGame(game: string, enabled: boolean): Promise<void>;
  preferences(): Promise<Preferences>;
  savePreferences(preferences: Preferences): Promise<void>;
  testNotice(): Promise<void>;
  backup(): Promise<boolean>;
  restore(): Promise<boolean>;
  clearHistory(id?: string): Promise<boolean>;
  previewGapBatch(mode: Snapshot['mode'], anchor: GapTarget): Promise<GapBatch>;
  removeGapBatch(mode: Snapshot['mode'], anchor: GapTarget, targets: GapTarget[], scope: 'single' | 'batch'): Promise<number>;
  playtime(id: string): Promise<PlaytimeReview | null>;
  samplePlaytime(id: string, approved: boolean): Promise<PlaytimeReview>;
  clearPlaytime(id: string): Promise<void>;
  playtimeWatch(id: string): Promise<PlaytimeWatch>;
  setPlaytimeWatch(id: string, enabled: boolean, approved: boolean): Promise<void>;
  configureDiscovery(owner: string, enabled: boolean, approved: boolean): Promise<void>;
  checkDiscovery(): Promise<void>;
  previewDiscovery(): Promise<Player[]>;
  dismissDiscovery(): Promise<void>;
  /** Consent log of a friend, or of friend discovery when `playerId` is null. Newest first. */
  consents(playerId: string | null): Promise<ConsentRecord[]>;
  /** Withdraws a consent and stops what it allowed; `clear` also deletes the data it covered. */
  revokeConsent(rowId: number, clear: boolean): Promise<void>;
}

/** Every request/response method of the bridge. `onChange` is the only push channel. */
export type MonitorMethod = Exclude<keyof MonitorApi, 'onChange'>;

/**
 * Main-process implementation of the bridge. Handlers may answer synchronously; arguments come from the
 * renderer and must still be validated at runtime.
 */
export type MonitorHandlers = {
  [K in MonitorMethod]: (...args: Parameters<MonitorApi[K]>) => ReturnType<MonitorApi[K]> | Awaited<ReturnType<MonitorApi[K]>>;
};
