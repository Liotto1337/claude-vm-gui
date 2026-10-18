import type { Api } from '@shared/ipc';

declare global {
  interface Window {
    api: Api;
  }
}

export const api: Api = window.api;
