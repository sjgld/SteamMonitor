import { useEffect, useState } from 'react';
import type { RangeDays, Report } from '../../shared';
import { api, errorText } from './api';

export function useReport(id: string | null, range: RangeDays, version: number, onError: (text: string) => void,
  calendarDay?: string, activePage = true, fixedFrom?: number, fixedUntil?: number) {
  const key = JSON.stringify([id, range, calendarDay, fixedFrom, fixedUntil]);
  const [report, setReport] = useState<{ key: string; value: Report } | null>(null);
  useEffect(() => {
    if (!activePage) return;
    let active = true;
    const fixed = fixedFrom === undefined || fixedUntil === undefined ? undefined : { from: fixedFrom, until: fixedUntil };
    void api.report(id, range, calendarDay, fixed).then(value => { if (active) setReport({ key, value }); })
      .catch(error => { if (active) onError(errorText(error)); });
    return () => { active = false; };
  }, [id, range, version, onError, calendarDay, key, activePage, fixedFrom, fixedUntil]);
  return report?.key === key ? report.value : null;
}
