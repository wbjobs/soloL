import { Tray, Menu, BrowserWindow, nativeImage, app } from 'electron'
import path from 'path'

class TrayManager {
  private tray: Tray | null = null
  private mainWindow: BrowserWindow | null = null
  private floatWindow: BrowserWindow | null = null

  setWindows(mainWindow: BrowserWindow, floatWindow: BrowserWindow) {
    this.mainWindow = mainWindow
    this.floatWindow = floatWindow
  }

  create() {
    const iconPath = path.join(__dirname, '../../public/icon.png')
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })

    this.tray = new Tray(icon)

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '打开主窗口',
        click: () => {
          this.mainWindow?.show()
          this.mainWindow?.focus()
        }
      },
      {
        label: '快速搜索',
        click: () => {
          this.floatWindow?.show()
          this.floatWindow?.focus()
        }
      },
      { type: 'separator' },
      {
        label: '开机自启',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (menuItem) => {
          app.setLoginItemSettings({
            openAtLogin: menuItem.checked
          })
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.quit()
        }
      }
    ])

    this.tray.setToolTip('ClipMaster - 智能剪贴板管理器')
    this.tray.setContextMenu(contextMenu)

    this.tray.on('click', () => {
      this.mainWindow?.show()
      this.mainWindow?.focus()
    })
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }
}

export const trayManager = new TrayManager()
