import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { setupSignaling, getTransfers, getTransfer } from './signaling';
import { globalBlockchain } from './blockchain';

const app = express();
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

setupSignaling(wss);

app.get('/api/blockchain', (_req, res) => {
  res.json({
    chain: globalBlockchain.getChain(),
    length: globalBlockchain.getChainLength(),
    valid: globalBlockchain.isChainValid(),
  });
});

app.get('/api/blockchain/file/:fileId', (req, res) => {
  const blocks = globalBlockchain.getBlocksByFileId(req.params.fileId);
  res.json({ fileId: req.params.fileId, blocks, count: blocks.length });
});

app.get('/api/transfers', (_req, res) => {
  res.json(getTransfers());
});

app.get('/api/transfers/:fileId', (req, res) => {
  const transfer = getTransfer(req.params.fileId);
  if (transfer) {
    res.json(transfer);
  } else {
    res.status(404).json({ error: 'Transfer not found' });
  }
});

app.post('/api/blockchain/sync', (req, res) => {
  const { chain } = req.body;
  if (!Array.isArray(chain)) {
    res.status(400).json({ error: 'Invalid chain data' });
    return;
  }
  const success = globalBlockchain.mergeChain(chain);
  res.json({ success, currentLength: globalBlockchain.getChainLength() });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), blockchainLength: globalBlockchain.getChainLength() });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`WebSocket path: /ws`);
  console.log(`API endpoints:`);
  console.log(`  GET  /api/blockchain`);
  console.log(`  GET  /api/blockchain/file/:fileId`);
  console.log(`  GET  /api/transfers`);
  console.log(`  GET  /api/transfers/:fileId`);
  console.log(`  POST /api/blockchain/sync`);
  console.log(`  GET  /api/health`);
});
