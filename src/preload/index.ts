import { contextBridge } from 'electron';

// Мост наполняется в Task 3 (контракт Api из src/shared/ipc.ts)
contextBridge.exposeInMainWorld('api', {});
