import { presenceLabels, type Activity } from '../../shared';

export function toCsv(rows: Activity[]) {
  const header = ['观测时间 (UTC)', '好友', 'SteamID64', '事件', '在线状态', '之前在线状态',
    '游戏 ID', '游戏', '之前的游戏 ID', '之前的游戏', '缺口结束 (UTC)', '说明'];
  const labels = { baseline: '状态基线', change: '状态变化', gap: '采集缺口' };
  const values = rows.map(row => [
    new Date(row.at).toISOString(), row.name, row.playerId, labels[row.kind],
    row.presence ? presenceLabels[row.presence] : '',
    row.previousPresence ? presenceLabels[row.previousPresence] : '',
    row.gameId, row.gameName, row.previousGameId, row.previousGameName,
    row.endedAt === null ? '' : new Date(row.endedAt).toISOString(), row.reason,
  ]);
  const field = (value: string | null) => {
    const plain = value ?? '';
    const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(plain) ? "'" + plain : plain;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [header, ...values].map(row => row.map(field).join(',')).join('\r\n') + '\r\n';
}
