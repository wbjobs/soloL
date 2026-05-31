import crypto from 'crypto'
import { db } from './database'
import type { Snippet, ClipboardItem, SnippetItem } from '../types'

export type PasteFormat = 'auto' | 'markdown' | 'code' | 'plain'

class SnippetService {
  private deviceId: string = ''

  setDeviceId(id: string) {
    this.deviceId = id
  }

  createSnippetFromItems(
    name: string,
    description: string | undefined,
    items: ClipboardItem[]
  ): Snippet | null {
    const id = crypto.randomUUID()

    const snippetItems: SnippetItem[] = items.map((item, index) => ({
      id: crypto.randomUUID(),
      type: item.type,
      content: item.content,
      imagePath: item.imagePath,
      order: index
    }))

    const snippet: Omit<Snippet, 'createdAt' | 'updatedAt'> = {
      id,
      name,
      description,
      items: snippetItems,
      version: 1,
      lastModifiedBy: this.deviceId
    }

    return db.insertSnippet(snippet, this.deviceId)
  }

  updateSnippet(snippet: Omit<Snippet, 'createdAt' | 'updatedAt'>): Snippet | null {
    return db.updateSnippet(snippet, this.deviceId)
  }

  getSnippet(id: string): Snippet | null {
    return db.getSnippetById(id)
  }

  getAllSnippets(): Snippet[] {
    return db.getAllSnippets()
  }

  deleteSnippet(id: string): boolean {
    return db.deleteSnippet(id)
  }

  reorderItems(snippetId: string, itemOrders: { itemId: string; order: number }[]): Snippet | null {
    const snippet = db.getSnippetById(snippetId)
    if (!snippet) return null

    const updatedItems = snippet.items.map(item => {
      const newOrder = itemOrders.find(o => o.itemId === item.id)
      if (newOrder !== undefined) {
        return { ...item, order: newOrder.order }
      }
      return item
    }).sort((a, b) => a.order - b.order)

    const updatedSnippet: Omit<Snippet, 'createdAt' | 'updatedAt'> = {
      ...snippet,
      items: updatedItems
    }

    return db.updateSnippet(updatedSnippet, this.deviceId)
  }

  exportToMarkdown(snippet: Snippet): string {
    let markdown = `# ${snippet.name}\n\n`

    if (snippet.description) {
      markdown += `${snippet.description}\n\n`
    }

    snippet.items.forEach((item, index) => {
      if (item.type === 'text') {
        const content = item.content || ''
        const isCode = this.looksLikeCode(content)
        
        if (isCode) {
          const lang = this.detectLanguage(content)
          markdown += `\`\`\`${lang}\n${content}\n\`\`\`\n\n`
        } else {
          markdown += `${content}\n\n`
        }
      } else if (item.type === 'image' && item.imagePath) {
        markdown += `![Image ${index + 1}](${item.imagePath})\n\n`
      } else if (item.type === 'file') {
        const files = (item.content || '').split('\n')
        files.forEach(file => {
          markdown += `- \`${file}\`\n`
        })
        markdown += '\n'
      }
    })

    markdown += `---\n*导出时间: ${new Date().toLocaleString()}*\n`

    return markdown
  }

  private looksLikeCode(text: string): boolean {
    const codePatterns = [
      /^\s*(function|class|const|let|var|import|export|if|for|while|def|fn|pub|struct|impl)/m,
      /[\{\}\[\]\(\);]\s*$/,
      /^\s*\/\//m,
      /^\s*#\s*(include|define|if|endif)/m,
      /^\s*def\s+\w+\s*\(/m,
      /^\s*fn\s+\w+\s*\(/m,
      /^\s*public\s+(static\s+)?(void|string|int|bool|class)\s+\w+/m
    ]

    return codePatterns.some(pattern => pattern.test(text))
  }

  private detectLanguage(text: string): string {
    if (/^\s*(function|const|let|var|import|export|=>)\s/.test(text)) return 'javascript'
    if (/^\s*(def|class\s+\w+|if\s+__name__)/.test(text)) return 'python'
    if (/^\s*(fn|struct|impl|pub\s+fn|use\s+)/.test(text)) return 'rust'
    if (/^\s*<(\?xml|!DOCTYPE|html|div|span|table)/.test(text)) return 'html'
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\s+/i.test(text)) return 'sql'
    if (/^\s*(package|import\s+java|public\s+class)/.test(text)) return 'java'
    if (/^\s*#include|^\s*#define/.test(text)) return 'cpp'
    if (/^\s*using\s+System|^\s*namespace\s+\w+/.test(text)) return 'csharp'
    return ''
  }

  formatForSmartPaste(snippet: Snippet, windowTitle: string): string {
    const appType = this.detectAppType(windowTitle)

    if (appType === 'vscode') {
      return this.formatForVSCode(snippet)
    } else if (appType === 'word') {
      return this.formatForWord(snippet)
    } else if (appType === 'markdown') {
      return this.exportToMarkdown(snippet)
    }

    return this.formatPlainText(snippet)
  }

  private detectAppType(windowTitle: string): 'vscode' | 'word' | 'markdown' | 'other' {
    const lowerTitle = windowTitle.toLowerCase()

    if (lowerTitle.includes('visual studio code') ||
        lowerTitle.includes('vscode') ||
        lowerTitle.includes(' - code')) {
      return 'vscode'
    }

    if (lowerTitle.includes('word') ||
        lowerTitle.includes('.doc') ||
        lowerTitle.includes('microsoft word')) {
      return 'word'
    }

    if (lowerTitle.includes('.md') ||
        lowerTitle.includes('markdown') ||
        lowerTitle.includes('obsidian') ||
        lowerTitle.includes('notion')) {
      return 'markdown'
    }

    return 'other'
  }

  private formatForVSCode(snippet: Snippet): string {
    const textItems = snippet.items.filter(i => i.type === 'text')

    if (textItems.length === 1) {
      const content = textItems[0].content || ''
      if (this.looksLikeCode(content)) {
        return content
      }
    }

    const allText = textItems.map(i => i.content || '').join('\n\n')
    if (this.looksLikeCode(allText)) {
      return allText
    }

    return this.formatPlainText(snippet)
  }

  private formatForWord(snippet: Snippet): string {
    return this.formatPlainText(snippet)
  }

  private formatPlainText(snippet: Snippet): string {
    return snippet.items
      .filter(i => i.type === 'text' || i.type === 'file')
      .map(i => i.content || '')
      .filter(c => c.trim())
      .join('\n\n')
  }
}

export const snippetService = new SnippetService()
