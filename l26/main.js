const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable, Writable } = require('stream');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();

let mainWindow = null;
let isSharing = false;
let captureInterval = null;
let currentFps = 30;
let targetFps = 30;
let selectedDisplay = null;
let selectedWindow = null;
let captureRegion = null;
let wsClient = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let lastFrameTime = 0;
let frameCount = 0;
let actualFps = 0;
let networkLatency = 0;
let quality = 80;
let resolutionScale = 1.0;

const MIN_FPS = 10;
const MAX_FPS = 30;
const FPS_ADJUST_THRESHOLD = 500;
const LATENCY_HIGH_THRESHOLD = 200;
const LATENCY_LOW_THRESHOLD = 80;
const MAX_QUEUE_SIZE = 3;

let frameQueue = [];
let isProcessing = false;
let droppedFrames = 0;
let lastGcHint = 0;
let lastCaptureBuffer = null;

let remoteControlEnabled = true;
let controlPermissionBanned = false;
let bannedUntil = 0;
let db = null;
let robot = null;
let iohook = null;

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'control_audit.db');
  console.log('审计数据库路径:', dbPath);
  
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('数据库初始化失败:', err);
    } else {
      console.log('审计数据库初始化成功');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS input_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    type TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    client_id TEXT,
    client_ip TEXT,
    allowed INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS permission_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    reason TEXT,
    duration INTEGER
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_input_logs_timestamp ON input_logs(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_input_logs_type ON input_logs(type)`);
}

function logInputAction(type, action, details, clientId, allowed) {
  if (!db) return;
  
  const stmt = db.prepare(`INSERT INTO input_logs 
    (timestamp, type, action, details, client_id, allowed) 
    VALUES (?, ?, ?, ?, ?, ?)`);
  
  stmt.run(
    Date.now(),
    type,
    action,
    details ? JSON.stringify(details) : null,
    clientId || null,
    allowed ? 1 : 0
  );
  
  stmt.finalize();
}

function logPermissionEvent(eventType, reason, duration) {
  if (!db) return;
  
  const stmt = db.prepare(`INSERT INTO permission_events 
    (timestamp, event_type, reason, duration) 
    VALUES (?, ?, ?, ?)`);
  
  stmt.run(Date.now(), eventType, reason || null, duration || null);
  stmt.finalize();
}

function getAuditLogs(limit = 100) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('数据库未初始化'));
      return;
    }
    
    db.all(`SELECT * FROM input_logs ORDER BY timestamp DESC LIMIT ?`, [limit], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function toggleRemoteControl(enabled, reason = 'manual', duration = 0) {
  remoteControlEnabled = enabled;
  
  if (!enabled && duration > 0) {
    controlPermissionBanned = true;
    bannedUntil = Date.now() + duration;
    
    setTimeout(() => {
      controlPermissionBanned = false;
      remoteControlEnabled = true;
      sendToRenderer('control-permission-changed', { enabled: true, reason: 'auto_unban' });
      logPermissionEvent('auto_enable', '临时禁用超时解除', null);
    }, duration);
  } else {
    controlPermissionBanned = false;
    bannedUntil = 0;
  }
  
  sendToRenderer('control-permission-changed', { 
    enabled: remoteControlEnabled, 
    reason,
    bannedUntil
  });
  
  logPermissionEvent(enabled ? 'enable' : 'disable', reason, duration);
  console.log(`远程控制${enabled ? '启用' : '禁用'}, 原因: ${reason}`);
}

function loadRobotJs() {
  try {
    robot = require('robotjs');
    console.log('robotjs 加载成功，远程控制功能可用');
    return true;
  } catch (e) {
    console.warn('robotjs 未安装或加载失败，远程控制功能不可用:', e.message);
    return false;
  }
}

function setupGlobalHotkeys() {
  try {
    const f12Registered = globalShortcut.register('F12', () => {
      if (controlPermissionBanned) {
        controlPermissionBanned = false;
        remoteControlEnabled = true;
        bannedUntil = 0;
        sendToRenderer('control-permission-changed', { 
          enabled: true, 
          reason: 'F12_manual_enable',
          bannedUntil: 0
        });
        logPermissionEvent('enable', 'F12 手动启用', null);
        console.log('F12 按下 - 远程控制已启用');
      } else {
        toggleRemoteControl(false, 'F12_emergency_stop', 0);
        console.log('F12 按下 - 远程控制已禁用');
      }
    });

    if (!f12Registered) {
      console.warn('F12 快捷键注册失败');
    }

    const f11Registered = globalShortcut.register('F11', () => {
      toggleRemoteControl(true, 'F11_manual_enable', 0);
      console.log('F11 按下 - 远程控制已启用');
    });

  } catch (error) {
    console.error('全局快捷键注册失败:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    stopSharing();
    disconnectWebSocket();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  initDatabase();
  loadRobotJs();
  setupGlobalHotkeys();
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (db) {
    db.close();
  }
});

app.on('window-all-closed', () => {
  stopSharing();
  disconnectWebSocket();
  if (process.platform !== 'darwin') app.quit();
});

function connectWebSocket(serverUrl) {
  return new Promise((resolve, reject) => {
    try {
      wsClient = new WebSocket(serverUrl);
      
      wsClient.on('open', () => {
        console.log('WebSocket 连接成功');
        reconnectAttempts = 0;
        sendToRenderer('websocket-connected', { url: serverUrl });
        resolve();
      });

      wsClient.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleWebSocketMessage(message);
        } catch (e) {
          if (data.toString().includes('pong')) {
            const timestamp = parseInt(data.toString().split(':')[1]);
            networkLatency = Date.now() - timestamp;
            adjustFpsBasedOnNetwork();
          }
        }
      });

      wsClient.on('close', () => {
        console.log('WebSocket 连接关闭');
        sendToRenderer('websocket-disconnected', {});
        if (isSharing && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          console.log(`尝试重连 (${reconnectAttempts}/${maxReconnectAttempts})...`);
          setTimeout(() => connectWebSocket(serverUrl), 2000);
        }
      });

      wsClient.on('error', (error) => {
        console.error('WebSocket 错误:', error);
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function disconnectWebSocket() {
  if (wsClient) {
    wsClient.close();
    wsClient = null;
  }
}

function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'chat':
      sendToRenderer('chat-message', message.data);
      break;
    case 'control':
      handleRemoteControl(message.data);
      break;
    case 'quality':
      quality = message.data.quality || quality;
      resolutionScale = message.data.scale || resolutionScale;
      break;
    case 'latency':
      networkLatency = message.data.latency || networkLatency;
      adjustFpsBasedOnNetwork();
      break;
    case 'control-request':
      sendToRenderer('control-request', message.data);
      break;
  }
}

function adjustFpsBasedOnNetwork() {
  if (networkLatency > LATENCY_HIGH_THRESHOLD && targetFps > MIN_FPS) {
    targetFps = Math.max(MIN_FPS, targetFps - 5);
    console.log(`网络延迟高 (${networkLatency}ms)，降低帧率到 ${targetFps}fps`);
    sendToRenderer('fps-changed', { fps: targetFps, reason: 'high_latency', latency: networkLatency });
  } else if (networkLatency < LATENCY_LOW_THRESHOLD && targetFps < MAX_FPS) {
    targetFps = Math.min(MAX_FPS, targetFps + 5);
    console.log(`网络延迟低 (${networkLatency}ms)，提升帧率到 ${targetFps}fps`);
    sendToRenderer('fps-changed', { fps: targetFps, reason: 'low_latency', latency: networkLatency });
  }
  
  if (currentFps !== targetFps) {
    restartCaptureInterval();
  }
}

function restartCaptureInterval() {
  if (captureInterval) {
    clearInterval(captureInterval);
  }
  currentFps = targetFps;
  const intervalMs = Math.floor(1000 / currentFps);
  captureInterval = setInterval(scheduleCapture, intervalMs);
  console.log(`帧率已调整为 ${currentFps}fps，间隔 ${intervalMs}ms`);
}

async function getDisplays() {
  const displays = screen.getAllDisplays();
  return displays.map((display, index) => ({
    id: display.id,
    name: `显示器 ${index + 1}`,
    label: display.label || `显示器 ${index + 1}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    isPrimary: display.id === screen.getPrimaryDisplay().id
  }));
}

async function getWindows() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 320, height: 240 }
    });
    
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      display_id: source.display_id,
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
      thumbnail: source.thumbnail.toDataURL()
    })).filter(w => w.name && w.name.length > 0);
  } catch (error) {
    console.error('获取窗口列表失败:', error);
    return [];
  }
}

function scheduleCapture() {
  if (!isSharing) return;

  if (frameQueue.length >= MAX_QUEUE_SIZE) {
    droppedFrames++;
    if (droppedFrames % 100 === 0) {
      console.warn(`已丢弃 ${droppedFrames} 帧 (队列满)`);
    }
    return;
  }

  frameQueue.push({ timestamp: Date.now() });

  if (!isProcessing) {
    processNextFrame();
  }
}

async function processNextFrame() {
  if (isProcessing || frameQueue.length === 0) return;
  
  isProcessing = true;
  const frameTask = frameQueue.shift();
  
  try {
    await captureAndSendFrame(frameTask.timestamp);
  } catch (error) {
    console.error('帧处理失败:', error);
    sendToRenderer('capture-error', { error: error.message });
  } finally {
    isProcessing = false;
    
    if (frameQueue.length > 0 && isSharing) {
      setImmediate(processNextFrame);
    }
  }
}

async function captureAndSendFrame(scheduledTimestamp) {
  if (!isSharing) return;

  frameCount++;

  try {
    let imgBuffer;
    let captureConfig = {};

    if (selectedWindow) {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1920, height: 1080 }
      });
      const windowSource = sources.find(s => s.id === selectedWindow.id);
      if (windowSource) {
        const nativeImage = windowSource.thumbnail;
        imgBuffer = nativeImage.toPNG();
        captureConfig = {
          type: 'window',
          name: selectedWindow.name,
          width: nativeImage.getWidth(),
          height: nativeImage.getHeight()
        };
      }
    } else if (selectedDisplay) {
      const displays = await getDisplays();
      const display = displays.find(d => d.id === selectedDisplay.id);
      if (display) {
        if (captureRegion) {
          imgBuffer = await screenshot({
            screen: selectedDisplay.id,
            format: 'png',
            rect: {
              x: display.bounds.x + captureRegion.x,
              y: display.bounds.y + captureRegion.y,
              width: captureRegion.width,
              height: captureRegion.height
            }
          });
          captureConfig = {
            type: 'region',
            display: selectedDisplay.name,
            region: captureRegion,
            width: captureRegion.width,
            height: captureRegion.height
          };
        } else {
          imgBuffer = await screenshot({
            screen: selectedDisplay.id,
            format: 'png'
          });
          captureConfig = {
            type: 'display',
            display: selectedDisplay.name,
            width: display.bounds.width,
            height: display.bounds.height
          };
        }
      }
    } else {
      imgBuffer = await screenshot({ format: 'png' });
      const primaryDisplay = screen.getPrimaryDisplay();
      captureConfig = {
        type: 'fullscreen',
        display: '主显示器',
        width: primaryDisplay.bounds.width,
        height: primaryDisplay.bounds.height
      };
    }

    if (!imgBuffer) {
      console.warn('截图失败，跳过此帧');
      return;
    }

    if (lastCaptureBuffer && lastCaptureBuffer.length > 0) {
      lastCaptureBuffer = null;
    }
    lastCaptureBuffer = imgBuffer;

    const compressedBuffer = await compressImageStream(imgBuffer, quality, resolutionScale);

    imgBuffer = null;
    lastCaptureBuffer = null;

    if (!compressedBuffer || compressedBuffer.length === 0) {
      console.warn('压缩失败，跳过此帧');
      return;
    }

    const metadata = {
      type: 'frame',
      timestamp: scheduledTimestamp,
      fps: currentFps,
      actualFps: calculateActualFps(),
      latency: networkLatency,
      quality: quality,
      scale: resolutionScale,
      ...captureConfig,
      size: compressedBuffer.length
    };

    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      const metadataStr = JSON.stringify(metadata);
      const metadataLength = Buffer.alloc(4);
      metadataLength.writeUInt32LE(metadataStr.length, 0);
      
      const framePayload = Buffer.concat([metadataLength, Buffer.from(metadataStr), compressedBuffer]);
      wsClient.send(framePayload);
    }

    sendToRenderer('frame-captured', {
      ...metadata,
      imageData: compressedBuffer.toString('base64')
    });

    compressedBuffer.fill(0);

    if (frameCount % 30 === 0) {
      sendPing();
    }

    if (frameCount % 300 === 0) {
      hintGc();
    }

  } catch (error) {
    console.error('截图或发送失败:', error);
    sendToRenderer('capture-error', { error: error.message });
  }
}

function compressImageStream(buffer, qualityVal = 80, scale = 1.0) {
  return new Promise((resolve) => {
    try {
      const chunks = [];
      let pipeline = sharp(buffer, { limitInputPixels: 8192 * 8192 });
      
      if (scale !== 1.0) {
        pipeline = pipeline.resize(Math.floor(1920 * scale), null, {
          withoutEnlargement: true,
          fit: 'inside'
        });
      }
      
      const jpegStream = pipeline
        .jpeg({
          quality: qualityVal,
          progressive: false,
          optimizeScans: false
        });

      const writable = new Writable({
        write(chunk, encoding, cb) {
          chunks.push(chunk);
          cb();
        },
        final(cb) {
          const result = Buffer.concat(chunks);
          chunks.length = 0;
          resolve(result);
          cb();
        },
        destroy(err, cb) {
          chunks.length = 0;
          resolve(null);
          cb(err);
        }
      });

      jpegStream
        .on('error', (err) => {
          console.error('Sharp 流压缩错误:', err);
          chunks.length = 0;
          resolve(null);
        })
        .pipe(writable)
        .on('error', (err) => {
          console.error('写入流错误:', err);
          chunks.length = 0;
          resolve(null);
        });

    } catch (error) {
      console.error('图像压缩失败:', error);
      resolve(null);
    }
  });
}

function hintGc() {
  if (typeof global.gc === 'function') {
    global.gc();
    return;
  }
  
  const now = Date.now();
  if (now - lastGcHint > 60000) {
    lastGcHint = now;
    if (global.gc) global.gc();
  }
}

function calculateActualFps() {
  const now = Date.now();
  if (lastFrameTime === 0) {
    lastFrameTime = now;
    return currentFps;
  }
  const elapsed = now - lastFrameTime;
  if (elapsed >= 1000) {
    actualFps = Math.round((frameCount * 1000) / elapsed);
    frameCount = 0;
    lastFrameTime = now;
  }
  return actualFps || currentFps;
}

function sendPing() {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify({
      type: 'ping',
      timestamp: Date.now()
    }));
  }
}

function startSharing(config = {}) {
  if (isSharing) return;
  
  isSharing = true;
  targetFps = config.fps || 30;
  quality = config.quality || 80;
  resolutionScale = config.scale || 1.0;
  selectedDisplay = config.display || null;
  selectedWindow = config.window || null;
  captureRegion = config.region || null;
  frameQueue = [];
  isProcessing = false;
  droppedFrames = 0;
  
  restartCaptureInterval();
  
  sendToRenderer('sharing-started', {
    fps: currentFps,
    quality: quality,
    scale: resolutionScale,
    display: selectedDisplay,
    window: selectedWindow,
    region: captureRegion,
    remoteControlEnabled
  });
  
  console.log('开始屏幕共享');
}

function stopSharing() {
  if (!isSharing) return;
  
  isSharing = false;
  
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  
  frameQueue = [];
  isProcessing = false;
  droppedFrames = 0;
  
  if (lastCaptureBuffer) {
    lastCaptureBuffer = null;
  }
  
  currentFps = targetFps = 30;
  frameCount = 0;
  lastFrameTime = 0;
  actualFps = 0;
  
  hintGc();
  
  sendToRenderer('sharing-stopped', {});
  
  console.log('停止屏幕共享');
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function handleRemoteControl(data) {
  const clientId = data.sender || 'unknown';
  const actionType = data.action;
  
  if (!remoteControlEnabled || controlPermissionBanned) {
    logInputAction('control', actionType, data, clientId, false);
    sendToRenderer('control-blocked', { 
      action: actionType, 
      reason: controlPermissionBanned ? 'temporary_banned' : 'disabled',
      clientId 
    });
    return;
  }

  if (!robot) {
    logInputAction('control', actionType, data, clientId, false);
    console.log('远程控制不可用（robotjs 未加载）');
    return;
  }

  try {
    let details = {};
    
    switch (actionType) {
      case 'mousemove':
        robot.moveMouse(data.x, data.y);
        details = { x: data.x, y: data.y };
        break;
      case 'mousedown':
        robot.mouseToggle('down', data.button || 'left');
        details = { button: data.button || 'left' };
        break;
      case 'mouseup':
        robot.mouseToggle('up', data.button || 'left');
        details = { button: data.button || 'left' };
        break;
      case 'click':
        robot.mouseClick(data.button || 'left', data.double);
        details = { button: data.button || 'left', double: data.double };
        break;
      case 'keydown':
        robot.keyToggle(data.key, 'down');
        details = { key: data.key };
        break;
      case 'keyup':
        robot.keyToggle(data.key, 'up');
        details = { key: data.key };
        break;
      case 'keypress':
        robot.keyTap(data.key, data.modifier);
        details = { key: data.key, modifier: data.modifier };
        break;
      case 'scroll':
        robot.scrollMouse(data.amount, data.direction);
        details = { amount: data.amount, direction: data.direction };
        break;
      case 'mousedrag':
        robot.dragMouse(data.x, data.y);
        details = { x: data.x, y: data.y };
        break;
      default:
        console.warn('未知的控制操作:', actionType);
        return;
    }

    logInputAction('control', actionType, details, clientId, true);
    sendToRenderer('control-executed', { action: actionType, details, clientId });

  } catch (error) {
    console.error('远程控制执行失败:', error);
    logInputAction('control', actionType, { error: error.message }, clientId, false);
  }
}

ipcMain.handle('get-displays', async () => {
  return await getDisplays();
});

ipcMain.handle('get-windows', async () => {
  return await getWindows();
});

ipcMain.handle('connect-websocket', async (_, url) => {
  try {
    await connectWebSocket(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect-websocket', () => {
  disconnectWebSocket();
  return { success: true };
});

ipcMain.handle('start-sharing', async (_, config) => {
  startSharing(config);
  return { success: true, isSharing };
});

ipcMain.handle('stop-sharing', () => {
  stopSharing();
  return { success: true, isSharing };
});

ipcMain.handle('set-fps', (_, fps) => {
  targetFps = Math.max(MIN_FPS, Math.min(MAX_FPS, fps));
  if (isSharing) {
    restartCaptureInterval();
  }
  return { success: true, currentFps, targetFps };
});

ipcMain.handle('set-quality', (_, newQuality) => {
  quality = Math.max(10, Math.min(100, newQuality));
  return { success: true, quality };
});

ipcMain.handle('set-scale', (_, scale) => {
  resolutionScale = Math.max(0.25, Math.min(2.0, scale));
  return { success: true, scale: resolutionScale };
});

ipcMain.handle('select-display', (_, display) => {
  selectedDisplay = display;
  selectedWindow = null;
  return { success: true, display };
});

ipcMain.handle('select-window', (_, window) => {
  selectedWindow = window;
  selectedDisplay = null;
  return { success: true, window };
});

ipcMain.handle('set-region', (_, region) => {
  captureRegion = region;
  return { success: true, region };
});

ipcMain.handle('get-status', () => {
  return {
    isSharing,
    currentFps,
    targetFps,
    actualFps: calculateActualFps(),
    quality,
    scale: resolutionScale,
    selectedDisplay,
    selectedWindow,
    captureRegion,
    networkLatency,
    websocketConnected: wsClient && wsClient.readyState === WebSocket.OPEN,
    queueLength: frameQueue.length,
    droppedFrames,
    remoteControlEnabled,
    controlPermissionBanned,
    bannedUntil
  };
});

ipcMain.handle('send-chat', (_, message) => {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify({
      type: 'chat',
      data: {
        sender: 'host',
        message,
        timestamp: Date.now()
      }
    }));
    return { success: true };
  }
  return { success: false, error: '未连接到服务器' };
});

ipcMain.handle('toggle-remote-control', (_, enabled, reason) => {
  toggleRemoteControl(enabled, reason || 'manual', 0);
  return { success: true, enabled: remoteControlEnabled };
});

ipcMain.handle('get-control-permission', () => {
  return {
    enabled: remoteControlEnabled,
    banned: controlPermissionBanned,
    bannedUntil
  };
});

ipcMain.handle('get-audit-logs', async (_, limit) => {
  try {
    const logs = await getAuditLogs(limit);
    return { success: true, logs };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('send-control-event', (_, controlData) => {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify({
      type: 'control',
      data: controlData
    }));
    return { success: true };
  }
  return { success: false, error: '未连接到服务器' };
});
