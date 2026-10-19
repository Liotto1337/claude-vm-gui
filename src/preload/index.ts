import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Api } from '@shared/ipc';

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const send =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.send(channel, ...args);

const on =
  <T>(channel: string) =>
  (cb: (payload: T) => void) => {
    const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  };

const api: Api = {
  config: { get: invoke('config:get'), save: invoke('config:save') } as Api['config'],
  connection: {
    connect: invoke('connection:connect'),
    disconnect: invoke('connection:disconnect'),
    onPreflight: on('connection:preflight'),
    onState: on('connection:state'),
    onHostKey: on('connection:hostKey'),
    answerHostKey: send('connection:answerHostKey'),
  } as Api['connection'],
  tmux: {
    list: invoke('tmux:list'),
    onSessions: on('tmux:sessions'),
    create: invoke('tmux:create'),
    kill: invoke('tmux:kill'),
    startClaude: invoke('tmux:startClaude'),
  } as Api['tmux'],
  term: {
    open: invoke('term:open'),
    write: send('term:write'),
    resize: send('term:resize'),
    onData: on('term:data'),
    onExit: on('term:exit'),
    send: invoke('term:send'),
    setModel: invoke('term:setModel'),
    setEffort: invoke('term:setEffort'),
  } as Api['term'],
  hints: { get: invoke('hints:get'), files: invoke('hints:files'), dirs: invoke('hints:dirs') } as Api['hints'],
  upload: { image: invoke('upload:image'), onProgress: on('upload:progress') } as Api['upload'],
  clipboard: { read: invoke('clipboard:read'), write: send('clipboard:write') } as Api['clipboard'],
  layout: { get: invoke('layout:get'), save: invoke('layout:save') } as Api['layout'],
  links: { open: send('links:open') } as Api['links'],
  chat: {
    onItems: on('chat:items'),
    onScreen: on('chat:screen'),
    onUnavailable: on('chat:unavailable'),
    loadEarlier: invoke('chat:loadEarlier'),
    key: invoke('chat:key'),
  } as Api['chat'],
  platform: { theme: invoke('platform:theme'), onThemeChange: on('platform:themeChange') } as Api['platform'],
};

contextBridge.exposeInMainWorld('api', api);
