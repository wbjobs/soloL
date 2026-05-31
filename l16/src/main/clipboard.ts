import { clipboard, nativeImage } from 'electron'
import crypto from 'crypto'
import { db } from './database'
import { ocrService } from './ocr'
import { imageStore } from './imageStore'
import type { ClipboardContent, ClipboardItem } from '../types'

class ClipboardMonitor {
  private lastHash: string = ''
  private interval: NodeJS.Timeout | null = null
  private isProcessing: boolean = false
  private onNewItemCallback: ((item: ClipboardItem) => void) | null = null

  start(pollInterval: number = 500) {
    this.interval = setInterval(() => {
      if (!this.isProcessing) {
        this.checkClipboard()
      }
    }, pollInterval)
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  setOnNewItemCallback(callback: (item: ClipboardItem) => void) {
    this.onNewItemCallback = callback
  }

  private async checkClipboard() {
    this.isProcessing = true
    try {
      const content = this.readClipboard()
      if (!content) return

      const hash = this.computeHash(content)
      if (hash === this.lastHash) return

      this.lastHash = hash
      await this.processContent(content)
    } catch (error) {
      console.error('Clipboard check error:', error)
    } finally {
      this.isProcessing = false
    }
  }

  private readClipboard(): ClipboardContent | null {
    const formats = clipboard.availableFormats()

    if (formats.some(f => f.startsWith('image/')) || formats.includes('image/png') || formats.includes('image/jpeg')) {
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        return {
          type: 'image',
          imageBuffer: image.toPNG()
        }
      }
    }

    const files = clipboard.read('text/uri-list')
    if (files) {
      const filePaths = files.split('\r\n').filter(f => f.trim())
      if (filePaths.length > 0 && filePaths[0].startsWith('file://')) {
        return {
          type: 'file',
          content: filePaths.map(f => f.replace('file:///', '').replace('file://', '')).join('\n')
        }
      }
    }

    const text = clipboard.readText()
    if (text && text.trim()) {
      return {
        type: 'text',
        content: text
      }
    }

    return null
  }

  private computeHash(content: ClipboardContent): string {
    const data = content.type === 'image' && content.imageBuffer
      ? content.imageBuffer
      : Buffer.from(content.content || '')

    return crypto.createHash('md5').update(data).digest('hex')
  }

  private async processContent(content: ClipboardContent) {
    let imagePath: string | undefined

    if (content.type === 'image' && content.imageBuffer) {
      const result = await imageStore.saveImage(content.imageBuffer)
      imagePath = result.filePath
    }

    const id = db.insertClipboardItem({
      type: content.type,
      content: content.content,
      imagePath: imagePath,
      isFavorite: false
    })

    if (content.type === 'image' && imagePath) {
      const enableOcr = db.getSetting('enableOcr')
      if (enableOcr !== 'false') {
        setImmediate(() => {
          ocrService.recognize(id, imagePath)
        })
      }
    }

    const maxRecords = parseInt(db.getSetting('maxRecords') || '10000', 10)
    db.cleanOldRecords(maxRecords)

    const item = db.getClipboardById(id)
    if (item && this.onNewItemCallback) {
      this.onNewItemCallback(item)
    }
  }

  copyToClipboard(item: ClipboardItem): boolean {
    try {
      if (item.type === 'text') {
        clipboard.writeText(item.content || '')
      } else if (item.type === 'image' && item.imagePath) {
        const imageBuffer = imageStore.getImageBuffer(item.imagePath)
        if (imageBuffer) {
          const image = nativeImage.createFromBuffer(imageBuffer)
          clipboard.writeImage(image)
        }
      } else if (item.type === 'file') {
        clipboard.writeText(item.content || '')
      }

      this.lastHash = item.type === 'image' && item.imagePath
        ? this.lastHash
        : crypto.createHash('md5').update(item.content || '').digest('hex')

      return true
    } catch (error) {
      console.error('Copy to clipboard error:', error)
      return false
    }
  }
}

export const clipboardMonitor = new ClipboardMonitor()
