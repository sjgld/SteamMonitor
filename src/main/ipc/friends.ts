import { shell } from 'electron';
import { consentText, type MonitorHandlers } from '../../shared';
import type { Runtime } from '../runtime';
import { checkId } from './validate';

function beginPreview(rt: Runtime, input: string) {
  if (typeof input !== 'string' || input.length > 256) throw new Error('资料链接无效。');
  const api = rt.requireLiveApi();
  return { api, sequence: rt.previews.invalidate() };
}

/** Roster management, profile previews, game groups and links out to Steam. */
export function friendHandlers(rt: Runtime) {
  return {
    previewPlayer: async input => {
      const { api, sequence } = beginPreview(rt, input);
      const id = await api.resolve(input);
      const player = (await api.summaries([id])).get(id);
      if (!player) throw new Error('Steam 未找到该账号。');
      return rt.previews.finish(sequence, [{ id, name: player.name, avatar: player.avatar }])[0];
    },
    previewFriends: async input => {
      const { api, sequence } = beginPreview(rt, input);
      const id = await api.resolve(input);
      const ids = await api.friendIds(id);
      const existing = new Set(rt.live.friends().map(friend => friend.id));
      // Show IDs at preview time. Query profiles only for selected accounts.
      return rt.previews.finish(sequence, ids.filter(friendId => !existing.has(friendId))
        .map(friendId => ({ id: friendId, name: friendId })));
    },
    addPlayers: (ids, approved) => {
      rt.requireLiveApi();
      if (approved !== true) throw new Error('请先勾选授权确认。');
      if (!Array.isArray(ids) || !ids.length || ids.length > 5000) throw new Error('请选择要添加的账号。');
      const players = ids.map(id => {
        const player = rt.previews.get(id);
        if (!player) throw new Error('请先预览要添加的账号。');
        return player;
      });
      rt.live.add(players, { text: consentText.track, at: Date.now() });
      rt.discovery.dismiss(ids);
      rt.previews.invalidate();
      rt.changed();
      void rt.poller.refresh();
    },
    updateFriend: (id, edit, approved) => {
      checkId(id);
      if (!edit || typeof edit.note !== 'string' || edit.note.length > 100 ||
        typeof edit.pinned !== 'boolean' || typeof edit.paused !== 'boolean') throw new Error('无效设置。');
      const store = rt.currentStore();
      const wasPaused = store.friends().find(friend => friend.id === id)?.paused;
      if (wasPaused && !edit.paused && store.consentWithdrawn('track', id)) {
        if (approved !== true) throw new Error('授权已撤回，恢复记录前请重新确认。');
        store.grantConsent('track', id, consentText.track, Date.now());
      }
      store.update(id, edit.note.trim(), edit.pinned, edit.paused, Date.now());
      rt.changed();
      if (rt.mode === 'live' && edit.paused) rt.playtime.cancel(id);
      if (rt.mode === 'live' && wasPaused && !edit.paused) {
        void rt.poller.refresh();
        void rt.playtime.tick();
      }
    },
    removeFriend: id => {
      checkId(id);
      if (rt.mode === 'live') rt.playtime.cancel(id);
      rt.currentStore().remove(id);
      rt.changed();
    },
    favoriteGame: (game, enabled) => {
      if (typeof game !== 'string' || !game || game.length > 170 || typeof enabled !== 'boolean') throw new Error('游戏分组无效。');
      rt.currentStore().favoriteGame(game, enabled);
      rt.changed();
    },
    gameTitle: appId => rt.assets.title(appId),
    openSteam: async (kind, id) => {
      if (kind === 'profile') {
        checkId(id);
        if (rt.mode !== 'live') return;
        await shell.openExternal(`https://steamcommunity.com/profiles/${id}/`);
      } else if (kind === 'key') {
        await shell.openExternal('https://steamcommunity.com/dev/apikey');
      } else if (kind === 'game' && typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 0xFFFFFF) {
        await shell.openExternal(`https://store.steampowered.com/app/${id}/`);
      } else {
        throw new Error('该游戏没有可用的 Steam 商店链接。');
      }
    },
  } satisfies Partial<MonitorHandlers>;
}
