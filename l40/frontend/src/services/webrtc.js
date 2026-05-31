const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...(window.__TURN_SERVERS || []),
];

const DATA_CHANNEL_LABEL = 'annotations';

let peerConnection = null;
let dataChannel = null;
let signalingWs = null;
let localStream = null;
let remoteStream = null;
let roomId = null;
let isInitiator = false;
let reconnectTimer = null;
let annotationBuffer = [];
let connectionState = 'idle';

const stateListeners = new Set();
const annotationListeners = new Set();
const remoteStreamListeners = new Set();

function setConnectionState(state) {
  connectionState = state;
  stateListeners.forEach((fn) => fn(state));
}

function notifyRemoteStream(stream) {
  remoteStreamListeners.forEach((fn) => fn(stream));
}

function flushAnnotationBuffer() {
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  while (annotationBuffer.length > 0) {
    const msg = annotationBuffer.shift();
    dataChannel.send(JSON.stringify(msg));
  }
}

function handleDataChannelMessage(event) {
  try {
    const msg = JSON.parse(event.data);
    annotationListeners.forEach((fn) => fn(msg));
  } catch (e) {
    console.error('[WebRTC] Failed to parse data channel message:', e);
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignaling({ type: 'ice-candidate', roomId, payload: event.candidate.toJSON() });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    if (state === 'connected') {
      setConnectionState('connected');
    } else if (state === 'disconnected') {
      setConnectionState('disconnected');
      scheduleReconnect();
    } else if (state === 'failed') {
      setConnectionState('failed');
      scheduleReconnect();
    } else if (state === 'connecting') {
      setConnectionState('connecting');
    }
  };

  peerConnection.ontrack = (event) => {
    remoteStream = event.streams[0];
    notifyRemoteStream(remoteStream);
  };

  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel(dataChannel);
  };
}

function setupDataChannel(channel) {
  channel.onopen = () => {
    flushAnnotationBuffer();
  };
  channel.onmessage = handleDataChannelMessage;
  channel.onclose = () => {};
}

function openSignaling() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws/signaling`;

  signalingWs = new WebSocket(url);

  signalingWs.onopen = () => {
    if (isInitiator && roomId) {
      sendSignaling({ type: 'create', roomId });
    }
  };

  signalingWs.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleSignalingMessage(msg);
    } catch (e) {
      console.error('[WebRTC] Signaling parse error:', e);
    }
  };

  signalingWs.onclose = () => {
    if (connectionState !== 'idle') {
      scheduleReconnect();
    }
  };

  signalingWs.onerror = () => {
    setConnectionState('failed');
  };
}

function sendSignaling(msg) {
  if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
    signalingWs.send(JSON.stringify(msg));
  }
}

async function handleSignalingMessage(msg) {
  switch (msg.type) {
    case 'created':
      setConnectionState('connecting');
      isInitiator = true;
      dataChannel = peerConnection.createDataChannel(DATA_CHANNEL_LABEL);
      setupDataChannel(dataChannel);
      break;

    case 'joined':
      setConnectionState('connecting');
      break;

    case 'ready':
      if (isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignaling({ type: 'offer', roomId, payload: offer });
      }
      break;

    case 'offer':
      if (peerConnection.signalingState === 'stable') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.payload));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendSignaling({ type: 'answer', roomId, payload: answer });
      }
      break;

    case 'answer':
      if (peerConnection.signalingState === 'have-local-offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.payload));
      }
      break;

    case 'ice-candidate':
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(msg.payload));
      } catch (e) {
        console.error('[WebRTC] ICE candidate error:', e);
      }
      break;

    case 'peer-left':
      setConnectionState('disconnected');
      cleanupPeer();
      break;

    case 'error':
      console.error('[WebRTC] Signaling error:', msg.message);
      break;
  }
}

function cleanupPeer() {
  if (dataChannel) {
    dataChannel.onopen = null;
    dataChannel.onmessage = null;
    dataChannel.onclose = null;
    dataChannel = null;
  }
  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.ontrack = null;
    peerConnection.ondatachannel = null;
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  remoteStream = null;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (connectionState === 'disconnected' || connectionState === 'failed') {
      if (signalingWs) {
        signalingWs.close();
        signalingWs = null;
      }
      cleanupPeer();
      createPeerConnection();
      openSignaling();
      if (roomId) {
        sendSignaling({ type: 'join', roomId });
      }
    }
  }, 3000);
}

export async function createRoom() {
  if (peerConnection) cleanupPeer();
  roomId = generateRoomId();
  isInitiator = true;
  annotationBuffer = [];

  createPeerConnection();
  openSignaling();

  return roomId;
}

export async function joinRoom(id) {
  if (peerConnection) cleanupPeer();
  roomId = id;
  isInitiator = false;
  annotationBuffer = [];

  createPeerConnection();
  openSignaling();

  setConnectionState('connecting');
  sendSignaling({ type: 'join', roomId });
}

export function sendAnnotation(annotation) {
  const msg = { type: 'annotation', data: annotation };
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(msg));
  } else {
    annotationBuffer.push(msg);
  }
}

export function sendClear() {
  const msg = { type: 'clear', data: {} };
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(msg));
  } else {
    annotationBuffer.push(msg);
  }
}

export function sendUndo(author) {
  const msg = { type: 'undo', data: { author } };
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(msg));
  } else {
    annotationBuffer.push(msg);
  }
}

export function sendCursor(position) {
  const msg = { type: 'cursor', data: position };
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(msg));
  }
}

export function onAnnotation(callback) {
  annotationListeners.add(callback);
  return () => annotationListeners.delete(callback);
}

export function onConnectionStateChange(callback) {
  stateListeners.add(callback);
  callback(connectionState);
  return () => stateListeners.delete(callback);
}

export function onRemoteStream(callback) {
  remoteStreamListeners.add(callback);
  if (remoteStream) callback(remoteStream);
  return () => remoteStreamListeners.delete(callback);
}

export async function startVoice() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach((track) => {
      if (peerConnection) {
        peerConnection.addTrack(track, localStream);
      }
    });
    if (isInitiator && peerConnection) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      sendSignaling({ type: 'offer', roomId, payload: offer });
    }
    return true;
  } catch (e) {
    console.error('[WebRTC] getUserMedia error:', e);
    return false;
  }
}

export function stopVoice() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (peerConnection) {
    peerConnection.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'audio') {
        peerConnection.removeTrack(sender);
      }
    });
  }
}

export function getConnectionState() {
  return connectionState;
}

export function getRoomId() {
  return roomId;
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (roomId) {
    sendSignaling({ type: 'leave', roomId });
  }
  if (signalingWs) {
    signalingWs.close();
    signalingWs = null;
  }
  cleanupPeer();
  roomId = null;
  isInitiator = false;
  annotationBuffer = [];
  setConnectionState('idle');
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function configureTurnServers(servers) {
  window.__TURN_SERVERS = servers;
}
