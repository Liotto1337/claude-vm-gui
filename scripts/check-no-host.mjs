// Не даёт закоммитить адрес ВМ. Адрес берётся из vm.config.json (он в .gitignore).
// Запуск из git-хука pre-commit: node scripts/check-no-host.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const isWord = (b) =>
  (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x2d;

/** Возвращает пути файлов, где адрес встречается отдельным словом (10.1.2.3, но не 10.1.2.30). */
export function findHostLeaks(host, files) {
  if (!host) return [];
  const needle = Buffer.from(host);
  return files
    .filter(({ content }) => {
      for (let i = content.indexOf(needle); i !== -1; i = content.indexOf(needle, i + 1)) {
        const before = i > 0 ? content[i - 1] : 0;
        const after = content[i + needle.length] ?? 0;
        const afterNext = content[i + needle.length + 1] ?? 0;
        const continues = isWord(after) || (after === 0x2e && isWord(afterNext));
        if (!isWord(before) && before !== 0x2e && !continues) return true;
      }
      return false;
    })
    .map((f) => f.path);
}

function main() {
  if (!existsSync('vm.config.json')) return 0;
  const host = String(JSON.parse(readFileSync('vm.config.json', 'utf8')).host ?? '').trim();
  const git = (args) => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });
  const paths = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const files = paths.map((path) => ({ path, content: git(['show', `:${path}`]) }));
  const leaks = findHostLeaks(host, files);
  if (leaks.length === 0) return 0;
  console.error('Коммит отклонён: в файлах найден адрес ВМ из vm.config.json:');
  for (const p of leaks) console.error(`  ${p}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
