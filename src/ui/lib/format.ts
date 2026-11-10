export const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

export const day = (at: number) => new Date(at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });

export function localDateInput(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export const dateTime = (at: number) => new Date(at).toLocaleString('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function duration(minutes: number) {
  const rounded = Math.round(minutes);
  if (minutes > 0 && !rounded) return '不足 1 分钟';
  return rounded >= 60 ? Math.floor(rounded / 60) + ' 小时 ' + rounded % 60 + ' 分钟' : rounded + ' 分钟';
}

export function segmentDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 1) return '<1秒';
  if (seconds < 60) return seconds + '秒';
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  return (days ? days + '天' : '') + (hours ? hours + '小时' : '') + (rest ? rest + '分' : '');
}

export function timelineTextWidth(text: string) {
  return Array.from(text).reduce((width, char) => width + (/^[\x00-\x7f]$/.test(char) ? 7 : 12), 0);
}
