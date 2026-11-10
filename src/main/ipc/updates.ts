import type { MonitorHandlers } from '../../shared';
import type { Runtime } from '../runtime';

/** Interface updates: trial confirmation, local folders and GitHub releases. */
export function updateHandlers(rt: Runtime) {
  return {
    uiReady: () => rt.ui.markReady(),
    installUiUpdate: () => rt.ui.installFromFolder(),
    checkRelease: () => rt.ui.checkRelease(),
    applyReleaseUi: () => rt.ui.applyRelease(),
    openRelease: () => rt.ui.openReleasePage(),
  } satisfies Partial<MonitorHandlers>;
}
