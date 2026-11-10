import type { ConsentKind } from './types';

/**
 * The statements a user ticks before data about an account is stored. The interface shows them and the
 * main process logs the same wording, so the log cannot be written with a text the user never saw.
 */
export const consentText: Record<ConsentKind, string> = {
  track: '我确认所选账号属于我，或账号持有人已请求记录并知悉保存内容。',
  playtime: '这是我的账号，或账号持有人已请求保存公开游戏时长。',
  discovery: '这是我自己的账号，我同意定期读取它的公开好友名单。',
};

export const consentLabels: Record<ConsentKind, string> = {
  track: '状态记录',
  playtime: '公开时长',
  discovery: '好友发现',
};
