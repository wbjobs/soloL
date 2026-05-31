export interface MerkleProofStep {
  hash: string;
  position: 'left' | 'right';
}

export class MerkleTree {
  private leaves: string[];
  private tree: string[][];
  private isComplete: boolean;
  private totalExpectedLeaves: number;

  constructor(totalExpectedLeaves: number = 0, precomputedHashes: string[] = []) {
    this.leaves = precomputedHashes.slice();
    this.tree = [];
    this.isComplete = precomputedHashes.length > 0 && totalExpectedLeaves === precomputedHashes.length;
    this.totalExpectedLeaves = totalExpectedLeaves || precomputedHashes.length;

    if (this.isComplete && this.leaves.length > 0) {
      this.tree = this.buildFullTree();
    }
  }

  addLeaf(hash: string): void {
    if (this.isComplete) {
      throw new Error('Merkle tree is already complete, cannot add more leaves');
    }
    this.leaves.push(hash);
    if (this.leaves.length === this.totalExpectedLeaves) {
      this.finalize();
    }
  }

  addLeaves(hashes: string[]): void {
    if (this.isComplete) {
      throw new Error('Merkle tree is already complete, cannot add more leaves');
    }
    this.leaves.push(...hashes);
    if (this.leaves.length === this.totalExpectedLeaves) {
      this.finalize();
    }
  }

  finalize(): void {
    if (this.isComplete) return;
    if (this.leaves.length === 0) {
      this.leaves = ['0'.repeat(64)];
    }
    this.totalExpectedLeaves = this.leaves.length;
    this.tree = this.buildFullTree();
    this.isComplete = true;
  }

  private hashString(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(16, '0');
    return hex + hex + hex + hex;
  }

  private buildFullTree(): string[][] {
    if (this.leaves.length === 0) {
      return [['0'.repeat(64)]];
    }

    const levels: string[][] = [this.leaves.slice()];
    let currentLevel = this.leaves.slice();

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        const combined = left + right;
        const hash = this.hashString(combined);
        nextLevel.push(hash);
      }
      levels.push(nextLevel);
      currentLevel = nextLevel;
    }

    return levels;
  }

  getRoot(): string {
    if (!this.isComplete || this.tree.length === 0) {
      throw new Error('Merkle tree is not complete yet, call finalize() first');
    }
    const lastLevel = this.tree[this.tree.length - 1];
    return lastLevel[0];
  }

  getLeafCount(): number {
    return this.leaves.length;
  }

  getTotalExpectedLeaves(): number {
    return this.totalExpectedLeaves;
  }

  complete(): boolean {
    return this.isComplete;
  }

  getProof(index: number): MerkleProofStep[] {
    if (!this.isComplete) {
      throw new Error('Merkle tree is not complete yet, call finalize() first');
    }
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`Invalid leaf index: ${index}`);
    }

    const proof: MerkleProofStep[] = [];
    let currentIndex = index;

    for (let level = 0; level < this.tree.length - 1; level++) {
      const currentLevel = this.tree[level];
      const isRight = currentIndex % 2 === 0;
      const siblingIndex = isRight ? currentIndex + 1 : currentIndex - 1;

      if (siblingIndex < currentLevel.length) {
        proof.push({
          hash: currentLevel[siblingIndex],
          position: isRight ? 'right' : 'left',
        });
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  }

  verifyProof(leafHash: string, index: number, root: string): boolean {
    if (!this.isComplete) {
      throw new Error('Merkle tree is not complete yet, call finalize() first');
    }
    const proof = this.getProof(index);
    return MerkleTree.verifyStaticProof(leafHash, proof, root, this.hashString);
  }

  getLeafHash(index: number): string | undefined {
    return this.leaves[index];
  }

  getLeaves(): string[] {
    return this.leaves.slice();
  }

  getTree(): string[][] {
    return this.tree.map((level) => level.slice());
  }

  static verifyStaticProof(
    leafHash: string,
    proof: MerkleProofStep[],
    root: string,
    hashFn: (input: string) => string
  ): boolean {
    let currentHash = leafHash;
    for (const step of proof) {
      if (step.position === 'right') {
        currentHash = hashFn(currentHash + step.hash);
      } else {
        currentHash = hashFn(step.hash + currentHash);
      }
    }
    return currentHash === root;
  }

  static simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(16, '0');
    return hex + hex + hex + hex;
  }
}

export class StreamMerkleBuilder {
  private leafCount: number = 0;
  private totalExpected: number;
  private levels: string[][] = [];

  constructor(totalExpectedLeaves: number) {
    this.totalExpected = totalExpectedLeaves;
  }

  addLeaf(hash: string): void {
    this.leafCount++;

    if (this.leafCount > this.totalExpected) {
      throw new Error('Added more leaves than expected');
    }

    let currentHash = hash;
    let currentDepth = 0;

    while (true) {
      if (this.levels.length <= currentDepth) {
        this.levels.push([]);
      }

      const level = this.levels[currentDepth];
      level.push(currentHash);

      if (level.length % 2 === 0) {
        const left = level[level.length - 2];
        const right = level[level.length - 1];
        currentHash = MerkleTree.simpleHash(left + right);
        level.length = 0;
        currentDepth++;
      } else {
        break;
      }
    }
  }

  finalize(): string {
    let root: string | null = null;

    for (let depth = 0; depth < this.levels.length; depth++) {
      const level = this.levels[depth];

      if (level.length === 0) continue;

      if (level.length % 2 === 1 && depth < this.levels.length - 1) {
        level.push(level[level.length - 1]);
      }

      if (level.length === 1) {
        root = level[0];
        break;
      }

      let carry: string | null = null;
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        const parent = MerkleTree.simpleHash(left + right);

        if (carry === null) {
          if (this.levels.length <= depth + 1) {
            this.levels.push([]);
          }
          this.levels[depth + 1].push(parent);
        } else {
          const combined = MerkleTree.simpleHash(carry + parent);
          if (this.levels.length <= depth + 1) {
            this.levels.push([]);
          }
          this.levels[depth + 1].push(combined);
          carry = null;
        }
      }

      if (this.levels[depth + 1].length === 1) {
        root = this.levels[depth + 1][0];
        break;
      }

      level.length = 0;
    }

    while (this.levels.length > 0 && this.levels[this.levels.length - 1].length === 0) {
      this.levels.pop();
    }

    if (this.levels.length === 0 && root === null) {
      return '0'.repeat(64);
    }

    while (this.levels.length > 1 || (this.levels.length === 1 && this.levels[0].length > 1)) {
      const topDepth = this.levels.length - 1;
      const topLevel = this.levels[topDepth];

      if (topLevel.length === 1) {
        root = topLevel[0];
        break;
      }

      if (topLevel.length % 2 === 1) {
        topLevel.push(topLevel[topLevel.length - 1]);
      }

      const nextLevel: string[] = [];
      for (let i = 0; i < topLevel.length; i += 2) {
        nextLevel.push(MerkleTree.simpleHash(topLevel[i] + topLevel[i + 1]));
      }

      this.levels[topDepth] = nextLevel;

      if (nextLevel.length === 1) {
        root = nextLevel[0];
        break;
      }
    }

    return root || this.levels[0]?.[0] || '0'.repeat(64);
  }

  getLeafCount(): number {
    return this.leafCount;
  }
}

export async function buildMerkleTreeFromHashes(hashes: string[]): Promise<MerkleTree> {
  return new MerkleTree(hashes.length, hashes);
}

export async function buildMerkleRootFromHashes(hashes: string[]): Promise<string> {
  const builder = new StreamMerkleBuilder(hashes.length);
  for (const hash of hashes) {
    builder.addLeaf(hash);
  }
  return builder.finalize();
}

export async function buildMerkleTreeIncremental(
  totalChunks: number,
  onProgress?: (processed: number, total: number) => void
): Promise<{
  addHash: (hash: string) => void;
  finalize: () => Promise<MerkleTree>;
  getHashes: () => string[];
}> {
  const hashes: string[] = [];
  const tree = new MerkleTree(totalChunks);

  return {
    addHash: (hash: string) => {
      hashes.push(hash);
      tree.addLeaf(hash);
      onProgress?.(hashes.length, totalChunks);
    },
    finalize: async (): Promise<MerkleTree> => {
      tree.finalize();
      return tree;
    },
    getHashes: () => hashes.slice(),
  };
}
