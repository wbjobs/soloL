const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenShareAPI', {
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getWindows: () => ipcRenderer.invoke('get-windows'),
  connectWebSocket: (url) => ipcRenderer.invoke('connect-websocket', url),
  disconnectWebSocket: () => ipcRenderer.invoke('disconnect-websocket'),
  startSharing: (config) => ipcRenderer.invoke('start-sharing', config),
  stopSharing: () => ipcRenderer.invoke('stop-sharing'),
  setFps: (fps) => ipcRenderer.invoke('set-fps', fps),
  setQuality: (quality) => ipcRenderer.invoke('set-quality', quality),
  setScale: (scale) => ipcRenderer.invoke('set-scale', scale),
  selectDisplay: (display) => ipcRenderer.invoke('select-display', display),
  selectWindow: (window) => ipcRenderer.invoke('select-window', window),
  setRegion: (region) => ipcRenderer.invoke('set-region', region),
  getStatus: () => ipcRenderer.invoke('get-status'),
  sendChat: (message) => ipcRenderer.invoke('send-chat'),

  toggleRemoteControl: (enabled, reason) => ipcRenderer.invoke('toggle-remote-control', enabled, reason),
  getControlPermission: () => ipcRenderer.invoke('get-control-permission'),
  getAuditLogs: (limit) => ipcRenderer.invoke('get-audit-logs', limit),
  sendControlEvent: (controlData) => ipcRenderer.invoke('send-control-event', controlData),

  onFrameCaptured: (callback) => {
    ipcRenderer.on('frame-captured', (_, data) => callback(data));
  },
  onSharingStarted: (callback) => {
    ipcRenderer.on('sharing-started', (_, data) => callback(data));
  },
  onSharingStopped: (callback) => {
    ipcRenderer.on('sharing-stopped', (_, data) => callback(data));
  },
  onFpsChanged: (callback) => {
    ipcRenderer.on('fps-changed', (_, data) => callback(data));
  },
  onChatMessage: (callback) => {
    ipcRenderer.on('chat-message', (_, data) => callback(data));
  },
  onWebSocketConnected: (callback) => {
    ipcRenderer.on('websocket-connected', (_, data) => callback(data));
  },
  onWebSocketDisconnected: (callback) => {
    ipcRenderer.on('websocket-disconnected', (_, data) => callback(data));
  },
  onCaptureError: (callback) => {
    ipcRenderer.on('capture-error', (_, data) => callback(data));
  },
  onControlPermissionChanged: (callback) => {
    ipcRenderer.on('control-permission-changed', (_, data) => callback(data));
  },
  onControlExecuted: (callback) => {
    ipcRenderer.on('control-executed', (_, data) => callback(data));
  },
  onControlBlocked: (callback) => {
    ipcRenderer.on('control-blocked', (_, data) => callback(data));
  },
  onControlRequest: (callback) => {
    ipcRenderer.on('control-request', (_, data) => callback(data));
  },

  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('frame-captured');
    ipcRenderer.removeAllListeners('sharing-started');
    ipcRenderer.removeAllListeners('sharing-stopped');
    ipcRenderer.removeAllListeners('fps-changed');
    ipcRenderer.removeAllListeners('chat-message');
    ipcRenderer.removeAllListeners('websocket-connected');
    ipcRenderer.removeAllListeners('websocket-disconnected');
    ipcRenderer.removeAllListeners('capture-error');
    ipcRenderer.removeAllListeners('control-permission-changed');
    ipcRenderer.removeAllListeners('control-executed');
    ipcRenderer.removeAllListeners('control-blocked');
    ipcRenderer.removeAllListeners('control-request');
  }
});
