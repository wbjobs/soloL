export type ClipboardType = 'text' | 'image' | 'file'

export interface ClipboardItem {
  id?: number
  type: ClipboardType
  content?: string
  imagePath?: string
  ocrText?: string
  isFavorite?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface ClipboardContent {
  type: ClipboardType
  content?: string
  imageBuffer?: Buffer
}

export interface SnippetItem {
  id: string
  type: ClipboardType
  content?: string
  imagePath?: string
  order: number
}

export interface Snippet {
  id: string
  name: string
  description?: string
  items: SnippetItem[]
  createdAt: string
  updatedAt: string
  lastModifiedBy?: string
  version: number
}

export interface PeerInfo {
  id?: number
  deviceId: string
  deviceName: string
  ipAddress: string
  port: number
  isOnline?: boolean
  lastSync?: string
}

export interface Settings {
  maxRecords: number
  autoStart: boolean
  shortcut: string
  enableOcr: boolean
  enableSync: boolean
  syncPort: number
  theme: 'dark' | 'light'
}

export interface SyncMessage {
  type: 'hello' | 'sync-request' | 'sync-data' | 'new-item' | 'new-snippet' | 'update-snippet' | 'delete-snippet' | 'ack'
  deviceId: string
  deviceName: string
  payload?: any
  timestamp: number
}
