// Interface smoke test: starts the built app on a fresh profile and walks through it in demo mode.
// Run with `npm run test:ui` (builds first). Needs a display; on Linux CI wrap it in xvfb-run.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { _electron } = require('playwright-core');

const root = resolve(__dirname, '..', '..');

test('demo mode: first-run guide, banner, four pages and the friend timeline load without console errors', { timeout: 120_000 }, async () => {
  const profile = mkdtempSync(join(tmpdir(), 'steammonitor-smoke-'));
  // --no-sandbox: CI runners and containers cannot use Chromium's sandbox. A separate profile keeps the
  // test away from real data and from the single-instance lock of a running copy.
  const app = await _electron.launch({
    cwd: root, args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`], timeout: 60_000,
  });
  const problems = [];
  try {
    assert.equal(await app.evaluate(({ app: electron }) => electron.getPath('userData')), profile);
    const page = await app.firstWindow();
    page.on('console', message => { if (message.type() === 'error') problems.push('console: ' + message.text()); });
    page.on('pageerror', error => problems.push('uncaught: ' + error.message));
    page.setDefaultTimeout(15_000);
    const heading = name => page.getByRole('heading', { level: 1, name, exact: true });
    const open = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();

    // A new profile starts in demo mode with the setup guide open.
    const guide = page.getByRole('dialog', { name: '连接 Steam 数据' });
    await guide.waitFor();
    await guide.getByRole('button', { name: '连接 Steam' }).click();
    await guide.getByRole('textbox', { name: 'API Key' }).fill('not-a-key');
    await guide.getByRole('alert').filter({ hasText: 'Key' }).waitFor();
    assert.equal(await guide.getByRole('button', { name: '验证并保存' }).isDisabled(), true);
    assert.equal(await guide.getByRole('button', { name: '下一步' }).isDisabled(), true);
    await guide.getByRole('button', { name: '关闭弹窗' }).click();
    await guide.waitFor({ state: 'detached' });

    const banner = page.getByRole('status').filter({ hasText: '正在查看示例数据' });
    await banner.waitFor();
    await page.getByText('示例数据', { exact: true }).waitFor();

    await heading('好友').waitFor();
    const rows = page.locator('.friend-row');
    await rows.first().waitFor();
    assert.ok(await rows.count() >= 3, 'demo roster is listed');

    await open('活动');
    await heading('活动').waitFor();
    await open('回顾');
    await heading('回顾').waitFor();
    await open('设置');
    await heading('设置').waitFor();

    await open('好友');
    await rows.first().click();
    const detail = page.getByRole('complementary', { name: '好友详情' });
    const name = (await detail.locator('.detail-name h2').textContent()).trim();
    await detail.getByRole('button', { name: '横向时间轴' }).click();
    await heading(name).waitFor();
    await page.getByRole('region', { name: /好友时间轴/ }).waitFor();

    // The banner reopens the guide; dismissing the banner hides it for this run.
    await banner.getByRole('button', { name: '连接 Steam 数据' }).click();
    await guide.waitFor();
    await guide.getByRole('button', { name: '继续看示例' }).click();
    await guide.waitFor({ state: 'detached' });
    await banner.getByRole('button', { name: '关闭横幅' }).click();
    await banner.waitFor({ state: 'detached' });
    await open('活动');
    await heading('活动').waitFor();
    assert.equal(await banner.count(), 0);

    // Let late requests (reports, artwork) settle so their errors would be seen.
    await page.waitForTimeout(1_000);
    assert.deepEqual(problems, []);
  } finally {
    await app.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
