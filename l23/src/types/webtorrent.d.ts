declare module 'webtorrent' {
  export default class WebTorrent {
    constructor(opts?: any)
    add(magnet: string | Buffer, opts?: any, callback?: (torrent: any) => void): any
    seed(input: any, opts?: any, callback?: (torrent: any) => void): any
    remove(infoHash: string, callback?: () => void): void
    destroy(callback?: () => void): void
    torrents: any[]
    on(event: string, callback: (...args: any[]) => void): void
  }
}

interface Window {
  WebTorrent: typeof import('webtorrent').default
}
