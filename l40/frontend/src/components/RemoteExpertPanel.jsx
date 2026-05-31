import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card, Button, Input, Space, Badge, Steps, Tooltip, Typography, message } from 'antd';
import {
  VideoCameraOutlined,
  LoginOutlined,
  CopyOutlined,
  StopOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  EditOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import {
  createRoom,
  joinRoom,
  disconnect,
  getConnectionState,
  onConnectionStateChange,
  getRoomId,
} from '../services/webrtc';
import VoiceChat from './VoiceChat';
import ExpertAnnotationTool from './ExpertAnnotationTool';

const { Text } = Typography;

export default function RemoteExpertPanel({ r3fCanvas, sceneRef, cameraRef, author = 'expert' }) {
  const [connState, setConnState] = useState(getConnectionState());
  const [roomIdDisplay, setRoomIdDisplay] = useState('');
  const [joinRoomInput, setJoinRoomInput] = useState('');
  const [showAnnotationTools, setShowAnnotationTools] = useState(false);
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const [sessionStart, setSessionStart] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    const unsub = onConnectionStateChange((state) => {
      setConnState(state);
      if (state === 'connected' && !sessionStart) {
        setSessionStart(Date.now());
      }
      if (state === 'idle') {
        setSessionStart(null);
        setElapsed(0);
        setRoomIdDisplay('');
      }
    });
    return unsub;
  }, [sessionStart]);

  useEffect(() => {
    if (sessionStart) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - sessionStart) / 1000));
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionStart]);

  const handleCreateRoom = useCallback(async () => {
    try {
      const id = await createRoom();
      setRoomIdDisplay(id);
      message.success(`Room created: ${id}`);
    } catch (e) {
      message.error('Failed to create room');
    }
  }, []);

  const handleJoinRoom = useCallback(async () => {
    if (!joinRoomInput.trim()) {
      message.warning('Please enter a room ID');
      return;
    }
    try {
      await joinRoom(joinRoomInput.trim().toUpperCase());
      setRoomIdDisplay(joinRoomInput.trim().toUpperCase());
      message.success('Joining room...');
    } catch (e) {
      message.error('Failed to join room');
    }
  }, [joinRoomInput]);

  const handleCopyRoomId = useCallback(() => {
    if (roomIdDisplay) {
      navigator.clipboard.writeText(roomIdDisplay).then(() => {
        message.success('Room ID copied');
      });
    }
  }, [roomIdDisplay]);

  const handleEndSession = useCallback(() => {
    disconnect();
    setShowAnnotationTools(false);
    setShowVoiceChat(false);
    setJoinRoomInput('');
    message.info('Session ended');
  }, []);

  const formatElapsed = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const connStatusMap = {
    idle: { status: 'default', text: 'Not Connected' },
    connecting: { status: 'processing', text: 'Connecting...' },
    connected: { status: 'success', text: 'Connected' },
    disconnected: { status: 'warning', text: 'Disconnected' },
    failed: { status: 'error', text: 'Failed' },
  };

  const connInfo = connStatusMap[connState] || connStatusMap.idle;
  const currentStep = connState === 'idle' ? 0 : connState === 'connecting' ? 1 : 2;
  const isConnected = connState === 'connected';

  return (
    <div style={{ position: 'relative' }}>
      <Card
        size="small"
        title={
          <Space>
            <TeamOutlined />
            <span>Remote Expert</span>
            <Badge status={connInfo.status} text={<span style={{ fontSize: 11 }}>{connInfo.text}</span>} />
          </Space>
        }
        style={{
          background: 'rgba(10, 22, 40, 0.92)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(54, 207, 201, 0.2)',
          borderRadius: 8,
          width: 300,
        }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <Steps
          size="small"
          current={currentStep}
          items={[
            { title: 'Setup' },
            { title: 'Connect' },
            { title: 'Active' },
          ]}
          style={{ marginBottom: 12 }}
        />

        {!isConnected && (
          <div style={{ marginBottom: 12 }}>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Button
                icon={<VideoCameraOutlined />}
                onClick={handleCreateRoom}
                loading={connState === 'connecting' && !!roomIdDisplay}
                block
              >
                Create Room
              </Button>

              {roomIdDisplay && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    background: 'rgba(54, 207, 201, 0.08)',
                    border: '1px solid rgba(54, 207, 201, 0.2)',
                    borderRadius: 6,
                  }}
                >
                  <Text style={{ color: '#36cfc9', fontFamily: "'JetBrains Mono', monospace", fontSize: 16, letterSpacing: 2 }}>
                    {roomIdDisplay}
                  </Text>
                  <Tooltip title="Copy Room ID">
                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={handleCopyRoomId} />
                  </Tooltip>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  placeholder="Room ID"
                  value={joinRoomInput}
                  onChange={(e) => setJoinRoomInput(e.target.value.toUpperCase())}
                  maxLength={6}
                  style={{ flex: 1, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}
                  onPressEnter={handleJoinRoom}
                />
                <Button icon={<LoginOutlined />} onClick={handleJoinRoom}>
                  Join
                </Button>
              </div>
            </Space>
          </div>
        )}

        {isConnected && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
                padding: '6px 10px',
                background: 'rgba(54, 207, 201, 0.08)',
                border: '1px solid rgba(54, 207, 201, 0.2)',
                borderRadius: 6,
              }}
            >
              <Space size={8}>
                <ClockCircleOutlined style={{ color: '#36cfc9' }} />
                <Text style={{ color: '#e0e8f0', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
                  {formatElapsed(elapsed)}
                </Text>
              </Space>
              <Space size={8}>
                <Text style={{ color: '#5a7a9a', fontSize: 11 }}>Room:</Text>
                <Text style={{ color: '#36cfc9', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                  {roomIdDisplay || getRoomId()}
                </Text>
                <Tooltip title="Copy">
                  <Button size="small" type="text" icon={<CopyOutlined />} onClick={handleCopyRoomId} />
                </Tooltip>
              </Space>
            </div>

            <Space style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}>
              <Tooltip title={showAnnotationTools ? 'Hide Annotation Tools' : 'Show Annotation Tools'}>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  type={showAnnotationTools ? 'primary' : 'default'}
                  onClick={() => setShowAnnotationTools(!showAnnotationTools)}
                >
                  Annotations
                </Button>
              </Tooltip>
              <Tooltip title={showVoiceChat ? 'Hide Voice Chat' : 'Show Voice Chat'}>
                <Button
                  size="small"
                  icon={<SoundOutlined />}
                  type={showVoiceChat ? 'primary' : 'default'}
                  onClick={() => setShowVoiceChat(!showVoiceChat)}
                >
                  Voice
                </Button>
              </Tooltip>
            </Space>

            <Space style={{ width: '100%', justifyContent: 'center' }}>
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                onClick={handleEndSession}
              >
                End Session
              </Button>
            </Space>

            <div style={{ marginTop: 8, fontSize: 11, color: '#5a7a9a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>You: Expert (PC)</span>
                <span style={{ color: '#36cfc9' }}>Online</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Remote: Technician (HoloLens)</span>
                <span style={{ color: '#36cfc9' }}>Online</span>
              </div>
            </div>
          </>
        )}
      </Card>

      {showVoiceChat && isConnected && <VoiceChat />}

      {showAnnotationTools && isConnected && (
        <ExpertAnnotationTool
          r3fCanvas={r3fCanvas}
          sceneRef={sceneRef}
          cameraRef={cameraRef}
          author={author}
          visible={showAnnotationTools}
        />
      )}
    </div>
  );
}
