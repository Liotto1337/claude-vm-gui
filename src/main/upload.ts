import { EventEmitter } from 'node:events';
import { fail, ok, type Result } from '@shared/ipc';
import { MAX_FILE_BYTES, remoteName } from '@shared/upload-name';
import type { SshConnection } from './ssh';

const UPLOAD_DIR = '"$HOME/.cache/claude-vm-gui/uploads"';
const CHUNK = 64 * 1024;

/** Загрузка файлов на ВМ по SFTP (картинки и любые другие). Событие `progress` (UploadProgress). */
export class UploadService extends EventEmitter {
  private dir: string | null = null;

  constructor(private readonly conn: SshConnection) {
    super();
    conn.on('reconnected', () => {
      this.dir = null;
    });
  }

  private async uploadDir(): Promise<string> {
    if (this.dir) return this.dir;
    const r = await this.conn.exec(`mkdir -p ${UPLOAD_DIR} && cd ${UPLOAD_DIR} && pwd -P`);
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'Не удалось создать папку для загрузок');
    this.dir = r.stdout.trim();
    return this.dir;
  }

  async file(id: string, bytes: Uint8Array, name: string): Promise<Result<{ remotePath: string }>> {
    if (bytes.byteLength > MAX_FILE_BYTES) return fail('UPLOAD_TOO_BIG', 'Файл больше 50 МБ');
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    try {
      const remotePath = `${await this.uploadDir()}/${remoteName(String(name))}`;
      const sftp = await this.conn.sftp();
      const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      await new Promise<void>((resolve, reject) => {
        const ws = sftp.createWriteStream(remotePath, { mode: 0o600 });
        ws.on('error', reject);
        ws.on('close', () => resolve());
        let sent = 0;
        const writeNext = () => {
          while (sent < data.length) {
            const chunk = data.subarray(sent, sent + CHUNK);
            sent += chunk.length;
            this.emit('progress', { id, sent, total: data.length });
            if (!ws.write(chunk)) {
              ws.once('drain', writeNext);
              return;
            }
          }
          ws.end();
        };
        if (data.length === 0) {
          this.emit('progress', { id, sent: 0, total: 0 });
          ws.end();
        } else writeNext();
      });
      return ok({ remotePath });
    } catch (e) {
      return fail('UPLOAD_FAILED', (e as Error).message);
    }
  }

  /**
   * Начало загруженного файла для ленты: не больше maxBytes и полный размер. Только внутри папки загрузок —
   * путь проверяется после realpath (никаких «..» и ссылок наружу).
   */
  async read(path: string, maxBytes: number): Promise<Result<{ bytes: Uint8Array; size: number; truncated: boolean }>> {
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    if (typeof path !== 'string' || !path.startsWith('/')) return fail('BAD_PATH', 'Файл не из папки загрузок');
    try {
      const dir = await this.uploadDir();
      const sftp = await this.conn.sftp();
      const real = await new Promise<string | null>((resolve) => sftp.realpath(path, (err, p) => resolve(err ? null : p)));
      if (real === null) return fail('NOT_FOUND', 'Файл удалён с ВМ');
      if (!real.startsWith(`${dir}/`)) return fail('BAD_PATH', 'Файл не из папки загрузок');
      const st = await new Promise<{ size: number; isFile(): boolean } | null>((resolve) => sftp.stat(real, (err, s) => resolve(err ? null : s)));
      if (!st || !st.isFile()) return fail('NOT_FOUND', 'Файл удалён с ВМ');
      const n = Math.max(0, Math.min(st.size, maxBytes));
      const chunks: Buffer[] = [];
      if (n > 0)
        await new Promise<void>((resolve, reject) => {
          const rs = sftp.createReadStream(real, { start: 0, end: n - 1 });
          rs.on('data', (c: Buffer) => chunks.push(c));
          rs.on('error', reject);
          rs.on('end', () => resolve());
        });
      return ok({ bytes: new Uint8Array(Buffer.concat(chunks)), size: st.size, truncated: st.size > n });
    } catch (e) {
      return fail('UPLOAD_FAILED', (e as Error).message);
    }
  }

  /** Удаляет загруженные файлы старше 7 дней. */
  async cleanup(): Promise<void> {
    if (!this.conn.connected) return;
    await this.conn.exec(`find ${UPLOAD_DIR} -type f -mtime +7 -delete 2>/dev/null; true`);
  }
}
