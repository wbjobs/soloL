import { WebSocketServer } from 'ws';

const rooms = new Map();
const clientRoomMap = new Map();

const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 60000;

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function sendJson(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function removeClientFromRoom(ws) {
  const roomId = clientRoomMap.get(ws);
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (!room) return;

  room.participants = room.participants.filter((p) => p !== ws);

  room.participants.forEach((p) => {
    sendJson(p, { type: 'peer-left', roomId });
  });

  if (room.participants.length === 0) {
    rooms.delete(roomId);
  }

  clientRoomMap.delete(ws);
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create': {
      let roomId = msg.roomId || generateRoomId();
      while (rooms.has(roomId)) {
        roomId = generateRoomId();
      }

      rooms.set(roomId, {
        id: roomId,
        participants: [ws],
        createdAt: Date.now(),
      });
      clientRoomMap.set(ws, roomId);

      sendJson(ws, { type: 'created', roomId });
      console.log(`[Signaling] Room created: ${roomId}`);
      break;
    }

    case 'join': {
      const roomId = msg.roomId;
      const room = rooms.get(roomId);

      if (!room) {
        sendJson(ws, { type: 'error', message: 'Room not found' });
        return;
      }

      if (room.participants.length >= 2) {
        sendJson(ws, { type: 'error', message: 'Room is full' });
        return;
      }

      room.participants.push(ws);
      clientRoomMap.set(ws, roomId);

      sendJson(ws, { type: 'joined', roomId });

      room.participants.forEach((p) => {
        if (p !== ws) {
          sendJson(p, { type: 'ready', roomId });
        }
      });

      console.log(`[Signaling] Peer joined room: ${roomId}`);
      break;
    }

    case 'offer':
    case 'answer':
    case 'ice-candidate': {
      const roomId = clientRoomMap.get(ws);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      room.participants.forEach((p) => {
        if (p !== ws) {
          sendJson(p, {
            type: msg.type,
            roomId,
            payload: msg.payload,
          });
        }
      });
      break;
    }

    case 'leave': {
      removeClientFromRoom(ws);
      break;
    }
  }
}

function startHeartbeat(ws) {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });
}

export function createSignalingServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    console.log('[Signaling] New WebSocket connection');
    startHeartbeat(ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(ws, msg);
      } catch (e) {
        console.error('[Signaling] Message parse error:', e);
      }
    });

    ws.on('close', () => {
      removeClientFromRoom(ws);
      console.log('[Signaling] WebSocket disconnected');
    });

    ws.on('error', (err) => {
      console.error('[Signaling] WebSocket error:', err);
      removeClientFromRoom(ws);
    });
  });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        removeClientFromRoom(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === '/ws/signaling') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  return wss;
}
