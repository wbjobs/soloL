export interface BlockchainBlock {
  index: number;
  timestamp: number;
  data: {
    fileId: string;
    fileName: string;
    chunkIndex: number;
    chunkHash: string;
    totalChunks: number;
    transferredAt: number;
    peerId: string;
  };
  previousHash: string;
  hash: string;
  nonce: number;
}

export async function getBlockchain(): Promise<{ chain: BlockchainBlock[]; length: number; valid: boolean }> {
  const res = await fetch('/api/blockchain');
  return res.json();
}

export async function getFileBlocks(fileId: string): Promise<{ fileId: string; blocks: BlockchainBlock[]; count: number }> {
  const res = await fetch(`/api/blockchain/file/${encodeURIComponent(fileId)}`);
  return res.json();
}

export async function getTransfers(): Promise<any[]> {
  const res = await fetch('/api/transfers');
  return res.json();
}

export async function getTransfer(fileId: string): Promise<any> {
  const res = await fetch(`/api/transfers/${encodeURIComponent(fileId)}`);
  return res.json();
}

export async function syncBlockchain(chain: BlockchainBlock[]): Promise<{ success: boolean; currentLength: number }> {
  const res = await fetch('/api/blockchain/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain }),
  });
  return res.json();
}
