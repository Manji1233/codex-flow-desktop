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
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    summary: () => ipcRenderer.invoke('tasks:summary'),
    save: payload => ipcRenderer.invoke('tasks:save', payload),
    toggle: (id, enabled) => ipcRenderer.invoke('tasks:toggle', id, enabled),
    remove: id => ipcRenderer.invoke('tasks:remove', id),
    run: id => ipcRenderer.invoke('tasks:run', id),
    onChanged: callback => eventSubscription('tasks:changed', callback)
  },
  history: { list: limit => ipcRenderer.invoke('history:list', limit) },
  prompts: { list: () => ipcRenderer.invoke('prompts:list'), save: payload => ipcRenderer.invoke('prompts:save', payload), remove: id => ipcRenderer.invoke('prompts:remove', id) },
  conversation: { export: payload => ipcRenderer.invoke('conversation:export', payload) },
  media: { choose: () => ipcRenderer.invoke('media:choose') },
  images: { choose: () => ipcRenderer.invoke('images:choose') },
  appServer: {
    status: () => ipcRenderer.invoke('app-server:status'),
    listThreads: payload => ipcRenderer.invoke('app-server:thread-list', payload),
    readThread: threadId => ipcRenderer.invoke('app-server:thread-read', threadId),
    startThread: payload => ipcRenderer.invoke('app-server:thread-start', payload),
    resumeThread: payload => ipcRenderer.invoke('app-server:thread-resume', payload),
    forkThread: payload => ipcRenderer.invoke('app-server:thread-fork', payload),
    archiveThread: threadId => ipcRenderer.invoke('app-server:thread-archive', threadId),
    unarchiveThread: threadId => ipcRenderer.invoke('app-server:thread-unarchive', threadId),
    startTurn: payload => ipcRenderer.invoke('app-server:turn-start', payload),
    steerTurn: payload => ipcRenderer.invoke('app-server:turn-steer', payload),
    interruptTurn: payload => ipcRenderer.invoke('app-server:turn-interrupt', payload),
    respond: payload => ipcRenderer.invoke('app-server:respond', payload),
    onEvent: callback => eventSubscription('app-server:event', callback),
    onRequest: callback => eventSubscription('app-server:request', callback),
    onStatus: callback => eventSubscription('app-server:status', callback)
  },
  usage: {
    summary: range => ipcRenderer.invoke('usage:summary', range),
    list: limit => ipcRenderer.invoke('usage:list', limit)
  }
});
