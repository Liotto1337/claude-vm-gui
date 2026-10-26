import { EventEmitter } from 'node:events';
import { createWriteStream, renameSync, rmSync } from 'node:fs';
import { fail, ok, type Result } from '@shared/ipc';
import { MAX_FILE_BYTES, remoteName } from '@shared/upload-name';
import type { SshConnection } from './ssh';

const UPLOAD_DIR = '"$HOME/.cache/claude-vm-gui/uploads"';
/** Папка «для вас»: сюда Claude кладёт файлы для пользователя (см. CLAUDE.md на ВМ) */
const OUTBOX_DIR = '"$HOME/.cache/claude-vm-gui/outbox"';
const CHUNK = 64 * 1024;

type Stat = { size: number; isFile(): boolean };

/**
 * Файлы на ВМ по SFTP: загрузка в папку загрузок (событие `progress`, UploadProgress), чтение начала файла
 * из загрузок и outbox, скачивание файла outbox на компьютер.
 */
export class UploadService extends EventEmitter {
  private dirs: { uploads: string; outbox: string } | null = null;

  constructor(private readonly conn: SshConnection) {
    super();
    conn.on('reconnected', () => {
      this.dirs = null;
    });
  }

  private async folders(): Promise<{ uploads: string; outbox: string }> {
    if (this.dirs) return this.dirs;
    const r = await this.conn.exec(`mkdir -p ${UPLOAD_DIR} ${OUTBOX_DIR} && cd ${UPLOAD_DIR} && pwd -P && cd ${OUTBOX_DIR} && pwd -P`);
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'Не удалось создать папку для загрузок');
    const [uploads, outbox] = r.stdout.trim().split('\n');
    this.dirs = { uploads, outbox };
    return this.dirs;
  }

  private async uploadDir(): Promise<string> {
    return (await this.folders()).uploads;
  }

  /** Настоящий путь файла внутри одной из папок (после realpath: никаких «..» и ссылок наружу). */
  private async locate(path: string, dirs: string[]): Promise<Result<{ real: string; st: Stat }>> {
    if (typeof path !== 'string' || !path.startsWith('/')) return fail('BAD_PATH', 'Файл не из папки загрузок');
    const sftp = await this.conn.sftp();
    const real = await new Promise<string | null>((resolve) => sftp.realpath(path, (err, p) => resolve(err ? null : p)));
    if (real === null) return fail('NOT_FOUND', 'Файл удалён с ВМ');
    if (!dirs.some((d) => real.startsWith(`${d}/`))) return fail('BAD_PATH', 'Файл не из папки загрузок');
    const st = await new Promise<Stat | null>((resolve) => sftp.stat(real, (err, s) => resolve(err ? null : s)));
    if (!st || !st.isFile()) return fail('NOT_FOUND', 'Файл удалён с ВМ');
    return ok({ real, st });
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
   * Начало файла для ленты: не больше maxBytes и полный размер. Только внутри папки загрузок или outbox —
   * путь проверяется после realpath (никаких «..» и ссылок наружу).
   */
  async read(path: string, maxBytes: number): Promise<Result<{ bytes: Uint8Array; size: number; truncated: boolean }>> {
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    try {
      const { uploads, outbox } = await this.folders();
      const found = await this.locate(path, [uploads, outbox]);
      if (!found.ok) return found;
      const { real, st } = found.data;
      const sftp = await this.conn.sftp();
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

  /**
   * Файл outbox целиком в dest на этом компьютере, потоком (байты не идут через IPC). Пишется в «dest.part»,
   * по завершении переименовывается; ошибка или обрыв — недокачанный файл удаляется.
   */
  async download(path: string, dest: string, onProgress: (sent: number, total: number) => void): Promise<Result<void>> {
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    const part = `${dest}.part`;
    try {
      const found = await this.locate(path, [(await this.folders()).outbox]);
      if (!found.ok) return found;
      const { real, st } = found.data;
      const sftp = await this.conn.sftp();
      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(part, { mode: 0o600 });
        const rs = sftp.createReadStream(real);
        let sent = 0;
        let done = false;
        const failWith = (e: Error) => {
          if (done) return;
          done = true;
          rs.destroy();
          ws.destroy();
          reject(e);
        };
        ws.on('error', failWith);
        rs.on('error', failWith);
        // обрыв канала закрывает поток чтения без ошибки — недобор байт тоже ошибка
        rs.on('close', () => {
          if (sent < st.size) failWith(new Error('Связь с ВМ прервалась'));
        });
        rs.on('data', (c: Buffer) => {
          sent += c.length;
          onProgress(sent, st.size);
        });
        ws.on('finish', () => {
          if (done) return;
          if (sent < st.size) return failWith(new Error('Связь с ВМ прервалась'));
          done = true;
          resolve();
        });
        if (st.size === 0) onProgress(0, 0);
        rs.pipe(ws);
      });
      renameSync(part, dest);
      return ok(undefined);
    } catch (e) {
      rmSync(part, { force: true });
      return fail('DOWNLOAD_FAILED', (e as Error).message);
    }
  }

  /** Удаляет загруженные файлы и файлы outbox старше 7 дней. */
  async cleanup(): Promise<void> {
    if (!this.conn.connected) return;
    await this.conn.exec(`find ${UPLOAD_DIR} ${OUTBOX_DIR} -type f -mtime +7 -delete 2>/dev/null; true`);
  }
}
