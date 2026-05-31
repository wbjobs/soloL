const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const PORT = process.env.PORT || 8080;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

const clients = new Map();
let hostClient = null;
let viewerCount = 0;

console.log('=== 屏幕共享服务器 ===');
console.log(`服务器正在启动...`);

wss.on('connection', (ws, req) => {
  const clientId = generateClientId();
  const clientInfo = {
    id: clientId,
    type: 'viewer',
    connectedAt: Date.now(),
    lastPing: Date.now(),
    latency: 0,
    ip: req.socket.remoteAddress
  };

  clients.set(clientId, { ws, info: clientInfo });
  viewerCount++;

  console.log(`[连接] 客户端 ${clientId} 已连接 (IP: ${clientInfo.ip})`);
  console.log(`[状态] 当前在线: ${viewerCount} 人`);

  sendToClient(ws, {
    type: 'connected',
    data: {
      clientId,
      viewerCount,
      isHost: false
    }
  });

  broadcastViewerCount();

  ws.on('message', (data) => {
    try {
      if (data.length > 4 && data.slice(0, 4).readUInt32LE(0) > 0) {
        handleFrameData(data, clientId);
        return;
      }

      const message = JSON.parse(data.toString());
      handleMessage(ws, message, clientId);
    } catch (error) {
      console.error(`[错误] 解析消息失败 (${clientId}):`, error.message);
    }
  });

  ws.on('close', () => {
    handleClientDisconnect(clientId);
  });

  ws.on('error', (error) => {
    console.error(`[错误] 客户端 ${clientId} 错误:`, error.message);
  });
});

function handleMessage(ws, message, clientId) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (message.type) {
    case 'register-host':
      handleRegisterHost(ws, clientId, message.data);
      break;
    case 'ping':
      handlePing(ws, message.timestamp, clientId);
      break;
    case 'pong':
      handlePong(message.timestamp, clientId);
      break;
    case 'chat':
      handleChatMessage(message.data, clientId);
      break;
    case 'control':
      handleControlMessage(message.data, clientId);
      break;
    case 'quality':
      handleQualityChange(message.data, clientId);
      break;
    default:
      console.log(`[未知] 收到未知消息类型: ${message.type} (${clientId})`);
  }
}

function handleFrameData(data, clientId) {
  if (!hostClient || clients.get(hostClient)?.id !== clientId) {
    return;
  }

  clients.forEach((client, id) => {
    if (id !== clientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data, { binary: true });
    }
  });
}

function handleRegisterHost(ws, clientId, data) {
  if (hostClient && clients.get(hostClient)) {
    sendToClient(ws, {
      type: 'error',
      data: { message: '已有主机连接' }
    });
    return;
  }

  hostClient = clientId;
  const client = clients.get(clientId);
  if (client) {
    client.info.type = 'host';
    client.info.name = data?.name || '主持人';
  }

  console.log(`[主机] 客户端 ${clientId} 已注册为主机`);

  sendToClient(ws, {
    type: 'host-registered',
    data: {
      clientId,
      viewerCount
    }
  });

  broadcast({
    type: 'system',
    data: {
      message: `${client.info.name} 已开始共享屏幕`,
      timestamp: Date.now()
    }
  });
}

function handlePing(ws, timestamp, clientId) {
  const client = clients.get(clientId);
  if (client) {
    client.info.lastPing = Date.now();
  }

  sendToClient(ws, {
    type: 'pong',
    timestamp: timestamp
  });
}

function handlePong(timestamp, clientId) {
  const client = clients.get(clientId);
  if (client) {
    client.info.latency = Date.now() - timestamp;
  }
}

function handleChatMessage(data, clientId) {
  const client = clients.get(clientId);
  if (!client) return;

  const message = {
    type: 'chat',
    data: {
      sender: client.info.type === 'host' ? 'host' : (data.sender || `观众${clientId.slice(0, 6)}`),
      message: data.message,
      timestamp: Date.now(),
      isHost: client.info.type === 'host'
    }
  };

  console.log(`[聊天] ${message.data.sender}: ${data.message}`);

  clients.forEach((c, id) => {
    if (c.ws.readyState === WebSocket.OPEN) {
      sendToClient(c.ws, message);
    }
  });
}

function handleControlMessage(data, clientId) {
  if (hostClient && hostClient !== clientId) {
    const host = clients.get(hostClient);
    if (host && host.ws.readyState === WebSocket.OPEN) {
      sendToClient(host.ws, {
        type: 'control',
        data: {
          ...data,
          sender: clientId
        }
      });
    }
  }
}

function handleQualityChange(data, clientId) {
  if (hostClient) {
    const host = clients.get(hostClient);
    if (host && host.ws.readyState === WebSocket.OPEN) {
      sendToClient(host.ws, {
        type: 'quality',
        data
      });
    }
  }
}

function handleClientDisconnect(clientId) {
  const client = clients.get(clientId);
  if (!client) return;

  const isHost = client.info.type === 'host';
  const clientName = isHost ? '主机' : `观众${clientId.slice(0, 6)}`;

  clients.delete(clientId);
  viewerCount = clients.size;

  console.log(`[断开] ${clientName} ${clientId} 已断开`);
  console.log(`[状态] 当前在线: ${viewerCount} 人`);

  if (isHost) {
    hostClient = null;
    console.log('[主机] 主机已断开，等待新的主机连接...');
    broadcast({
      type: 'system',
      data: {
        message: '主机已断开连接',
        timestamp: Date.now()
      }
    });
  }

  broadcastViewerCount();
}

function broadcastViewerCount() {
  broadcast({
    type: 'viewer-count',
    data: {
      count: viewerCount,
      hasHost: !!hostClient
    }
  });
}

function broadcast(message) {
  const messageStr = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
    }
  });
}

function sendToClient(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function generateClientId() {
  return 'client_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

setInterval(() => {
  const now = Date.now();
  clients.forEach((client, id) => {
    if (now - client.info.lastPing > 30000) {
      console.log(`[超时] 客户端 ${id} 心跳超时，断开连接`);
      client.ws.terminate();
    }
  });
}, 10000);

setInterval(() => {
  const latencyData = [];
  clients.forEach((client, id) => {
    latencyData.push({
      id,
      type: client.info.type,
      latency: client.info.latency
    });
  });
  
  if (hostClient) {
    const avgLatency = latencyData.length > 0 
      ? Math.round(latencyData.reduce((sum, c) => sum + c.latency, 0) / latencyData.length)
      : 0;
    
    const host = clients.get(hostClient);
    if (host && host.ws.readyState === WebSocket.OPEN) {
      sendToClient(host.ws, {
        type: 'latency',
        data: {
          latency: avgLatency,
          clients: latencyData
        }
      });
    }
  }
}, 2000);

server.listen(PORT, () => {
  console.log(`✅ 服务器已启动`);
  console.log(`📍 监听端口: ${PORT}`);
  console.log(`🔗 WebSocket: ws://localhost:${PORT}`);
  console.log(`🌐 HTTP: http://localhost:${PORT}`);
  console.log('');
  console.log('使用说明:');
  console.log('1. 启动 Electron 客户端: npm start');
  console.log('2. 在客户端中连接 ws://localhost:8080');
  console.log('3. 点击"开始共享"开始屏幕共享');
  console.log('4. 观众可通过浏览器访问 http://localhost:8080 查看');
});
