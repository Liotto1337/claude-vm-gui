import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fail, ok, type ImageExt, type Result } from '@shared/ipc';
import type { SshConnection } from './ssh';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const UPLOAD_DIR = '"$HOME/.cache/claude-vm-gui/uploads"';
const CHUNK = 64 * 1024;
const EXTS: ImageExt[] = ['png', 'jpg', 'gif', 'webp'];

const pad = (n: number) => String(n).padStart(2, '0');
function fileName(ext: ImageExt, d = new Date()): string {
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${randomBytes(3).toString('hex')}.${ext}`;
}

/** Загрузка картинок на ВМ по SFTP. Событие `progress` (UploadProgress). */
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
    const r = await this.conn.exec(`mkdir -p ${UPLOAD_DIR} && cd ${UPLOAD_DIR} && pwd`);
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'Не удалось создать папку для картинок');
    this.dir = r.stdout.trim();
    return this.dir;
  }

  async image(id: string, bytes: Uint8Array, ext: ImageExt): Promise<Result<{ remotePath: string }>> {
    if (bytes.byteLength > MAX_IMAGE_BYTES) return fail('UPLOAD_TOO_BIG', 'Картинка больше 20 МБ');
    if (!EXTS.includes(ext)) return fail('UPLOAD_FAILED', 'Поддерживаются PNG, JPEG, GIF и WebP');
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    try {
      const remotePath = `${await this.uploadDir()}/${fileName(ext)}`;
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

  /** Удаляет загруженные картинки старше 7 дней. */
  async cleanup(): Promise<void> {
    if (!this.conn.connected) return;
    await this.conn.exec(`find ${UPLOAD_DIR} -type f -mtime +7 -delete 2>/dev/null; true`);
  }
}
