import type { Preferences } from '../shared';
import { isSteamId } from './steam/api';

/** The setup guide opens by itself once, and only for an installation that has nothing configured. */
export function isFirstRun(state: { onboarded: boolean; hasKey: boolean; friends: number }) {
  return !state.onboarded && !state.hasKey && state.friends === 0;
}

export const defaultRetentionDays = 90;
const clockTime = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Validates preferences coming from the renderer or from the local database. */
export function parsePreferences(value: Preferences): Preferences {
  const settings = value?.notices;
  if (!settings || !Number.isInteger(value.retentionDays) || value.retentionDays < 7 || value.retentionDays > 365 ||
    typeof value.autoStart !== 'boolean' || typeof settings.online !== 'boolean' || typeof settings.game !== 'boolean' ||
    typeof settings.party !== 'boolean' || typeof settings.friendId !== 'string' ||
    (settings.friendId && !isSteamId(settings.friendId)) || typeof settings.gameFilter !== 'string' ||
    settings.gameFilter.length > 100 || !Number.isInteger(settings.partySize) || settings.partySize < 2 || settings.partySize > 8 ||
    !Number.isInteger(settings.cooldown) || settings.cooldown < 1 || settings.cooldown > 240 ||
    typeof settings.quietStart !== 'string' || (settings.quietStart && !clockTime.test(settings.quietStart)) ||
    typeof settings.quietEnd !== 'string' || (settings.quietEnd && !clockTime.test(settings.quietEnd)) ||
    Boolean(settings.quietStart) !== Boolean(settings.quietEnd)) {
    throw new Error('设置无效，请检查天数、人数、冷却时间和免打扰时段。');
  }
  return {
    retentionDays: value.retentionDays, autoStart: value.autoStart, notices: {
      online: settings.online, game: settings.game, party: settings.party, friendId: settings.friendId,
      gameFilter: settings.gameFilter.trim(), partySize: settings.partySize, cooldown: settings.cooldown,
      quietStart: settings.quietStart, quietEnd: settings.quietEnd,
    },
  };
}
