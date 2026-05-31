import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import crypto from 'crypto'

class ImageStoreService {
  private imagesDir: string = ''

  init() {
    this.imagesDir = path.join(app.getPath('userData'), 'images')
    if (!fs.existsSync(this.imagesDir)) {
      fs.mkdirSync(this.imagesDir, { recursive: true })
    }
  }

  async saveImage(imageBuffer: Buffer): Promise<{ filePath: string; hash: string }> {
    const hash = crypto.createHash('md5').update(imageBuffer).digest('hex')
    
    const ext = 'webp'
    const fileName = `${hash}.${ext}`
    const filePath = path.join(this.imagesDir, fileName)

    if (fs.existsSync(filePath)) {
      return { filePath, hash }
    }

    try {
      await sharp(imageBuffer)
        .resize({
          width: 1920,
          height: 1080,
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: 80 })
        .toFile(filePath)

      return { filePath, hash }
    } catch (error) {
      console.error('Image compression error:', error)
      fs.writeFileSync(filePath, imageBuffer)
      return { filePath, hash }
    }
  }

  getImageBuffer(filePath: string): Buffer | null {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath)
      }
      return null
    } catch (error) {
      console.error('Read image error:', error)
      return null
    }
  }

  deleteImage(filePath: string): boolean {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        return true
      }
      return false
    } catch (error) {
      console.error('Delete image error:', error)
      return false
    }
  }

  cleanupOrphanedImages(validPaths: Set<string>): number {
    try {
      const files = fs.readdirSync(this.imagesDir)
      let deletedCount = 0

      for (const file of files) {
        const filePath = path.join(this.imagesDir, file)
        if (!validPaths.has(filePath)) {
          fs.unlinkSync(filePath)
          deletedCount++
        }
      }

      return deletedCount
    } catch (error) {
      console.error('Cleanup orphaned images error:', error)
      return 0
    }
  }

  getImagesDirSize(): number {
    try {
      let totalSize = 0
      const files = fs.readdirSync(this.imagesDir)

      for (const file of files) {
        const filePath = path.join(this.imagesDir, file)
        const stats = fs.statSync(filePath)
        totalSize += stats.size
      }

      return totalSize
    } catch (error) {
      return 0
    }
  }
}

export const imageStore = new ImageStoreService()
