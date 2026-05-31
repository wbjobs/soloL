export interface Block {
  index: number;
  timestamp: number;
  data: BlockData;
  previousHash: string;
  hash: string;
  nonce: number;
}

export interface BlockData {
  fileId: string;
  fileName: string;
  chunkIndex: number;
  chunkHash: string;
  totalChunks: number;
  transferredAt: number;
  peerId: string;
}

export interface SignalingMessage {
  type:
    | 'register'
    | 'offer'
    | 'answer'
    | 'ice-candidate'
    | 'file-info'
    | 'chunk-status'
    | 'transfer-complete'
    | 'request-status'
    | 'resume-info'
    | 'resume-accepted'
    | 'resume-rejected'
    | 'peer-status-request'
    | 'peer-status-response'
    | 'stats-update';
  from?: string;
  to?: string;
  payload?: any;
  fileId?: string;
}

export interface PeerInfo {
  id: string;
  ws: any;
  connectedAt: number;
}

export interface FileTransferRecord {
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  merkleRoot: string;
  senderId: string;
  receiverId: string;
  completedChunks: number[];
  status: 'pending' | 'in-progress' | 'completed' | 'verified';
  blocks: Block[];
}
