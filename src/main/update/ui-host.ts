import { dialog, shell, type BrowserWindow } from 'electron';
import { pathToFileURL } from 'node:url';
import type { ReleaseCheck, Snapshot } from '../../shared';
import { checkGitHubRelease, githubCredential, releasePage } from './github-update';
import { backendFingerprint, savedUiUpdate, stageUiUpdate, stageVerifiedUi, type UiTarget } from './ui-update';

export interface UiHostContext {
  window(): BrowserWindow | null;
  quitting(): boolean;
  preference(key: string): string | undefined;
  setPreference(key: string, value: string): void;
  changed(): void;
  userData: string;
  updatesRoot: string;
  buildRoot: string;
}

const activePreference = 'activeUiUpdate';
const trialTimeout = 10_000;

/**
 * Decides which renderer bundle the window loads. A newer bundle is loaded on trial and only kept once
 * the renderer reports `uiReady`; otherwise the previous bundle is restored.
 */
export class UiHost {
  readonly packaged: UiTarget;
  private active: UiTarget;
  private trial: { target: UiTarget; timer: NodeJS.Timeout } | null = null;
  private busy = false;
  private checked: Awaited<ReturnType<typeof checkGitHubRelease>> | null = null;
  result: Snapshot['uiUpdateResult'] = null;

  constructor(private readonly ctx: UiHostContext, version: string, index: string) {
    this.packaged = { version, index };
    this.active = this.packaged;
  }

  get version() {
    return this.active.version;
  }

  private backend() {
    return backendFingerprint(this.ctx.buildRoot, process.versions.electron);
  }

  /** Loads the saved interface update if it is still valid, otherwise the packaged one. */
  async loadInitial() {
    const window = this.ctx.window();
    if (!window) return;
    const folder = this.ctx.preference(activePreference);
    const saved = folder ? await savedUiUpdate(this.ctx.updatesRoot, folder, this.packaged.version, this.backend()) : null;
    if (saved) this.tryLoad(saved);
    else {
      if (folder) this.ctx.setPreference(activePreference, '');
      await window.loadFile(this.packaged.index);
    }
  }

  private tryLoad(target: UiTarget) {
    const window = this.ctx.window();
    if (!window || this.ctx.quitting()) return;
    const rollback = () => {
      const current = this.ctx.window();
      if (this.trial?.target !== target || !current || this.ctx.quitting()) return;
      clearTimeout(this.trial.timer);
      this.trial = null;
      this.ctx.setPreference(activePreference, this.active.folder ?? '');
      this.result = { text: '新版界面未能启动，已恢复之前的界面。', error: true };
      void current.loadFile(this.active.index).catch(() => {
        this.active = this.packaged;
        this.ctx.setPreference(activePreference, '');
        void this.ctx.window()?.loadFile(this.packaged.index).catch(() =>
          dialog.showErrorBox('SteamMonitor 界面加载失败', '请检查程序文件是否完整。'));
      });
    };
    this.trial = { target, timer: setTimeout(rollback, trialTimeout) };
    void window.loadFile(target.index).catch(rollback);
  }

  markReady() {
    if (!this.trial || this.ctx.window()?.webContents.getURL() !== pathToFileURL(this.trial.target.index).href) return;
    this.ctx.setPreference(activePreference, this.trial.target.folder ?? '');
    clearTimeout(this.trial.timer);
    this.active = this.trial.target;
    this.trial = null;
    this.result = { text: `界面已更新到 ${this.active.version}`, error: false };
    this.ctx.changed();
  }

  async installFromFolder() {
    const window = this.ctx.window();
    if (this.busy || this.trial || !window) return false;
    this.busy = true;
    try {
      const selection = await dialog.showOpenDialog(window, {
        title: '选择已解压的 SteamMonitor 新版文件夹', properties: ['openDirectory'],
      });
      if (selection.canceled || this.ctx.quitting()) return false;
      const target = await stageUiUpdate(selection.filePaths[0], this.ctx.updatesRoot, this.active.version, this.backend());
      if (this.ctx.quitting()) return false;
      this.result = null;
      this.tryLoad(target);
      return true;
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code) {
        throw new Error('无法读取更新包。请选择已解压的 SteamMonitor 新版文件夹。');
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async checkRelease(): Promise<ReleaseCheck> {
    if (this.busy || this.trial) throw new Error('软件更新正在进行，请稍后再试。');
    this.busy = true;
    this.checked = null;
    try {
      this.checked = await checkGitHubRelease(await githubCredential(this.ctx.userData), this.active.version, this.backend());
      return this.checked.result;
    } finally {
      this.busy = false;
    }
  }

  async applyRelease() {
    if (this.busy || this.trial) throw new Error('软件更新正在进行，请稍后再试。');
    if (!this.checked?.bundle) throw new Error('请先检查可用的界面更新。');
    this.busy = true;
    try {
      const target = await stageVerifiedUi(this.checked.bundle, this.ctx.updatesRoot, this.active.version, this.backend());
      this.checked = null;
      if (this.ctx.quitting()) return;
      this.result = null;
      this.tryLoad(target);
    } finally {
      this.busy = false;
    }
  }

  openReleasePage() {
    const release = this.checked?.result;
    if (release?.kind !== 'full') throw new Error('请先检查可用的完整版本。');
    return shell.openExternal(releasePage(release.version));
  }

  dispose() {
    if (this.trial) clearTimeout(this.trial.timer);
  }
}
