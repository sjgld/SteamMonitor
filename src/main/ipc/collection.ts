import type { MonitorHandlers } from '../../shared';
import { consentText, isApiKey, validGapThreshold } from '../../shared';
import type { Runtime } from '../runtime';
import { SteamApi, verifyKey } from '../steam/api';

/** Data source, API key, pause, refresh, gap threshold and friend discovery. */
export function collectionHandlers(rt: Runtime) {
  return {
    snapshot: () => rt.snapshot(),
    setMode: value => {
      if (value !== 'demo' && value !== 'live') throw new Error('无效模式。');
      rt.setMode(value);
    },
    setKey: async input => {
      const value = await rt.vault.write(input);
      if (rt.quitting()) return;
      rt.adoptKey(value);
    },
    connectSteam: async input => {
      if (typeof input !== 'string' || input.length > 128) throw new Error('API Key 格式无效。');
      const candidate = input.trim();
      if (candidate && !isApiKey(candidate)) throw new Error('请输入 32 位十六进制 Steam Web API Key。');
      const key = candidate || rt.vault.value;
      if (!key) throw new Error('请先填写 Steam Web API Key。');
      // Try before saving, so a mistyped key never replaces one that works.
      await verifyKey(new SteamApi(key));
      if (rt.quitting()) return;
      if (candidate && candidate !== rt.vault.value) {
        const saved = await rt.vault.write(candidate);
        if (rt.quitting()) return;
        rt.adoptKey(saved);
      }
      rt.setMode('live');
    },
    finishOnboarding: () => {
      if (rt.live.preference('onboarded') === undefined) rt.live.setPreference('onboarded', String(Date.now()));
      rt.changed();
    },
    refresh: () => rt.refresh(),
    setPaused: value => {
      if (typeof value !== 'boolean') throw new Error('无效设置。');
      rt.setPaused(value);
    },
    setGapThreshold: minutes => {
      if (!validGapThreshold(minutes)) throw new Error('请输入 0 至 60 的整数分钟。');
      const previous = rt.gapThreshold();
      if (minutes > 0 || previous > 0) rt.live.setPreference('preferredGapThresholdMinutes', String(minutes || previous));
      rt.live.setPreference('gapThresholdMinutes', String(minutes));
      rt.changed();
    },
    configureDiscovery: async (input, enabled, approved) => {
      if (typeof input !== 'string' || input.length > 256 || typeof enabled !== 'boolean') throw new Error('好友发现设置无效。');
      if (!enabled && !input.trim()) {
        rt.discovery.configure('', false);
        rt.live.revokeConsent('discovery', null, Date.now());
        return;
      }
      const api = rt.requireLiveApi();
      const expectedKey = rt.vault.value;
      const owner = await api.resolve(input);
      if (rt.vault.value !== expectedKey || rt.mode !== 'live' || rt.quitting()) throw new Error('数据源已变更，请重新保存。');
      const now = Date.now();
      const consented = owner === rt.discovery.snapshot().owner && rt.live.consents(null).some(record => record.revokedAt === null);
      if (enabled && !consented && approved !== true) throw new Error('请先确认这是你自己的账号。');
      // The log follows the setting: a consent covers one owner for as long as discovery stays on.
      if (!enabled || !consented) rt.live.revokeConsent('discovery', null, now);
      if (enabled) rt.live.grantConsent('discovery', null, consentText.discovery, now);
      rt.discovery.configure(owner, enabled);
      if (enabled && !rt.paused && !rt.sleeping) await rt.discovery.check();
    },
    checkDiscovery: async () => { await rt.discovery.check(true); },
    previewDiscovery: () => {
      rt.requireLiveApi();
      return rt.previews.finish(rt.previews.invalidate(), rt.discovery.preview());
    },
    dismissDiscovery: () => {
      if (rt.mode !== 'live') return;
      rt.discovery.dismiss();
      rt.previews.invalidate();
    },
  } satisfies Partial<MonitorHandlers>;
}
