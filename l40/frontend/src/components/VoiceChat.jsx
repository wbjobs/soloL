import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Tooltip, Slider, Badge } from 'antd';
import {
  AudioOutlined,
  AudioMutedOutlined,
  SoundOutlined,
  PhoneOutlined,
} from '@ant-design/icons';
import { startVoice, stopVoice, onRemoteStream, getConnectionState, onConnectionStateChange } from '../services/webrtc';

export default function VoiceChat() {
  const [micOn, setMicOn] = useState(false);
  const [volume, setVolume] = useState(80);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);
  const [connState, setConnState] = useState(getConnectionState());
  const [position, setPosition] = useState({ x: 16, y: 200 });

  const audioRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const animFrameRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const unsub = onConnectionStateChange(setConnState);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onRemoteStream((stream) => {
      remoteStreamRef.current = stream;
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
      }
      setupRemoteAnalyser(stream);
    });
    return unsub;
  }, []);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  function setupRemoteAnalyser(stream) {
    try {
      if (audioContextRef.current) audioContextRef.current.close();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setRemoteSpeaking(avg > 15);
        animFrameRef.current = requestAnimationFrame(checkLevel);
      };
      checkLevel();
    } catch (e) {
      console.error('[VoiceChat] Remote analyser setup error:', e);
    }
  }

  const toggleMic = useCallback(async () => {
    if (micOn) {
      stopVoice();
      setMicOn(false);
    } else {
      const ok = await startVoice();
      setMicOn(ok);
    }
  }, [micOn]);

  const handleVolumeChange = useCallback((val) => {
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val / 100;
    }
  }, []);

  const handleDragStart = useCallback((e) => {
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      origX: position.x,
      origY: position.y,
    };
  }, [position]);

  const handleDragMove = useCallback((e) => {
    if (!dragRef.current) return;
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    setPosition({
      x: dragRef.current.origX + dx,
      y: dragRef.current.origY + dy,
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    if (!dragRef.current) return;
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove);
    window.addEventListener('touchend', handleDragEnd);
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  const connColor =
    connState === 'connected' ? '#52c41a' :
    connState === 'connecting' ? '#faad14' :
    connState === 'disconnected' ? '#ff4d4f' : '#8ba3c0';

  return (
    <div
      style={{
        position: 'absolute',
        right: position.x,
        top: position.y,
        zIndex: 100,
        background: 'rgba(10, 22, 40, 0.92)',
        backdropFilter: 'blur(8px)',
        border: `1px solid ${remoteSpeaking ? 'rgba(54, 207, 201, 0.6)' : 'rgba(54, 207, 201, 0.2)'}`,
        borderRadius: 8,
        padding: '8px 12px',
        minWidth: 180,
        transition: 'border-color 0.2s',
        userSelect: 'none',
      }}
    >
      <div
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        style={{
          cursor: 'move',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 11, color: '#5a7a9a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Voice Chat
        </span>
        <Badge color={connColor} text={<span style={{ fontSize: 10, color: connColor }}>{connState}</span>} />
      </div>

      <audio ref={audioRef} autoPlay volume={volume / 100} style={{ display: 'none' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tooltip title={micOn ? 'Mute Mic' : 'Unmute Mic'}>
          <Button
            size="small"
            type={micOn ? 'primary' : 'default'}
            danger={micOn}
            icon={micOn ? <AudioOutlined /> : <AudioMutedOutlined />}
            onClick={toggleMic}
          />
        </Tooltip>

        <SoundOutlined style={{ color: '#8ba3c0', fontSize: 14 }} />
        <Slider
          min={0}
          max={100}
          value={volume}
          onChange={handleVolumeChange}
          style={{ flex: 1, margin: 0 }}
          tooltip={{ formatter: (v) => `${v}%` }}
        />

        {remoteSpeaking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {[8, 12, 6, 10].map((h, i) => (
              <div
                key={i}
                style={{
                  width: 3,
                  height: h,
                  background: '#36cfc9',
                  borderRadius: 2,
                  animation: 'pulse 0.5s ease infinite alternate',
                }}
              />
            ))}
          </div>
        )}

        <Tooltip title="Connection Quality">
          <PhoneOutlined style={{ color: connColor, fontSize: 14 }} />
        </Tooltip>
      </div>

      <style>{`
        @keyframes pulse {
          from { opacity: 0.5; transform: scaleY(0.7); }
          to { opacity: 1; transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}
