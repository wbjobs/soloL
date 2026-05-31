"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  clipboard: {
    list: (page, pageSize, type) => electron.ipcRenderer.invoke("clipboard:list", page, pageSize, type),
    search: (query) => electron.ipcRenderer.invoke("clipboard:search", query),
    copy: (id) => electron.ipcRenderer.invoke("clipboard:copy", id),
    delete: (id) => electron.ipcRenderer.invoke("clipboard:delete", id),
    favorite: (id) => electron.ipcRenderer.invoke("clipboard:favorite", id),
    get: (id) => electron.ipcRenderer.invoke("clipboard:get", id),
    onNew: (callback) => electron.ipcRenderer.on("clipboard:new", (_event, item) => callback(item)),
    onOcrComplete: (callback) => electron.ipcRenderer.on("ocr:complete", (_event, data) => callback(data))
  },
  settings: {
    get: (key) => electron.ipcRenderer.invoke("settings:get", key),
    set: (key, value) => electron.ipcRenderer.invoke("settings:set", key, value),
    getAll: () => electron.ipcRenderer.invoke("settings:all")
  },
  database: {
    vacuum: () => electron.ipcRenderer.invoke("db:vacuum"),
    cleanup: () => electron.ipcRenderer.invoke("db:cleanup"),
    stats: () => electron.ipcRenderer.invoke("db:stats")
  },
  sync: {
    enable: () => electron.ipcRenderer.invoke("sync:enable"),
    disable: () => electron.ipcRenderer.invoke("sync:disable"),
    peers: () => electron.ipcRenderer.invoke("sync:peers"),
    status: () => electron.ipcRenderer.invoke("sync:status"),
    onPeersChanged: (callback) => electron.ipcRenderer.on("sync:peers-changed", () => callback())
  },
  snippets: {
    list: () => electron.ipcRenderer.invoke("snippets:list"),
    get: (id) => electron.ipcRenderer.invoke("snippets:get", id),
    create: (name, description, items) => electron.ipcRenderer.invoke("snippets:create", name, description, items),
    update: (snippet) => electron.ipcRenderer.invoke("snippets:update", snippet),
    delete: (id) => electron.ipcRenderer.invoke("snippets:delete", id),
    reorder: (snippetId, itemOrders) => electron.ipcRenderer.invoke("snippets:reorder", snippetId, itemOrders),
    exportMarkdown: (id) => electron.ipcRenderer.invoke("snippets:export-markdown", id),
    smartPaste: (id) => electron.ipcRenderer.invoke("snippets:smart-paste", id),
    copy: (id) => electron.ipcRenderer.invoke("snippets:copy", id),
    onChanged: (callback) => electron.ipcRenderer.on("snippets:changed", () => callback())
  },
  window: {
    closeMain: () => electron.ipcRenderer.invoke("window:close-main"),
    closeFloat: () => electron.ipcRenderer.invoke("window:close-float"),
    showSettings: () => electron.ipcRenderer.invoke("window:show-settings"),
    onFocusSearch: (callback) => electron.ipcRenderer.on("float:focus-search", () => callback()),
    onNavigate: (callback) => electron.ipcRenderer.on("navigate", (_event, route) => callback(route))
  }
});
//# sourceMappingURL=index.js.map
