const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codex', {
  config: {
    getPublic: () => ipcRenderer.invoke('config:get-public')
  },
  codingPlans: {
    list: () => ipcRenderer.invoke('coding-plans:list')
  },
  provider: {
    saveAndDiscover: payload => ipcRenderer.invoke('provider:save-and-discover', payload),
    discover: () => ipcRenderer.invoke('provider:discover'),
    setModel: model => ipcRenderer.invoke('provider:set-model', model)
  },
  chat: {
    start: payload => ipcRenderer.invoke('chat:start', payload),
    cancel: requestId => ipcRenderer.invoke('chat:cancel', requestId),
    onEvent: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('chat:event', listener);
      return () => ipcRenderer.removeListener('chat:event', listener);
    }
  },
  usage: {
    summary: range => ipcRenderer.invoke('usage:summary', range),
    list: limit => ipcRenderer.invoke('usage:list', limit)
  }
});
