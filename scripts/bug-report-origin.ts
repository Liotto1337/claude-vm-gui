export function bugReportOrigin(value: string | undefined): string {
  if (!value) return '';
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('VITE_BUG_REPORT_ORIGIN должен быть HTTPS origin без пути (HTTP только для localhost).');
  }
  return url.origin;
}
