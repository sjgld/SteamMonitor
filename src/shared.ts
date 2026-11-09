export type Presence = 'online' | 'away' | 'busy' | 'offline' | 'unknown';

export function isGameAppId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,7}$/.test(value) && Number(value) <= 0xffffff;
}

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
}

export interface MonitorApi {
  snapshot(): Promise<Snapshot>;
  uiReady(): Promise<void>;
  installUiUpdate(): Promise<boolean>;
  onChange(callback: () => void): () => void;
  setMode(mode: Snapshot['mode']): Promise<void>;
  setKey(key: string): Promise<void>;
  refresh(): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  setGapThreshold(minutes: number): Promise<void>;
  previewPlayer(input: string): Promise<Player>;
  previewFriends(input: string): Promise<Player[]>;
  addPlayers(ids: string[]): Promise<void>;
  updateFriend(id: string, edit: { note: string; pinned: boolean; paused: boolean }): Promise<void>;
  removeFriend(id: string): Promise<void>;
  activity(filter: ActivityFilter): Promise<Activity[]>;
  activityBoard(filter: ActivityFilter & ActivityWindow): Promise<ActivityBoard>;
  exportActivity(filter: ActivityFilter): Promise<boolean>;
  gameTitle(appId: string): Promise<string | null>;
  openSteam(kind: 'profile' | 'game', id: string): Promise<void>;
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
  configureDiscovery(owner: string, enabled: boolean): Promise<void>;
  checkDiscovery(): Promise<void>;
  previewDiscovery(): Promise<Player[]>;
  dismissDiscovery(): Promise<void>;
}

export const presenceLabels: Record<Presence, string> = {
  online: '在线',
  away: '离开',
  busy: '忙碌',
  offline: '显示离线',
  unknown: '状态未知',
};
