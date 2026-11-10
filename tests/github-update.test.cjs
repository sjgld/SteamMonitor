const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { checkGitHubRelease } = require('../build/main/update/github-update');
const { savedUiUpdate, stageVerifiedUi } = require('../build/main/update/ui-update');

const hash = value => createHash('sha256').update(value).digest('hex');
const backend = hash('backend');
const version = '0.7.5';
const api = 'https://api.github.com/repos/sjgld/SteamMonitor';

function fixture() {
  const html = '<!doctype html><title>SteamMonitor</title>';
  const bytes = Buffer.from(JSON.stringify({
    manifest: { version, backend, files: { 'index.html': hash(html) } },
    contents: { 'index.html': Buffer.from(html).toString('base64') },
  }));
  const asset = { name: 'SteamMonitor-ui.json', id: 123, state: 'uploaded', size: bytes.length, digest: 'sha256:' + hash(bytes) };
  return { bytes, asset };
}

test('a private release downloads the interface over a credential-free asset redirect and stages it', async () => {
  const { bytes, asset } = fixture();
  const cdn = 'https://release-assets.githubusercontent.com/fixture';
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url === api + '/releases/latest') {
      assert.equal(options.headers.Authorization, 'Bearer token');
      return Response.json({ tag_name: 'v' + version, assets: [asset] });
    }
    if (url === api + '/releases/assets/123') {
      assert.equal(options.headers.Accept, 'application/octet-stream');
      return new Response(null, { status: 302, headers: { location: cdn } });
    }
    assert.equal(url, cdn);
    assert.equal(options.headers, undefined);
    return new Response(bytes);
  };
  const release = await checkGitHubRelease('token', '0.7.4', backend, fetcher);
  assert.deepEqual(release.result, { kind: 'interface', version });
  const root = await mkdtemp(join(tmpdir(), 'steammonitor-release-'));
  try {
    const stage = await stageVerifiedUi(release.bundle, root, '0.7.4', backend);
    assert.deepEqual(await savedUiUpdate(root, stage.folder, '0.7.4', backend), stage);
    await assert.rejects(stageVerifiedUi(release.bundle, root, version, backend), /比当前界面更新/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('older releases stay current, different collectors require the complete release, and corrupt assets fail', async () => {
  const { bytes, asset } = fixture();
  let download = bytes;
  let requests = 0;
  const fetcher = async url => {
    requests++;
    return url === api + '/releases/latest'
      ? Response.json({ tag_name: 'v' + version, assets: [asset] })
      : new Response(download);
  };
  assert.deepEqual((await checkGitHubRelease('token', '0.7.10', backend, fetcher)).result, { kind: 'current', version: '0.7.10' });
  assert.equal(requests, 1);
  assert.deepEqual(await checkGitHubRelease('token', '0.7.4', hash('old backend'), fetcher), { result: { kind: 'full', version } });
  download = Buffer.from(bytes).fill(0);
  await assert.rejects(checkGitHubRelease('token', '0.7.4', backend, fetcher), /界面包校验失败/);
});

test('missing releases are distinct from missing access to a private repository', async () => {
  const fetcher = status => async url => new Response(null, { status: url === api ? status : 404 });
  assert.deepEqual(await checkGitHubRelease('token', '0.7.4', backend, fetcher(200)), { result: { kind: 'unpublished' } });
  await assert.rejects(checkGitHubRelease('token', '0.7.4', backend, fetcher(404)), /无法读取 SteamMonitor 私有仓库/);
});

test('backend fingerprint covers nested backend folders but ignores the interface bundle', () => {
  const { backendFingerprint } = require('../build/main/update/ui-update');
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
  const build = mkdtempSync(join(tmpdir(), 'steam-monitor-build-'));
  try {
    for (const folder of ['main/ipc', 'shared', 'ui/assets']) mkdirSync(join(build, folder), { recursive: true });
    writeFileSync(join(build, 'main', 'index.js'), 'main');
    writeFileSync(join(build, 'main', 'ipc', 'register.js'), 'ipc');
    writeFileSync(join(build, 'shared', 'types.js'), 'types');
    writeFileSync(join(build, 'ui', 'assets', 'index.js'), 'ui');
    const original = backendFingerprint(build, '45.0.0');
    writeFileSync(join(build, 'ui', 'assets', 'index.js'), 'ui changed');
    assert.equal(backendFingerprint(build, '45.0.0'), original);
    writeFileSync(join(build, 'main', 'ipc', 'register.js'), 'ipc changed');
    const nested = backendFingerprint(build, '45.0.0');
    assert.notEqual(nested, original);
    writeFileSync(join(build, 'shared', 'types.js'), 'types changed');
    assert.notEqual(backendFingerprint(build, '45.0.0'), nested);
    assert.notEqual(backendFingerprint(build, '46.0.0'), backendFingerprint(build, '45.0.0'));
  } finally {
    rmSync(build, { recursive: true, force: true });
  }
});
