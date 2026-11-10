import type { MonitorApi } from '../../shared';

declare global {
  interface Window { monitor: MonitorApi }
}

export const api = window.monitor;

export function errorText(error: unknown) {
  if (!(error instanceof Error)) return '操作失败，请重试。';
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
