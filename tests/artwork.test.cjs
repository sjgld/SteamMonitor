const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { GameAssets } = require('../build/main/steam/artwork');

const id = '3548580';
const path = '/store_item_assets/steam/apps/' + id + '/' + 'a'.repeat(40) + '/header_schinese.jpg?t=1794038264';
const header = 'https://shared.fastly.steamstatic.com' + path;
const name = '放松时光：与你共享Lo-Fi故事';
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const metadata = (url, title = name) => Response.json({ [id]: { success: true, data: { header_image: url, name: title } } });

test('artwork falls back to the localized header and persists titles and images for offline reuse', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'steam-artwork-test-'));
  const db = join(dir, 'assets.sqlite');
  const requests = [];
  const catalog = new GameAssets(db, async (url, options) => {
    const address = new URL(url);
    requests.push(address.href);
    assert.equal(options.headers, undefined);
    if (address.hostname === 'store.steampowered.com') {
      assert.deepEqual([...address.searchParams], [['appids', id], ['filters', 'basic'], ['l', 'schinese']]);
      return metadata(header);
    }
    if (address.href === header) return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
    return new Response('', { status: 404 });
  });
  let offline;
  try {
    const [title, art, repeat] = await Promise.all([catalog.title(id), catalog.image(id), catalog.image(id)]);
    assert.equal(title, name);
    assert.deepEqual(new Uint8Array(art), jpeg);
    assert.equal(art, repeat);
    assert.equal(requests.length, 3);
    catalog.close();
    let networkCalls = 0;
    offline = new GameAssets(db, async () => { networkCalls++; throw new Error('offline'); });
    assert.equal(await offline.title(id), name);
    assert.deepEqual(await offline.image(id), jpeg);
    assert.deepEqual(offline.matchIds('放松时光'), [id]);
    assert.equal(await offline.title('76561197960265729'), null);
    assert.equal(networkCalls, 0);
  } finally {
    offline?.close();
    catalog.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('artwork does not follow untrusted headers or cache invalid JPEG responses', async () => {
  const requests = [];
  const catalog = new GameAssets(':memory:', async url => {
    requests.push(String(url));
    if (String(url).includes('api/appdetails')) return metadata('https://shared.fastly.steamstatic.com.example.com' + path);
    return new Response('<html>', { headers: { 'content-type': 'image/jpeg' } });
  });
  try {
    assert.equal(await catalog.image(id), null);
    assert.equal(await catalog.title(id), name);
    assert.equal(requests.length, 2);
  } finally { catalog.close(); }
});

test('square community icons are cached separately without overwriting legacy covers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'steam-icon-test-'));
  const file = join(dir, 'assets.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE game_assets (id TEXT PRIMARY KEY, name TEXT, header TEXT,
    checked INTEGER NOT NULL DEFAULT 0, image BLOB, touched INTEGER NOT NULL) STRICT`);
  old.prepare('INSERT INTO game_assets(id, image, touched) VALUES (?, ?, 1)').run(id, jpeg);
  old.close();
  const iconUrl = 'https://shared.akamai.steamstatic.com/community_assets/images/apps/' + id + '/' + 'b'.repeat(40) + '.jpg';
  const icon = Uint8Array.from([0xff, 0xd8, 0xff, 0x11, 0xd9]);
  const calls = [];
  const assets = new GameAssets(file, async url => {
    calls.push(String(url));
    if (String(url) === iconUrl) return new Response(icon, { headers: { 'content-type': 'image/jpeg' } });
    return new Response('<div class="apphub_AppIcon"><img src="' + iconUrl + '"></div>');
  });
  try {
    assert.deepEqual(new Uint8Array(await assets.image(id, 'icon')), icon);
    assert.deepEqual(await assets.image(id), jpeg);
    assert.deepEqual(await assets.image(id, 'icon'), icon);
    assert.deepEqual(calls, ['https://steamcommunity.com/app/' + id + '/', iconUrl]);
  } finally {
    assets.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
