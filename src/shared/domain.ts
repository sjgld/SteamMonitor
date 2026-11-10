import type { Presence } from './types';

export function isGameAppId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,7}$/.test(value) && Number(value) <= 0xffffff;
}

export const presenceLabels: Record<Presence, string> = {
  online: '在线',
  away: '离开',
  busy: '忙碌',
  offline: '显示离线',
  unknown: '状态未知',
};

/** A Steam Web API key is 32 hexadecimal characters. Checked while typing and again before saving. */
export function isApiKey(value: string) {
  return /^[\da-f]{32}$/i.test(value);
}
