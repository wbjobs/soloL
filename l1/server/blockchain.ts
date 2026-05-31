import crypto from 'crypto';
import { Block, BlockData } from './types';

export class Blockchain {
  private chain: Block[] = [];
  private pendingBlocks: Block[] = [];

  constructor() {
    this.chain.push(this.createGenesisBlock());
  }

  private createGenesisBlock(): Block {
    const data: BlockData = {
      fileId: '',
      fileName: 'Genesis Block',
      chunkIndex: -1,
      chunkHash: '',
      totalChunks: 0,
      transferredAt: 0,
      peerId: '',
    };
    const block: Block = {
      index: 0,
      timestamp: Date.now(),
      data,
      previousHash: '0'.repeat(64),
      hash: '',
      nonce: 0,
    };
    block.hash = this.calculateHash(block);
    return block;
  }

  calculateHash(block: Block): string {
    const dataStr = JSON.stringify(block.data);
    const input = `${block.index}${block.timestamp}${dataStr}${block.previousHash}${block.nonce}`;
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  mineBlock(block: Block, difficulty: number = 2): Block {
    const target = '0'.repeat(difficulty);
    while (block.hash.substring(0, difficulty) !== target) {
      block.nonce++;
      block.hash = this.calculateHash(block);
    }
    return block;
  }

  addBlock(data: BlockData): Block {
    const latestBlock = this.getLatestBlock();
    const newBlock: Block = {
      index: this.chain.length,
      timestamp: Date.now(),
      data,
      previousHash: latestBlock.hash,
      hash: '',
      nonce: 0,
    };
    newBlock.hash = this.calculateHash(newBlock);
    const minedBlock = this.mineBlock(newBlock);
    this.chain.push(minedBlock);
    return minedBlock;
  }

  isChainValid(): boolean {
    for (let i = 1; i < this.chain.length; i++) {
      const current = this.chain[i];
      const previous = this.chain[i - 1];

      if (current.hash !== this.calculateHash(current)) {
        return false;
      }
      if (current.previousHash !== previous.hash) {
        return false;
      }
    }
    return true;
  }

  getChain(): Block[] {
    return [...this.chain];
  }

  getBlocksByFileId(fileId: string): Block[] {
    return this.chain.filter((b) => b.data.fileId === fileId);
  }

  mergeChain(incomingChain: Block[]): boolean {
    if (incomingChain.length <= this.chain.length) {
      return false;
    }

    for (let i = 1; i < incomingChain.length; i++) {
      const current = incomingChain[i];
      const previous = incomingChain[i - 1];
      if (current.hash !== this.calculateHash(current)) {
        return false;
      }
      if (current.previousHash !== previous.hash) {
        return false;
      }
    }

    this.chain = [...incomingChain];
    return true;
  }

  getChainLength(): number {
    return this.chain.length;
  }
}

export const globalBlockchain = new Blockchain();
