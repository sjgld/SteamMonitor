import { DatabaseSync } from 'node:sqlite';
import { isGameAppId, officialGameMatches } from '../../shared';

const hosts = new Set(['shared.akamai.steamstatic.com', 'shared.fastly.steamstatic.com']);
const maxImageBytes = 384 * 1024;
const retryDelay = 2 * 60_000;
const metadataLifetime = 30 * 86_400_000;
const legacyImage = (id: string) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/capsule_231x87.jpg`;

type Metadata = { name: string | null; header: string | null };
type SavedMetadata = Metadata & { checked: number };

function safeHeader(value: unknown, appId: string): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || !hosts.has(url.host) || url.username || url.password || url.hash) return null;
  const prefix = `/store_item_assets/steam/apps/${appId}/`;
  if (!url.pathname.startsWith(prefix) || !/^(?:[a-f0-9]{40}\/)?header(?:_schinese)?\.jpg$/.test(url.pathname.slice(prefix.length))) return null;
  if (url.search && !/^\?t=\d{1,12}$/.test(url.search)) return null;
  return url.href;
}

export class GameAssets {
  private db?: DatabaseSync;
  private readonly metadataRequests = new Map<string, Promise<Metadata | null>>();
  private readonly imageRequests = new Map<string, Promise<Uint8Array | null>>();
  private readonly retryAt = new Map<string, number>();
  private readonly waiting: (() => void)[] = [];
  private activeRequests = 0;

  constructor(path: string, private readonly fetcher: typeof fetch = fetch) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path);
      db.exec(`CREATE TABLE IF NOT EXISTS game_assets (
        id TEXT PRIMARY KEY, name TEXT, header TEXT, checked INTEGER NOT NULL DEFAULT 0,
        image BLOB, icon BLOB, touched INTEGER NOT NULL
      ) STRICT`);
      if (!db.prepare('PRAGMA table_info(game_assets)').all().some(column => column.name === 'icon')) {
        db.exec('ALTER TABLE game_assets ADD COLUMN icon BLOB');
      }
      this.db = db;
    } catch {
      db?.close();
    }
  }

  close() {
    this.db?.close();
    this.db = undefined;
  }

  matchIds(query: string | undefined) {
    if (!query) return [];
    const names = officialGameMatches(query.toLowerCase());
    try {
      const cached = this.db?.prepare('SELECT id FROM game_assets WHERE instr(lower(name), lower(?)) > 0').all(query) ?? [];
      return [...new Set([...names, ...cached.map(row => String(row.id))])];
    } catch { return names; }
  }

  private prune() {
    this.db?.exec('DELETE FROM game_assets WHERE id IN (SELECT id FROM game_assets ORDER BY touched DESC, id LIMIT -1 OFFSET 256)');
  }

  private defer(key: string) {
    this.retryAt.delete(key);
    if (this.retryAt.size >= 256) this.retryAt.delete(this.retryAt.keys().next().value!);
    this.retryAt.set(key, Date.now() + retryDelay);
  }

  private async runRequest<T>(task: () => Promise<T>) {
    if (this.activeRequests < 6) this.activeRequests++;
    else await new Promise<void>(resolve => this.waiting.push(resolve));
    try { return await task(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.activeRequests--;
    }
  }

  private async fetchMetadata(id: string): Promise<Metadata | null> {
    const url = new URL('https://store.steampowered.com/api/appdetails');
    url.search = new URLSearchParams({ appids: id, filters: 'basic', l: 'schinese' }).toString();
    try {
      const response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return null;
      const result = await response.json() as Record<string, { success?: boolean; data?: { name?: unknown; header_image?: unknown } }>;
      const app = result?.[id];
      if (app?.success !== true) return null;
      const name = typeof app.data?.name === 'string' ? app.data.name.trim().slice(0, 160) || null : null;
      const header = safeHeader(app.data?.header_image, id);
      return name || header ? { name, header } : null;
    } catch { return null; }
  }

  private metadata(id: string): Promise<Metadata | null> {
    let saved: SavedMetadata | undefined;
    try {
      saved = this.db?.prepare('SELECT name, header, checked FROM game_assets WHERE id = ?').get(id) as SavedMetadata | undefined;
    } catch { /* An unavailable cache can still use the storefront. */ }
    const key = 'title:' + id;
    if (saved?.checked && (Date.now() - saved.checked < metadataLifetime || Date.now() < (this.retryAt.get(key) ?? 0))) {
      return Promise.resolve(saved);
    }
    if (Date.now() < (this.retryAt.get(key) ?? 0)) return Promise.resolve(null);
    const active = this.metadataRequests.get(id);
    if (active) return active;
    const request = this.runRequest(() => this.fetchMetadata(id)).then(value => {
      if (!value) {
        this.defer(key);
        return saved ?? null;
      }
      try {
        const now = Date.now();
        this.db?.prepare(`INSERT INTO game_assets(id, name, header, checked, touched) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = coalesce(excluded.name, name), header = coalesce(excluded.header, header),
          checked = excluded.checked, touched = excluded.touched`).run(id, value.name, value.header, now, now);
        this.prune();
      } catch { /* The current session can still use the downloaded metadata. */ }
      return { name: value.name ?? saved?.name ?? null, header: value.header ?? saved?.header ?? null };
    }).finally(() => this.metadataRequests.delete(id));
    this.metadataRequests.set(id, request);
    return request;
  }

  async title(id: unknown) {
    return isGameAppId(id) ? (await this.metadata(id))?.name ?? null : null;
  }

  private async downloadImage(url: string): Promise<Uint8Array | null> {
    try {
      const response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(7_000) });
      if (!response.ok || !/^image\/jpeg(?:$|;)/i.test(response.headers.get('content-type') ?? '') ||
          Number(response.headers.get('content-length')) > maxImageBytes || !response.body) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > maxImageBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(chunk.value);
      }
      const image = Buffer.concat(chunks, length);
      return image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff ? image : null;
    } catch { return null; }
  }

  private async communityIcon(id: string) {
    try {
      const page = await this.fetcher(`https://steamcommunity.com/app/${id}/`, {
        redirect: 'error', signal: AbortSignal.timeout(7_000),
      });
      if (!page.ok) return null;
      const html = await page.text();
      const source = /class="apphub_AppIcon"[^>]*>\s*<img\b[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1];
      if (!source) return null;
      const url = new URL(source);
      if (url.protocol !== 'https:' || !hosts.has(url.host) || url.username || url.password || url.search || url.hash) return null;
      const prefix = `/community_assets/images/apps/${id}/`;
      return url.pathname.startsWith(prefix) && /^[a-f0-9]{40}\.jpg$/.test(url.pathname.slice(prefix.length)) ? url.href : null;
    } catch { return null; }
  }

  image(id: unknown, kind: 'image' | 'icon' = 'image'): Promise<Uint8Array | null> {
    if (!isGameAppId(id)) return Promise.resolve(null);
    try {
      const saved = this.db?.prepare(`SELECT ${kind} AS image FROM game_assets WHERE id = ?`).get(id)?.image;
      if (saved instanceof Uint8Array) return Promise.resolve(saved);
    } catch { /* An unavailable cache can still use the Steam CDN. */ }
    const key = kind + ':' + id;
    if (Date.now() < (this.retryAt.get(key) ?? 0)) return Promise.resolve(null);
    const active = this.imageRequests.get(key);
    if (active) return active;
    const request = (async () => {
      const source = kind === 'icon' ? await this.runRequest(() => this.communityIcon(id)) : legacyImage(id);
      let image = source ? await this.runRequest(() => this.downloadImage(source)) : null;
      if (!image && kind === 'image') {
        const header = safeHeader((await this.metadata(id))?.header, id);
        if (header) image = await this.runRequest(() => this.downloadImage(header));
      }
      if (!image) {
        this.defer(key);
        return null;
      }
      try {
        this.db?.prepare(`INSERT INTO game_assets(id, ${kind}, touched) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET ${kind} = excluded.${kind}, touched = excluded.touched`).run(id, image, Date.now());
        this.prune();
      } catch { /* The current session can still display the downloaded image. */ }
      return image;
    })().finally(() => this.imageRequests.delete(key));
    this.imageRequests.set(key, request);
    return request;
  }
}
