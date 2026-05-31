import { WebSocket, WebSocketServer } from 'ws';
import { SignalingMessage, PeerInfo, FileTransferRecord, BlockData } from './types';
import { globalBlockchain } from './blockchain';

const peers = new Map<string, PeerInfo>();
const transfers = new Map<string, FileTransferRecord>();

export function setupSignaling(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    let peerId: string = '';

    ws.on('message', (raw: Buffer) => {
      let msg: SignalingMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', payload: 'Invalid message format' }));
        return;
      }

      switch (msg.type) {
        case 'register': {
          peerId = msg.payload?.peerId || generatePeerId();
          peers.set(peerId, { id: peerId, ws, connectedAt: Date.now() });
          ws.send(JSON.stringify({ type: 'registered', payload: { peerId } }));

          const peerList = Array.from(peers.keys()).filter((id) => id !== peerId);
          ws.send(JSON.stringify({ type: 'peer-list', payload: { peers: peerList } }));

          broadcastPeerList(peerId);
          break;
        }

        case 'offer': {
          const target = msg.to;
          if (target && peers.has(target)) {
            peers.get(target)!.ws.send(
              JSON.stringify({ type: 'offer', from: peerId, payload: msg.payload })
            );
          }
          break;
        }

        case 'answer': {
          const target = msg.to;
          if (target && peers.has(target)) {
            peers.get(target)!.ws.send(
              JSON.stringify({ type: 'answer', from: peerId, payload: msg.payload })
            );
          }
          break;
        }

        case 'ice-candidate': {
          const target = msg.to;
          if (target && peers.has(target)) {
            peers.get(target)!.ws.send(
              JSON.stringify({ type: 'ice-candidate', from: peerId, payload: msg.payload })
            );
          }
          break;
        }

        case 'file-info': {
          const fileId = msg.payload?.fileId || generateFileId();
          const existingTransfer = transfers.get(fileId);

          const transfer: FileTransferRecord = {
            fileId,
            fileName: msg.payload?.fileName || 'unknown',
            fileSize: msg.payload?.fileSize || 0,
            totalChunks: msg.payload?.totalChunks || 0,
            merkleRoot: msg.payload?.merkleRoot || '',
            senderId: peerId,
            receiverId: msg.to || '',
            completedChunks: existingTransfer?.completedChunks || [],
            status: existingTransfer?.status || 'pending',
            blocks: existingTransfer?.blocks || [],
          };
          transfers.set(fileId, transfer);

          const target = msg.to;
          if (target && peers.has(target)) {
            peers.get(target)!.ws.send(
              JSON.stringify({
                type: 'file-info',
                from: peerId,
                payload: {
                  fileId,
                  ...msg.payload,
                  completedChunks: transfer.completedChunks,
                },
              })
            );
          }
          break;
        }

        case 'request-status': {
          const target = msg.to;
          if (target && peers.has(target)) {
            peers.get(target)!.ws.send(
              JSON.stringify({
                type: 'request-status',
                from: peerId,
                fileId: msg.fileId,
                payload: msg.payload,
              })
            );
          }
          break;
        }

        case 'resume-info': {
          const target = msg.to;
          if (target && peers.has(target)) {
            peers.get(target)!.ws.send(
              JSON.stringify({
                type: 'resume-info',
                from: peerId,
                fileId: msg.fileId,
                payload: msg.payload,
              })
            );
          }
          break;
        }

        case 'resume-accepted': {
          const target = msg.to;
          if (target && peers.has(target)) {
            peers.get(target)!.ws.send(
              JSON.stringify({
                type: 'resume-accepted',
                from: peerId,
                fileId: msg.fileId,
                payload: msg.payload,
              })
            );
          }
          break;
        }

        case 'resume-rejected': {
          const target = msg.to;
          if (target && peers.has(target)) {
            peers.get(target)!.ws.send(
              JSON.stringify({
                type: 'resume-rejected',
                from: peerId,
                fileId: msg.fileId,
                payload: msg.payload,
              })
            );
          }
          break;
        }

        case 'peer-status-request': {
          const target = msg.to;
          if (target && peers.has(target)) {
            peers.get(target)!.ws.send(
              JSON.stringify({
                type: 'peer-status-request',
                from: peerId,
                payload: msg.payload,
              })
            );
          }
          break;
        }

        case 'peer-status-response': {
          const target = msg.to;
          if (target && peers.has(target)) {
            peers.get(target)!.ws.send(
              JSON.stringify({
                type: 'peer-status-response',
                from: peerId,
                payload: msg.payload,
              })
            );
          }
          break;
        }

        case 'chunk-status': {
          const fileId = msg.fileId || '';
          if (!fileId) break;
          const transfer = transfers.get(fileId);
          if (transfer) {
            const chunkIndex = msg.payload?.chunkIndex;
            if (chunkIndex !== undefined && !transfer.completedChunks.includes(chunkIndex)) {
              transfer.completedChunks.push(chunkIndex);
              transfer.status = 'in-progress';

              const blockData: BlockData = {
                fileId,
                fileName: transfer.fileName,
                chunkIndex,
                chunkHash: msg.payload?.chunkHash || '',
                totalChunks: transfer.totalChunks,
                transferredAt: Date.now(),
                peerId,
              };
              const block = globalBlockchain.addBlock(blockData);
              transfer.blocks.push(block);
            }

            const sender = peers.get(transfer.senderId);
            if (sender) {
              sender.ws.send(
                JSON.stringify({
                  type: 'chunk-ack',
                  fileId,
                  payload: { chunkIndex: msg.payload?.chunkIndex, completedChunks: transfer.completedChunks },
                })
              );
            }
          }
          break;
        }

        case 'transfer-complete': {
          const fileId = msg.fileId || '';
          if (!fileId) break;
          const transfer = transfers.get(fileId);
          if (transfer) {
            transfer.status = 'completed';
            const sender = peers.get(transfer.senderId);
            if (sender) {
              sender.ws.send(
                JSON.stringify({ type: 'transfer-complete', fileId, payload: { verified: true } })
              );
            }
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      if (peerId && peers.has(peerId)) {
        peers.delete(peerId);
        broadcastPeerList(peerId);
      }
    });

    ws.on('error', () => {
      if (peerId && peers.has(peerId)) {
        peers.delete(peerId);
      }
    });
  });
}

function broadcastPeerList(excludeId: string) {
  const peerList = Array.from(peers.keys());
  for (const [id, peer] of peers) {
    if (id !== excludeId) {
      try {
        peer.ws.send(
          JSON.stringify({ type: 'peer-list', payload: { peers: peerList.filter((p) => p !== id) } })
        );
      } catch {}
    }
  }
}

export function getTransfers(): FileTransferRecord[] {
  return Array.from(transfers.values());
}

export function getTransfer(fileId: string): FileTransferRecord | undefined {
  return transfers.get(fileId);
}

function generatePeerId(): string {
  return 'peer_' + Math.random().toString(36).substring(2, 10);
}

function generateFileId(): string {
  return 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}
