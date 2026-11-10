import { safeStorage } from 'electron';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isApiKey } from '../shared';

/** The Steam Web API key, encrypted with the operating system's credential store. */
export class KeyVault {
  value = '';
  readError = '';
  private busy = false;

  constructor(private readonly file: string) {}

  async load() {
    try {
      const { result } = await safeStorage.decryptStringAsync(await readFile(this.file));
      this.value = result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.readError = '无法读取保存的 API Key，请重新填写。';
    }
  }

  /** Validates and persists a new key (empty clears it). The caller adopts it with `adopt`. */
  async write(input: unknown): Promise<string> {
    if (typeof input !== 'string' || input.length > 128) throw new Error('API Key 格式无效。');
    const value = input.trim();
    if (value && !isApiKey(value)) throw new Error('请输入 32 位十六进制 Steam Web API Key。');
    if (this.busy) throw new Error('正在保存 API Key。');
    this.busy = true;
    const temporary = this.file + '.tmp';
    try {
      if (value) {
        if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('系统凭据加密不可用。');
        await writeFile(temporary, await safeStorage.encryptStringAsync(value));
        await rename(temporary, this.file);
      } else {
        await rm(this.file, { force: true });
      }
    } catch {
      throw new Error('无法保存或清除 API Key，请检查本机凭据存储。');
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
      this.busy = false;
    }
    return value;
  }

  adopt(value: string) {
    this.value = value;
    this.readError = '';
  }
}
