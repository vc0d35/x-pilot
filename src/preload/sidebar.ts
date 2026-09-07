import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('xpilot', { version: '0.1.0' });
