import type { Observation, Presence } from '../../shared';

const host = 'https://api.steampowered.com';
const steamIdPattern = /^\d{17}$/;

export function isSteamId(value: unknown): value is string {
  return typeof value === 'string' && steamIdPattern.test(value);
}

export function parseProfile(input: string): { id: string } | { vanity: string } {
  const value = input.trim();
  if (steamIdPattern.test(value)) return { id: value };

  let url: URL;
  try {
    url = new URL(value.startsWith('steamcommunity.com/') ? 'https://' + value : value);
  } catch {
    throw new Error('请输入 SteamID64 或 Steam 社区个人资料链接。');
  }
  const match = /^\/(id|profiles)\/([a-z0-9_-]{1,128})\/?$/.exec(url.pathname);
  if (url.hostname !== 'steamcommunity.com' || !['https:', 'http:'].includes(url.protocol) || !match) {
    throw new Error('请输入 Steam 社区个人资料链接。');
  }
  if (match[1] === 'profiles' && isSteamId(match[2])) return { id: match[2] };
  if (match[1] === 'id') return { vanity: match[2] };
  throw new Error('个人资料链接中的 SteamID64 无效。');
}

type SteamSummary = {
  steamid?: unknown;
  personaname?: unknown;
  personastate?: unknown;
  avatar?: unknown;
  avatarmedium?: unknown;
  avatarfull?: unknown;
  communityvisibilitystate?: unknown;
  gameid?: unknown;
  gameextrainfo?: unknown;
};

export function safeAvatar(value: unknown) {
  if (typeof value !== 'string' || value.length > 240) return null;
  return /^https:\/\/(?:avatars\.(?:akamai\.|cloudflare\.)?steamstatic\.com\/|steamcdn-a\.akamaihd\.net\/steamcommunity\/public\/images\/avatars\/)(?:[a-f0-9]{2}\/)?[a-f0-9]{40}(?:_medium|_full)?\.jpg$/i.test(value)
    ? value : null;
}

export interface OwnedGame {
  appId: string;
  name: string;
  minutes: number;
}

const presenceByState: Record<number, Presence> = {
  0: 'offline', 1: 'online', 2: 'busy', 3: 'away', 4: 'away', 5: 'online', 6: 'online',
};

export function normalizeSummary(raw: SteamSummary): Observation | null {
  if (!isSteamId(raw.steamid)) return null;
  const presence = typeof raw.personastate === 'number' ? presenceByState[raw.personastate] : undefined;
  // A restricted profile can be returned with a zero persona state.
  const hiddenOffline = presence === 'offline' && raw.communityvisibilitystate !== 3;
  const gameId = typeof raw.gameid === 'string' && /^[1-9]\d{0,19}$/.test(raw.gameid) ? raw.gameid : null;
  const gameName = typeof raw.gameextrainfo === 'string' ? raw.gameextrainfo.trim().slice(0, 160) || null : null;
  return {
    id: raw.steamid,
    name: typeof raw.personaname === 'string' ? raw.personaname.trim().slice(0, 120) || raw.steamid : raw.steamid,
    avatar: safeAvatar(raw.avatarfull) ?? safeAvatar(raw.avatarmedium) ?? safeAvatar(raw.avatar),
    presence: hiddenOffline ? 'unknown' : presence ?? 'unknown',
    gameId,
    gameName,
  };
}

export class SteamRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfter = 0) {
    super(message);
  }
}

/** Valve's documented sample account; any valid SteamID64 works for probing a key. */
const probeId = '76561197960435530';

/**
 * Tries a key with one GetPlayerSummaries call. Steam answers 403 for a key it does not accept, so the
 * call resolves only for a working key and otherwise rejects with the reason to show the user.
 */
export async function verifyKey(api: SteamApi) {
  await api.summaries([probeId]);
}

export class SteamApi {
  constructor(
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async get<T>(method: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const url = new URL(method, host);
    url.search = new URLSearchParams(params).toString();
    const timeout = AbortSignal.timeout(15_000);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { 'x-webapi-key': this.key },
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      throw new SteamRequestError('无法连接 Steam，或请求超时。');
    }
    if (!response.ok) {
      if (response.status === 429) {
        const header = response.headers.get('Retry-After');
        const seconds = Number(header);
        const retryAfter = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header ?? '') - Date.now();
        throw new SteamRequestError('Steam 请求限流，稍后重试。', 429, Math.max(60_000, retryAfter || 0));
      }
      if (response.status === 401 || response.status === 403) {
        const message = method.includes('GetFriendList')
          ? '好友名单不可读取。请检查名单的公开范围和 API Key。'
          : 'Steam 拒绝了请求，请检查 API Key。';
        throw new SteamRequestError(message, response.status);
      }
      throw new SteamRequestError(`Steam 请求失败（HTTP ${response.status}）。`, response.status);
    }
    try {
      return await response.json() as T;
    } catch {
      throw new SteamRequestError('Steam 返回了无法读取的数据。');
    }
  }

  async resolve(input: string): Promise<string> {
    const parsed = parseProfile(input);
    if ('id' in parsed) return parsed.id;
    const { response } = await this.get<{ response?: { success?: number; steamid?: string } }>(
      '/ISteamUser/ResolveVanityURL/v1/', { vanityurl: parsed.vanity },
    );
    if (response?.success !== 1 || !isSteamId(response.steamid)) {
      throw new Error('Steam 未找到该个人资料。');
    }
    return response.steamid;
  }

  async summaries(ids: string[], signal?: AbortSignal): Promise<Map<string, Observation>> {
    if (ids.length < 1 || ids.length > 100) throw new Error('每批只能查询 1 至 100 个账号。');
    const { response } = await this.get<{ response?: { players?: SteamSummary[] } }>(
      '/ISteamUser/GetPlayerSummaries/v2/', { steamids: ids.join(',') }, signal,
    );
    if (!Array.isArray(response?.players)) throw new SteamRequestError('Steam 未返回账号列表。');
    const requested = new Set(ids);
    const result = new Map<string, Observation>();
    for (const raw of response.players) {
      const player = raw && normalizeSummary(raw);
      if (player && requested.has(player.id)) result.set(player.id, player);
    }
    return result;
  }

  async friendIds(id: string): Promise<string[]> {
    const { friendslist } = await this.get<{ friendslist?: { friends?: { steamid?: string }[] } }>(
      '/ISteamUser/GetFriendList/v1/', { steamid: id, relationship: 'friend' },
    );
    if (!Array.isArray(friendslist?.friends)) throw new SteamRequestError('Steam 未返回可读取的好友名单。');
    return [...new Set(friendslist.friends.map(friend => friend.steamid).filter(isSteamId))];
  }

  async ownedGames(id: string, signal?: AbortSignal): Promise<OwnedGame[]> {
    const { response } = await this.get<{ response?: { game_count?: number; games?: unknown[] } }>(
      '/IPlayerService/GetOwnedGames/v1/', { steamid: id, include_appinfo: '1', include_played_free_games: '1' }, signal,
    );
    if (response?.game_count === 0 && !response.games?.length) return [];
    if (!Array.isArray(response?.games)) {
      throw new Error('Steam 未公开该账号的游戏时长。');
    }
    return response.games.flatMap(game => {
      if (!game || typeof game !== 'object') return [];
      const { appid, name, playtime_forever } = game as Record<string, unknown>;
      if (typeof appid !== 'number' || !Number.isSafeInteger(appid) || appid < 1 ||
        typeof playtime_forever !== 'number' || !Number.isSafeInteger(playtime_forever) || playtime_forever < 0) return [];
      return [{ appId: String(appid), name: typeof name === 'string' ? name.slice(0, 160) : '游戏 #' + appid,
        minutes: playtime_forever }];
    });
  }
}
