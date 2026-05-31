import { transferDb } from './indexedDb';
import { StreamMerkleBuilder } from './merkleTree';

export const CHUNK_SIZE = 1024 * 1024;

export interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  hash: string;
  data: ArrayBuffer;
}

export interface ChunkMetadata {
  index: number;
  start: number;
  end: number;
  hash: string;
}

export interface FilePreparationResult {
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkHashes: string[];
  merkleRoot: string;
}

export async function computeHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function chunkFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<ChunkInfo[]> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  if (file.size > 100 * 1024 * 1024) {
    console.warn(
      `Large file (${(file.size / 1024 / 1024).toFixed(1)} MB) detected. ` +
      `Consider using streamChunkFile() or prepareFileMetadata() for better memory efficiency.`
    );
  }

  const chunks: ChunkInfo[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunk = await getChunkFromFile(file, i);
    chunks.push(chunk);
    if (onProgress) {
      onProgress(Math.round(((i + 1) / totalChunks) * 100));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return chunks;
}

export async function* streamChunkFile(
  file: File,
  onProgress?: (percent: number) => void
): AsyncGenerator<ChunkInfo, void, unknown> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const chunk = await getChunkFromFile(file, i);
    yield chunk;
    if (onProgress) {
      onProgress(Math.round(((i + 1) / totalChunks) * 100));
    }
  }
}

export async function prepareFileMetadata(
  file: File,
  onProgress?: (percent: number) => void
): Promise<FilePreparationResult> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = generateFileId(file);
  const chunkHashes: string[] = [];
  const merkleBuilder = new StreamMerkleBuilder(totalChunks);

  for (let i = 0; i < totalChunks; i++) {
    const hash = await getChunkHashFromFile(file, i);
    chunkHashes.push(hash);
    merkleBuilder.addLeaf(hash);

    if (onProgress) {
      onProgress(Math.round(((i + 1) / totalChunks) * 100));
    }
    await new Promise((r) => setTimeout(r, 0));
  }

  const merkleRoot = merkleBuilder.finalize();

  return {
    fileId,
    fileName: file.name,
    fileSize: file.size,
    totalChunks,
    chunkHashes,
    merkleRoot,
  };
}

export async function getChunkFromFile(file: File, chunkIndex: number): Promise<ChunkInfo> {
  const start = chunkIndex * CHUNK_SIZE;
  if (start >= file.size) {
    throw new Error('Chunk index out of bounds');
  }
  const end = Math.min(start + CHUNK_SIZE, file.size);
  const blob = file.slice(start, end);
  const data = await blob.arrayBuffer();
  const hash = await computeHash(data);
  return { index: chunkIndex, start, end, hash, data };
}

export async function getChunkHashFromFile(file: File, chunkIndex: number): Promise<string> {
  const start = chunkIndex * CHUNK_SIZE;
  if (start >= file.size) {
    throw new Error('Chunk index out of bounds');
  }
  const end = Math.min(start + CHUNK_SIZE, file.size);
  const blob = file.slice(start, end);
  const data = await blob.arrayBuffer();
  return computeHash(data);
}

export async function saveTransferProgress(
  fileId: string,
  completedChunks: number[],
  totalChunks: number
): Promise<void> {
  const existing = await transferDb.getTransfer(fileId);
  if (existing) {
    existing.completedChunks = completedChunks;
    existing.updatedAt = Date.now();
    if (completedChunks.length === totalChunks) {
      existing.status = 'completed';
    } else if (completedChunks.length > 0) {
      existing.status = 'in-progress';
    }
    await transferDb.saveTransfer(existing);
  }
  const key = `transfer_progress_${fileId}`;
  localStorage.setItem(
    key,
    JSON.stringify({ fileId, completedChunks, totalChunks, updatedAt: Date.now() })
  );
}

export async function loadTransferProgress(
  fileId: string
): Promise<{ completedChunks: number[]; totalChunks: number } | null> {
  const dbRecord = await transferDb.getTransfer(fileId);
  if (dbRecord) {
    return {
      completedChunks: dbRecord.completedChunks,
      totalChunks: dbRecord.totalChunks,
    };
  }

  const key = `transfer_progress_${fileId}`;
  const data = localStorage.getItem(key);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function clearTransferProgress(fileId: string): Promise<void> {
  await transferDb.deleteTransfer(fileId);
  localStorage.removeItem(`transfer_progress_${fileId}`);
}

export function generateFileId(file: File): string {
  return `file_${file.name}_${file.size}_${file.lastModified}`;
}

export async function verifyChunkHash(
  file: File,
  chunkIndex: number,
  expectedHash: string
): Promise<boolean> {
  const actualHash = await getChunkHashFromFile(file, chunkIndex);
  return actualHash === expectedHash;
}

export async function verifyChunkDataHash(
  data: ArrayBuffer,
  expectedHash: string
): Promise<boolean> {
  const actualHash = await computeHash(data);
  return actualHash === expectedHash;
}
