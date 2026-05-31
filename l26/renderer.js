const api = window.screenShareAPI;

const elements = {
  serverUrl: document.getElementById('serverUrl'),
  connectBtn: document.getElementById('connectBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  wsStatus: document.getElementById('wsStatus'),
  shareStatus: document.getElementById('shareStatus'),
  shareTypeRadios: document.querySelectorAll('input[name="shareType"]'),
  displaySelector: document.getElementById('displaySelector'),
  displaySelect: document.getElementById('displaySelect'),
  refreshDisplays: document.getElementById('refreshDisplays'),
  windowSelector: document.getElementById('windowSelector'),
  windowSelect: document.getElementById('windowSelect'),
  refreshWindows: document.getElementById('refreshWindows'),
  regionSelector: document.getElementById('regionSelector'),
  regionX: document.getElementById('regionX'),
  regionY: document.getElementById('regionY'),
  regionWidth: document.getElementById('regionWidth'),
  regionHeight: document.getElementById('regionHeight'),
  selectRegionBtn: document.getElementById('selectRegionBtn'),
  fpsSlider: document.getElementById('fpsSlider'),
  fpsValue: document.getElementById('fpsValue'),
  qualitySlider: document.getElementById('qualitySlider'),
  qualityValue: document.getElementById('qualityValue'),
  scaleSlider: document.getElementById('scaleSlider'),
  scaleValue: document.getElementById('scaleValue'),
  currentFps: document.getElementById('currentFps'),
  targetFps: document.getElementById('targetFps'),
  latency: document.getElementById('latency'),
  frameSize: document.getElementById('frameSize'),
  fpsAdjustAlert: document.getElementById('fpsAdjustAlert'),
  fpsAdjustText: document.getElementById('fpsAdjustText'),
  videoPlaceholder: document.getElementById('videoPlaceholder'),
  videoCanvas: document.getElementById('videoCanvas'),
  shareTypeLabel: document.getElementById('shareTypeLabel'),
  shareTime: document.getElementById('shareTime'),
  chatInput: document.getElementById('chatInput'),
  sendChatBtn: document.getElementById('sendChatBtn'),
  chatMessages: document.getElementById('chatMessages'),
  onlineCount: document.getElementById('onlineCount'),
  regionSelectorOverlay: document.getElementById('regionSelectorOverlay'),
  cancelRegionSelect: document.getElementById('cancelRegionSelect'),
  selectionBox: document.getElementById('selectionBox'),
  selectionInfo: document.getElementById('selectionInfo'),
  controlPermissionStatus: document.getElementById('controlPermissionStatus'),
  enableControlBtn: document.getElementById('enableControlBtn'),
  disableControlBtn: document.getElementById('disableControlBtn'),
  controllerMode: document.getElementById('controllerMode'),
  controllerPanel: document.getElementById('controllerPanel'),
  viewAuditBtn: document.getElementById('viewAuditBtn'),
  controlBlockedAlert: document.getElementById('controlBlockedAlert'),
  controlBlockedText: document.getElementById('controlBlockedText'),
  videoContainer: document.querySelector('.video-container')
};

const canvasCtx = elements.videoCanvas.getContext('2d');
let shareStartTime = null;
let shareTimer = null;
let displays = [];
let windows = [];
let isSelectingRegion = false;
let selectionStart = { x: 0, y: 0 };
let selectedRegion = null;
let currentImg = null;
let pendingFrameUrl = null;
let frameRenderPending = false;
let lastRenderTime = 0;
const MIN_RENDER_INTERVAL = 33;

let isControllerMode = false;
let isMouseDown = false;
let lastMousePos = { x: 0, y: 0 };
let currentFrameWidth = 0;
let currentFrameHeight = 0;

function init() {
  setupEventListeners();
  setupIpcListeners();
  loadDisplays();
  loadWindows();
  updateStatus();
  updateControlPermissionStatus();
}

function setupEventListeners() {
  elements.connectBtn.addEventListener('click', handleConnect);
  elements.disconnectBtn.addEventListener('click', handleDisconnect);
  elements.startBtn.addEventListener('click', handleStartSharing);
  elements.stopBtn.addEventListener('click', handleStopSharing);

  elements.shareTypeRadios.forEach(radio => {
    radio.addEventListener('change', handleShareTypeChange);
  });

  elements.refreshDisplays.addEventListener('click', loadDisplays);
  elements.refreshWindows.addEventListener('click', loadWindows);
  elements.selectRegionBtn.addEventListener('click', startRegionSelection);
  elements.cancelRegionSelect.addEventListener('click', cancelRegionSelection);

  elements.fpsSlider.addEventListener('input', (e) => {
    elements.fpsValue.textContent = e.target.value;
  });
  elements.fpsSlider.addEventListener('change', (e) => {
    api.setFps(parseInt(e.target.value));
  });

  elements.qualitySlider.addEventListener('input', (e) => {
    elements.qualityValue.textContent = e.target.value;
  });
  elements.qualitySlider.addEventListener('change', (e) => {
    api.setQuality(parseInt(e.target.value));
  });

  elements.scaleSlider.addEventListener('input', (e) => {
    elements.scaleValue.textContent = parseFloat(e.target.value).toFixed(2);
  });
  elements.scaleSlider.addEventListener('change', (e) => {
    api.setScale(parseFloat(e.target.value));
  });

  elements.sendChatBtn.addEventListener('click', sendChatMessage);
  elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  elements.regionSelectorOverlay.addEventListener('mousedown', handleRegionMouseDown);
  elements.regionSelectorOverlay.addEventListener('mousemove', handleRegionMouseMove);
  elements.regionSelectorOverlay.addEventListener('mouseup', handleRegionMouseUp);
  document.addEventListener('keydown', handleKeyDown);

  elements.enableControlBtn.addEventListener('click', () => {
    api.toggleRemoteControl(true, 'ui_manual');
  });
  elements.disableControlBtn.addEventListener('click', () => {
    api.toggleRemoteControl(false, 'ui_manual');
  });

  elements.controllerMode.addEventListener('change', (e) => {
    toggleControllerMode(e.target.checked);
  });

  elements.viewAuditBtn.addEventListener('click', viewAuditLogs);

  elements.videoCanvas.addEventListener('mousemove', handleControllerMouseMove);
  elements.videoCanvas.addEventListener('mousedown', handleControllerMouseDown);
  elements.videoCanvas.addEventListener('mouseup', handleControllerMouseUp);
  elements.videoCanvas.addEventListener('wheel', handleControllerWheel, { passive: false });
  elements.videoCanvas.addEventListener('dblclick', handleControllerDoubleClick);
  elements.videoCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', handleControllerKeyDown);
  document.addEventListener('keyup', handleControllerKeyUp);
}

function setupIpcListeners() {
  api.onFrameCaptured(handleFrameCaptured);
  api.onSharingStarted(handleSharingStarted);
  api.onSharingStopped(handleSharingStopped);
  api.onFpsChanged(handleFpsChanged);
  api.onChatMessage(handleChatMessage);
  api.onWebSocketConnected(handleWebSocketConnected);
  api.onWebSocketDisconnected(handleWebSocketDisconnected);
  api.onCaptureError(handleCaptureError);
  api.onControlPermissionChanged(handleControlPermissionChanged);
  api.onControlExecuted(handleControlExecuted);
  api.onControlBlocked(handleControlBlocked);
  api.onControlRequest(handleControlRequest);
}

async function loadDisplays() {
  try {
    displays = await api.getDisplays();
    elements.displaySelect.innerHTML = '';
    displays.forEach(display => {
      const option = document.createElement('option');
      option.value = JSON.stringify(display);
      option.textContent = `${display.name}${display.isPrimary ? ' (主显示器)' : ''} - ${display.bounds.width}x${display.bounds.height}`;
      elements.displaySelect.appendChild(option);
    });
  } catch (error) {
    console.error('加载显示器列表失败:', error);
  }
}

async function loadWindows() {
  try {
    windows = await api.getWindows();
    elements.windowSelect.innerHTML = '';
    windows.forEach(window => {
      const option = document.createElement('option');
      option.value = JSON.stringify(window);
      option.textContent = window.name;
      elements.windowSelect.appendChild(option);
    });
  } catch (error) {
    console.error('加载窗口列表失败:', error);
  }
}

function handleShareTypeChange(e) {
  const type = e.target.value;
  elements.displaySelector.classList.toggle('hidden', type !== 'display');
  elements.windowSelector.classList.toggle('hidden', type !== 'window');
  elements.regionSelector.classList.toggle('hidden', type !== 'region');
}

async function handleConnect() {
  const url = elements.serverUrl.value.trim();
  if (!url) {
    addSystemMessage('请输入服务器地址');
    return;
  }

  elements.connectBtn.disabled = true;
  elements.connectBtn.textContent = '连接中...';

  try {
    const result = await api.connectWebSocket(url);
    if (result.success) {
      addSystemMessage(`已连接到服务器: ${url}`);
    } else {
      addSystemMessage(`连接失败: ${result.error}`);
      elements.connectBtn.disabled = false;
      elements.connectBtn.textContent = '连接';
    }
  } catch (error) {
    addSystemMessage(`连接错误: ${error.message}`);
    elements.connectBtn.disabled = false;
    elements.connectBtn.textContent = '连接';
  }
}

async function handleDisconnect() {
  await api.disconnectWebSocket();
  addSystemMessage('已断开与服务器的连接');
}

async function handleStartSharing() {
  const shareType = document.querySelector('input[name="shareType"]:checked').value;
  const config = {
    fps: parseInt(elements.fpsSlider.value),
    quality: parseInt(elements.qualitySlider.value),
    scale: parseFloat(elements.scaleSlider.value)
  };

  switch (shareType) {
    case 'fullscreen':
      config.display = null;
      config.window = null;
      config.region = null;
      break;
    case 'display':
      try {
        config.display = JSON.parse(elements.displaySelect.value);
      } catch (e) {
        addSystemMessage('请选择一个显示器');
        return;
      }
      break;
    case 'window':
      try {
        config.window = JSON.parse(elements.windowSelect.value);
      } catch (e) {
        addSystemMessage('请选择一个窗口');
        return;
      }
      break;
    case 'region':
      const region = getRegionFromInputs();
      if (!region) {
        addSystemMessage('请输入有效的区域参数');
        return;
      }
      config.region = region;
      config.display = selectedRegion ? displays[0] : null;
      break;
  }

  try {
    const result = await api.startSharing(config);
    if (result.success) {
      const typeLabel = getShareTypeLabel(shareType, config);
      elements.shareTypeLabel.textContent = typeLabel;
      addSystemMessage(`开始共享: ${typeLabel}`);
    }
  } catch (error) {
    addSystemMessage(`启动共享失败: ${error.message}`);
  }
}

async function handleStopSharing() {
  await api.stopSharing();
  addSystemMessage('已停止屏幕共享');
}

function getShareTypeLabel(type, config) {
  switch (type) {
    case 'fullscreen': return '全屏共享';
    case 'display': return `显示器: ${config.display?.name || '未知'}`;
    case 'window': return `窗口: ${config.window?.name || '未知'}`;
    case 'region': return `区域: ${config.region?.width}x${config.region?.height}`;
    default: return '未共享';
  }
}

function getRegionFromInputs() {
  const x = parseInt(elements.regionX.value);
  const y = parseInt(elements.regionY.value);
  const width = parseInt(elements.regionWidth.value);
  const height = parseInt(elements.regionHeight.value);

  if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height) || width < 100 || height < 100) {
    return null;
  }
  return { x, y, width, height };
}

function handleWebSocketConnected(data) {
  elements.wsStatus.className = 'status-badge status-connected';
  elements.wsStatus.querySelector('.status-text').textContent = '已连接';
  elements.connectBtn.disabled = true;
  elements.connectBtn.textContent = '已连接';
  elements.disconnectBtn.disabled = false;
  elements.chatInput.disabled = false;
  elements.sendChatBtn.disabled = false;
}

function handleWebSocketDisconnected() {
  elements.wsStatus.className = 'status-badge status-disconnected';
  elements.wsStatus.querySelector('.status-text').textContent = '未连接';
  elements.connectBtn.disabled = false;
  elements.connectBtn.textContent = '连接';
  elements.disconnectBtn.disabled = true;
  elements.chatInput.disabled = true;
  elements.sendChatBtn.disabled = true;
  elements.onlineCount.textContent = '在线: 0';
}

function handleSharingStarted(data) {
  elements.shareStatus.className = 'status-badge status-sharing';
  elements.shareStatus.querySelector('.status-text').textContent = '共享中';
  elements.startBtn.disabled = true;
  elements.stopBtn.disabled = false;
  elements.videoPlaceholder.classList.add('hidden');
  elements.videoCanvas.classList.remove('hidden');

  shareStartTime = Date.now();
  startShareTimer();
}

function handleSharingStopped() {
  elements.shareStatus.className = 'status-badge status-stopped';
  elements.shareStatus.querySelector('.status-text').textContent = '未共享';
  elements.startBtn.disabled = false;
  elements.stopBtn.disabled = true;
  elements.videoPlaceholder.classList.remove('hidden');
  elements.videoCanvas.classList.add('hidden');
  elements.shareTypeLabel.textContent = '未共享';

  if (currentImg) {
    currentImg.src = '';
    currentImg.onload = null;
    currentImg.onerror = null;
    currentImg = null;
  }
  if (pendingFrameUrl) {
    URL.revokeObjectURL(pendingFrameUrl);
    pendingFrameUrl = null;
  }
  frameRenderPending = false;
  lastRenderTime = 0;

  stopShareTimer();
  elements.currentFps.textContent = '--';
  elements.latency.textContent = '-- ms';
  elements.frameSize.textContent = '--';
}

function handleFrameCaptured(data) {
  const now = performance.now();
  if (now - lastRenderTime < MIN_RENDER_INTERVAL) {
    return;
  }
  
  if (frameRenderPending) {
    return;
  }
  
  renderFrame(data.imageData, data.width, data.height);
  updateStats(data);
}

function renderFrame(base64Data, width, height) {
  frameRenderPending = true;
  lastRenderTime = performance.now();
  
  if (pendingFrameUrl) {
    URL.revokeObjectURL(pendingFrameUrl);
    pendingFrameUrl = null;
  }

  if (!currentImg) {
    currentImg = new Image();
    currentImg.onload = () => {
      drawCurrentFrame();
    };
    currentImg.onerror = () => {
      frameRenderPending = false;
    };
  }
  
  currentImg.src = `data:image/jpeg;base64,${base64Data}`;
}

function drawCurrentFrame() {
  if (!currentImg || !currentImg.complete) {
    frameRenderPending = false;
    return;
  }

  const container = elements.videoCanvas.parentElement;
  const containerRect = container.getBoundingClientRect();
  
  const scale = Math.min(
    containerRect.width / currentImg.naturalWidth,
    containerRect.height / currentImg.naturalHeight
  );
  
  const canvasWidth = Math.floor(currentImg.naturalWidth * scale);
  const canvasHeight = Math.floor(currentImg.naturalHeight * scale);
  
  if (elements.videoCanvas.width !== canvasWidth || elements.videoCanvas.height !== canvasHeight) {
    elements.videoCanvas.width = canvasWidth;
    elements.videoCanvas.height = canvasHeight;
  }
  
  canvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);
  canvasCtx.drawImage(currentImg, 0, 0, canvasWidth, canvasHeight);
  
  currentImg.src = '';
  frameRenderPending = false;
}

function updateStats(data) {
  elements.currentFps.textContent = data.actualFps || data.fps || '--';
  elements.targetFps.textContent = data.fps || '--';
  elements.latency.textContent = data.latency != null ? `${data.latency} ms` : '-- ms';
  elements.frameSize.textContent = formatBytes(data.size || 0);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function handleFpsChanged(data) {
  let reasonText = '';
  if (data.reason === 'high_latency') {
    reasonText = `网络延迟较高 (${data.latency}ms)，已自动降低帧率以保持流畅`;
  } else if (data.reason === 'low_latency') {
    reasonText = `网络状况良好 (${data.latency}ms)，已自动提升帧率`;
  } else {
    reasonText = `帧率已调整为 ${data.fps}fps`;
  }
  
  elements.fpsAdjustText.textContent = reasonText;
  elements.fpsAdjustAlert.classList.remove('hidden');
  
  setTimeout(() => {
    elements.fpsAdjustAlert.classList.add('hidden');
  }, 5000);

  elements.fpsSlider.value = data.fps;
  elements.fpsValue.textContent = data.fps;
}

function handleCaptureError(data) {
  addSystemMessage(`捕获错误: ${data.error}`);
}

function sendChatMessage() {
  const message = elements.chatInput.value.trim();
  if (!message) return;

  api.sendChat(message);
  addChatMessage({
    sender: 'host',
    message,
    timestamp: Date.now(),
    isSelf: true
  });

  elements.chatInput.value = '';
}

function handleChatMessage(data) {
  addChatMessage({
    ...data,
    isSelf: data.sender === 'host'
  });
}

function addChatMessage(data) {
  const messageEl = document.createElement('div');
  messageEl.className = `message ${data.isSelf ? 'message-self' : 'message-other'}`;
  
  const time = new Date(data.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  
  messageEl.innerHTML = `
    <div class="message-header">
      <span class="message-sender">${data.isSelf ? '我' : data.sender}</span>
      <span class="message-time">${time}</span>
    </div>
    <div class="message-content">${escapeHtml(data.message)}</div>
  `;
  
  elements.chatMessages.appendChild(messageEl);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function addSystemMessage(text) {
  const messageEl = document.createElement('div');
  messageEl.className = 'system-message';
  messageEl.innerHTML = `<span>${escapeHtml(text)}</span>`;
  elements.chatMessages.appendChild(messageEl);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function startShareTimer() {
  shareTimer = setInterval(() => {
    if (shareStartTime) {
      const elapsed = Math.floor((Date.now() - shareStartTime) / 1000);
      const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
      const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
      const seconds = (elapsed % 60).toString().padStart(2, '0');
      elements.shareTime.textContent = `${hours}:${minutes}:${seconds}`;
    }
  }, 1000);
}

function stopShareTimer() {
  if (shareTimer) {
    clearInterval(shareTimer);
    shareTimer = null;
  }
  elements.shareTime.textContent = '00:00:00';
  shareStartTime = null;
}

function startRegionSelection() {
  elements.regionSelectorOverlay.classList.remove('hidden');
  isSelectingRegion = true;
  selectedRegion = null;
  elements.selectionBox.style.display = 'none';
}

function cancelRegionSelection() {
  elements.regionSelectorOverlay.classList.add('hidden');
  isSelectingRegion = false;
  elements.selectionBox.style.display = 'none';
}

function handleRegionMouseDown(e) {
  if (!isSelectingRegion) return;
  selectionStart = { x: e.clientX, y: e.clientY };
  elements.selectionBox.style.display = 'block';
  elements.selectionBox.style.left = e.clientX + 'px';
  elements.selectionBox.style.top = e.clientY + 'px';
  elements.selectionBox.style.width = '0px';
  elements.selectionBox.style.height = '0px';
}

function handleRegionMouseMove(e) {
  if (!isSelectingRegion || elements.selectionBox.style.display === 'none') return;
  
  const currentX = e.clientX;
  const currentY = e.clientY;
  
  const left = Math.min(selectionStart.x, currentX);
  const top = Math.min(selectionStart.y, currentY);
  const width = Math.abs(currentX - selectionStart.x);
  const height = Math.abs(currentY - selectionStart.y);
  
  elements.selectionBox.style.left = left + 'px';
  elements.selectionBox.style.top = top + 'px';
  elements.selectionBox.style.width = width + 'px';
  elements.selectionBox.style.height = height + 'px';
  elements.selectionInfo.textContent = `${width} x ${height}`;
}

function handleRegionMouseUp(e) {
  if (!isSelectingRegion) return;
  
  const currentX = e.clientX;
  const currentY = e.clientY;
  
  const left = Math.min(selectionStart.x, currentX);
  const top = Math.min(selectionStart.y, currentY);
  const width = Math.abs(currentX - selectionStart.x);
  const height = Math.abs(currentY - selectionStart.y);
  
  if (width >= 100 && height >= 100) {
    selectedRegion = { x: left, y: top, width, height };
    elements.regionX.value = Math.round(left);
    elements.regionY.value = Math.round(top);
    elements.regionWidth.value = Math.round(width);
    elements.regionHeight.value = Math.round(height);
    cancelRegionSelection();
    addSystemMessage(`已选择区域: ${Math.round(width)} x ${Math.round(height)}`);
  }
}

function handleKeyDown(e) {
  if (isSelectingRegion) {
    if (e.key === 'Escape') {
      cancelRegionSelection();
    } else if (e.key === 'Enter') {
      const width = parseInt(elements.selectionBox.style.width);
      const height = parseInt(elements.selectionBox.style.height);
      if (width >= 100 && height >= 100) {
        const left = parseInt(elements.selectionBox.style.left);
        const top = parseInt(elements.selectionBox.style.top);
        selectedRegion = { x: left, y: top, width, height };
        elements.regionX.value = Math.round(left);
        elements.regionY.value = Math.round(top);
        elements.regionWidth.value = Math.round(width);
        elements.regionHeight.value = Math.round(height);
        cancelRegionSelection();
        addSystemMessage(`已选择区域: ${Math.round(width)} x ${Math.round(height)}`);
      }
    }
  }
}

async function updateStatus() {
  try {
    const status = await api.getStatus();
    if (status.isSharing) {
      elements.shareStatus.className = 'status-badge status-sharing';
      elements.shareStatus.querySelector('.status-text').textContent = '共享中';
      elements.startBtn.disabled = true;
      elements.stopBtn.disabled = false;
      elements.videoPlaceholder.classList.add('hidden');
      elements.videoCanvas.classList.remove('hidden');
    }
    if (status.websocketConnected) {
      elements.wsStatus.className = 'status-badge status-connected';
      elements.wsStatus.querySelector('.status-text').textContent = '已连接';
      elements.connectBtn.disabled = true;
      elements.connectBtn.textContent = '已连接';
      elements.disconnectBtn.disabled = false;
      elements.chatInput.disabled = false;
      elements.sendChatBtn.disabled = false;
    }
  } catch (error) {
    console.error('获取状态失败:', error);
  }
}

window.addEventListener('beforeunload', () => {
  stopShareTimer();
  api.removeAllListeners();
});

async function updateControlPermissionStatus() {
  try {
    const status = await api.getControlPermission();
    updateControlPermissionUI(status);
  } catch (error) {
    console.error('获取控制权限状态失败:', error);
  }
}

function updateControlPermissionUI(status) {
  const statusEl = elements.controlPermissionStatus;
  if (status.enabled && !status.banned) {
    statusEl.className = 'permission-status permission-allowed';
    statusEl.querySelector('.permission-icon').textContent = '✓';
    statusEl.querySelector('.permission-text').textContent = '远程控制已启用';
    elements.enableControlBtn.disabled = true;
    elements.disableControlBtn.disabled = false;
  } else {
    statusEl.className = 'permission-status permission-denied';
    statusEl.querySelector('.permission-icon').textContent = '✕';
    const reason = status.banned ? '（临时禁用）' : '';
    statusEl.querySelector('.permission-text').textContent = `远程控制已禁用${reason}`;
    elements.enableControlBtn.disabled = false;
    elements.disableControlBtn.disabled = true;
  }
}

function toggleControllerMode(enabled) {
  isControllerMode = enabled;
  elements.controllerPanel.classList.toggle('hidden', !enabled);
  elements.videoContainer.classList.toggle('controller-mode', enabled);
  
  if (enabled) {
    elements.videoCanvas.focus();
    addSystemMessage('已进入主控模式，在画面上操作即可远程控制');
  } else {
    addSystemMessage('已退出主控模式');
  }
}

function getScaledMousePosition(e) {
  const rect = elements.videoCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  const canvasWidth = elements.videoCanvas.width;
  const canvasHeight = elements.videoCanvas.height;
  
  const scaleX = currentFrameWidth / canvasWidth;
  const scaleY = currentFrameHeight / canvasHeight;
  
  return {
    x: Math.round(x * scaleX),
    y: Math.round(y * scaleY)
  };
}

function sendControlEvent(action, data = {}) {
  if (!isControllerMode) return;
  
  api.sendControlEvent({
    action,
    ...data,
    timestamp: Date.now()
  });
}

function handleControllerMouseMove(e) {
  if (!isControllerMode) return;
  
  const pos = getScaledMousePosition(e);
  if (Math.abs(pos.x - lastMousePos.x) < 2 && Math.abs(pos.y - lastMousePos.y) < 2) {
    return;
  }
  
  lastMousePos = pos;
  
  if (isMouseDown) {
    sendControlEvent('mousedrag', { x: pos.x, y: pos.y });
  } else {
    sendControlEvent('mousemove', { x: pos.x, y: pos.y });
  }
}

function handleControllerMouseDown(e) {
  if (!isControllerMode) return;
  e.preventDefault();
  
  const pos = getScaledMousePosition(e);
  isMouseDown = true;
  
  const button = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
  sendControlEvent('mousedown', { x: pos.x, y: pos.y, button });
}

function handleControllerMouseUp(e) {
  if (!isControllerMode) return;
  e.preventDefault();
  
  const pos = getScaledMousePosition(e);
  isMouseDown = false;
  
  const button = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
  sendControlEvent('mouseup', { x: pos.x, y: pos.y, button });
}

function handleControllerDoubleClick(e) {
  if (!isControllerMode) return;
  e.preventDefault();
  
  const pos = getScaledMousePosition(e);
  const button = e.button === 2 ? 'right' : 'left';
  sendControlEvent('click', { x: pos.x, y: pos.y, button, double: true });
}

function handleControllerWheel(e) {
  if (!isControllerMode) return;
  e.preventDefault();
  
  const direction = e.deltaY > 0 ? 'down' : 'up';
  const amount = Math.abs(e.deltaY);
  sendControlEvent('scroll', { amount, direction });
}

const KEY_MAP = {
  'Control': 'control',
  'Shift': 'shift',
  'Alt': 'alt',
  'Meta': 'command',
  'Enter': 'enter',
  'Tab': 'tab',
  'Escape': 'escape',
  'Backspace': 'backspace',
  'Delete': 'delete',
  'ArrowUp': 'up',
  'ArrowDown': 'down',
  'ArrowLeft': 'left',
  'ArrowRight': 'right',
  ' ': 'space'
};

function getModifierKey() {
  return null;
}

function handleControllerKeyDown(e) {
  if (!isControllerMode) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  const key = KEY_MAP[e.key] || e.key.toLowerCase();
  const modifier = getModifierKey();
  
  if (modifier) {
    sendControlEvent('keypress', { key, modifier });
  } else {
    sendControlEvent('keydown', { key });
  }
}

function handleControllerKeyUp(e) {
  if (!isControllerMode) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  const key = KEY_MAP[e.key] || e.key.toLowerCase();
  sendControlEvent('keyup', { key });
}

function handleControlPermissionChanged(data) {
  updateControlPermissionUI(data);
  
  const reasonText = {
    'F12_emergency_stop': 'F12 紧急停止',
    'ui_manual': '手动切换',
    'auto_unban': '自动解禁',
    'F12_manual_enable': 'F12 手动启用',
    'F11_manual_enable': 'F11 手动启用'
  };
  
  addSystemMessage(`远程控制已${data.enabled ? '启用' : '禁用'}${reasonText[data.reason] ? `（${reasonText[data.reason]}）` : ''}`);
}

function handleControlExecuted(data) {
  console.log('控制指令已执行:', data);
}

function handleControlBlocked(data) {
  const reasonText = {
    'disabled': '远程控制未启用',
    'temporary_banned': '临时禁用中'
  };
  
  elements.controlBlockedText.textContent = `控制操作被拒绝: ${reasonText[data.reason] || data.reason}`;
  elements.controlBlockedAlert.classList.remove('hidden');
  
  setTimeout(() => {
    elements.controlBlockedAlert.classList.add('hidden');
  }, 3000);
}

function handleControlRequest(data) {
  addSystemMessage(`收到来自 ${data.sender || '未知用户'} 的控制请求`);
}

async function viewAuditLogs() {
  try {
    const result = await api.getAuditLogs(50);
    if (result.success) {
      const logWindow = window.open('', '审计日志', 'width=800,height=600');
      logWindow.document.write(`
        <html>
        <head>
          <title>操作审计日志</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; background: #1e293b; color: #f1f5f9; }
            h1 { color: #3b82f6; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 10px; border: 1px solid #475569; text-align: left; }
            th { background: #334155; }
            tr.allowed { color: #10b981; }
            tr.denied { color: #ef4444; }
            .timestamp { color: #64748b; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>操作审计日志（最近50条）</h1>
          <table>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>操作</th>
              <th>详情</th>
              <th>客户端</th>
              <th>状态</th>
            </tr>
            ${result.logs.map(log => `
              <tr class="${log.allowed ? 'allowed' : 'denied'}">
                <td class="timestamp">${new Date(log.timestamp).toLocaleString('zh-CN')}</td>
                <td>${log.type}</td>
                <td>${log.action}</td>
                <td>${log.details || '-'}</td>
                <td>${log.client_id ? log.client_id.slice(0, 8) : '-'}</td>
                <td>${log.allowed ? '✓ 允许' : '✕ 拒绝'}</td>
              </tr>
            `).join('')}
          </table>
        </body>
        </html>
      `);
      logWindow.document.close();
    } else {
      addSystemMessage(`获取审计日志失败: ${result.error}`);
    }
  } catch (error) {
    addSystemMessage(`获取审计日志失败: ${error.message}`);
  }
}

init();
