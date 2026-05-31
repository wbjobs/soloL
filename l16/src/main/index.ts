import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import path from 'path'
import { db } from './database'
import { clipboardMonitor } from './clipboard'
import { ocrService } from './ocr'
import { scheduler } from './scheduler'
import { syncService } from './sync'
import { trayManager } from './tray'
import { setupIpcHandlers } from './ipc'
import { imageStore } from './imageStore'
import { snippetService } from './snippetService'

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

let mainWindow: BrowserWindow | null = null
let floatWindow: BrowserWindow | null = null

const isDev = !app.isPackaged

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:33445#/main')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'main' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

function createFloatWindow() {
  floatWindow = new BrowserWindow({
    width: 650,
    height: 500,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (isDev) {
    floatWindow.loadURL('http://localhost:33445#/float')
  } else {
    floatWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'float' })
  }

  floatWindow.on('blur', () => {
    floatWindow?.hide()
  })

  floatWindow.on('closed', () => {
    floatWindow = null
  })
}

function positionFloatWindow() {
  if (!floatWindow) return

  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint({ x: cursorPoint.x, y: cursorPoint.y })
  const workArea = display.workArea

  const windowWidth = 650
  const windowHeight = 500

  const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2)
  const y = Math.floor(workArea.y + (workArea.height - windowHeight) / 3)

  floatWindow.setPosition(x, y)
}

function registerShortcuts() {
  const shortcut = db.getSetting('shortcut') || 'CmdOrCtrl+Shift+V'

  globalShortcut.register(shortcut, () => {
    if (floatWindow?.isVisible()) {
      floatWindow.hide()
    } else {
      positionFloatWindow()
      floatWindow?.show()
      floatWindow?.focus()
      floatWindow?.webContents.send('float:focus-search')
    }
  })
}

async function initServices() {
  db.init()
  imageStore.init()
  syncService.init()
  snippetService.setDeviceId(syncService.getDeviceId())

  const enableSync = db.getSetting('enableSync') === 'true'
  if (enableSync) {
    const port = parseInt(db.getSetting('syncPort') || '8972', 10)
    await syncService.enable(port)
  }

  clipboardMonitor.start()
  scheduler.start()
}

app.whenReady().then(async () => {
  await initServices()

  createMainWindow()
  createFloatWindow()

  if (mainWindow && floatWindow) {
    trayManager.setWindows(mainWindow, floatWindow)
    trayManager.create()
    setupIpcHandlers(mainWindow, floatWindow)
  }

  registerShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
  }
})

app.on('before-quit', async () => {
  globalShortcut.unregisterAll()
  clipboardMonitor.stop()
  scheduler.stop()
  syncService.disable()
  await ocrService.terminate()
  db.close()
  trayManager.destroy()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
