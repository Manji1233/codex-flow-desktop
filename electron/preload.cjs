const { contextBridge, ipcRenderer } = require('electron');

function eventSubscription(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

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
  agent: {
    status: () => ipcRenderer.invoke('codex:status'),
    start: payload => ipcRenderer.invoke('agent:start', payload),
    cancel: requestId => ipcRenderer.invoke('agent:cancel', requestId),
    onEvent: callback => eventSubscription('agent:event', callback)
  },
  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    install: pluginId => ipcRenderer.invoke('extensions:install', pluginId),
    remove: pluginId => ipcRenderer.invoke('extensions:remove', pluginId),
    addMcp: payload => ipcRenderer.invoke('extensions:add-mcp', payload),
    removeMcp: name => ipcRenderer.invoke('extensions:remove-mcp', name)
  },
  workspace: {
    choose: () => ipcRenderer.invoke('workspace:choose')
  },
  chat: {
    start: payload => ipcRenderer.invoke('chat:start', payload),
    cancel: requestId => ipcRenderer.invoke('chat:cancel', requestId),
    onEvent: callback => eventSubscription('chat:event', callback)
  },
  usage: {
    summary: range => ipcRenderer.invoke('usage:summary', range),
    list: limit => ipcRenderer.invoke('usage:list', limit)
  }
});
