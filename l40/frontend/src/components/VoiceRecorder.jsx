import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Space, Input, Tag, Tooltip, message } from 'antd';
import { AudioOutlined, StopOutlined, SoundOutlined, SyncOutlined, CloudOutlined, CloudServerOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { startRecognition, stopRecognition, isDemoMode, isCurrentlyRecognizing } from '../services/azureSpeech';
import { offlineCache } from '../services/offlineCache';

const { TextArea } = Input;

export default function VoiceRecorder({ onRecordingComplete, onTranscriptionChange }) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioBlob, setAudioBlob] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionMode, setTranscriptionMode] = useState('demo');
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState('');
  const [syncStatus, setSyncStatus] = useState('synced');
  const [retryIn, setRetryIn] = useState(0);
  const [waveformBars, setWaveformBars] = useState(Array(12).fill(2));

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const pressTimerRef = useRef(null);
  const isLongPress = useRef(false);
  const animationRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);

  const finalTranscriptsRef = useRef([]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      stopRecognition();
    };
  }, []);

  const animateWaveform = useCallback(() => {
    if (!analyserRef.current || !dataArrayRef.current) return;

    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    const newBars = Array(12).fill(0).map((_, i) => {
      const index = Math.floor(i * dataArrayRef.current.length / 12);
      const value = dataArrayRef.current[index] || 0;
      return Math.max(2, Math.floor(value / 15));
    });
    setWaveformBars(newBars);

    if (recording) {
      animationRef.current = requestAnimationFrame(animateWaveform);
    }
  }, [recording]);

  const setupAudioAnalysis = useCallback(async (stream) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      animateWaveform();
    } catch (err) {
      console.log('Audio analysis not available');
    }
  }, [animateWaveform]);

  const startRecording = useCallback(async (continuous = false) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      setupAudioAnalysis(stream);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      finalTranscriptsRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);

        const fullTranscript = finalTranscriptsRef.current.join(' ').trim();
        setTranscript(fullTranscript);
        setPartialTranscript('');

        try {
          if (!offlineCache.isOnline) {
            setSyncStatus('pending');
            await offlineCache.addVoiceRecording({
              audioBlob: blob,
              transcript: fullTranscript,
              duration,
            });
            message.info('Recording saved offline');
          } else if (onRecordingComplete) {
            await onRecordingComplete(blob, fullTranscript);
            setSyncStatus('synced');
          }
        } catch (err) {
          console.error('Recording save error:', err);
          setSyncStatus('pending');
          await offlineCache.addVoiceRecording({
            audioBlob: blob,
            transcript: fullTranscript,
            duration,
          });
          message.warning('Saved offline - will sync when online');
        }

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }

        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        setWaveformBars(Array(12).fill(2));
        setIsTranscribing(false);
      };

      mediaRecorder.start(100);
      setRecording(true);
      setDuration(0);
      setTranscript('');
      setPartialTranscript('');
      setSyncStatus('synced');

      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);

      setIsTranscribing(true);
      const result = await startRecognition({
        onPartial: (text) => {
          setPartialTranscript(text);
        },
        onFinal: (text) => {
          if (text.trim()) {
            finalTranscriptsRef.current.push(text.trim());
            const fullText = finalTranscriptsRef.current.join(' ').trim();
            setTranscript(fullText);
            if (onTranscriptionChange) {
              onTranscriptionChange(fullText);
            }
          }
        },
        onError: (err) => {
          console.log('Speech recognition error:', err);
          if (err.message.includes('unreachable')) {
            message.warning('Speech service unavailable - recording audio only');
            setSyncStatus('pending');
          }
        },
        onStart: () => {
          setTranscriptionMode(isDemoMode() ? 'demo' : 'azure');
        },
      });

      setTranscriptionMode(result.mode);
    } catch (err) {
      console.error('Microphone error:', err);
      message.error('Could not access microphone');
    }
  }, [onRecordingComplete, onTranscriptionChange, setupAudioAnalysis, duration]);

  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    await stopRecognition();
  }, []);

  const handleMouseDown = useCallback(() => {
    isLongPress.current = false;
    pressTimerRef.current = setTimeout(() => {
      isLongPress.current = true;
      startRecording(true);
    }, 500);
  }, [startRecording]);

  const handleMouseUp = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (!isLongPress.current && !recording) {
      startRecording(false);
    } else if (recording) {
      stopRecording();
    }
  }, [recording, startRecording, stopRecording]);

  const handleMouseLeave = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  const startEditTranscript = useCallback(() => {
    setEditedTranscript(transcript);
    setEditingTranscript(true);
  }, [transcript]);

  const saveEditTranscript = useCallback(() => {
    setTranscript(editedTranscript);
    setEditingTranscript(false);
    if (onTranscriptionChange) {
      onTranscriptionChange(editedTranscript);
    }
  }, [editedTranscript, onTranscriptionChange]);

  const cancelEditTranscript = useCallback(() => {
    setEditedTranscript(transcript);
    setEditingTranscript(false);
  }, [transcript]);

  const handleRetrySync = useCallback(async () => {
    if (!offlineCache.isOnline) {
      message.error('Still offline - cannot sync');
      return;
    }
    setSyncStatus('retrying');
    await offlineCache.flushQueue();
    message.info('Syncing...');
  }, []);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getSyncStatusDisplay = () => {
    if (syncStatus === 'synced') {
      return { icon: <CloudServerOutlined />, text: 'Synced', color: '#52c41a' };
    }
    if (syncStatus === 'pending') {
      return { icon: <CloudOutlined />, text: 'Pending upload', color: '#faad14' };
    }
    if (syncStatus === 'retrying') {
      return { icon: <SyncOutlined spin />, text: `Will retry in ${retryIn}s`, color: '#fa8c16' };
    }
    return { icon: <CloudOutlined />, text: 'Transcription pending', color: '#8ba3c0' };
  };

  const syncDisplay = getSyncStatusDisplay();

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {recording ? (
          <div className="recording-indicator" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="recording-dot" />
            <span style={{ color: '#ff4d4f', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
              {formatTime(duration)}
            </span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 20 }}>
              {waveformBars.map((height, i) => (
                <div
                  key={i}
                  style={{
                    width: 3,
                    height: `${height}px`,
                    background: 'linear-gradient(to top, #36cfc9, #5ed8d8)',
                    borderRadius: 2,
                    transition: 'height 0.1s ease',
                  }}
                />
              ))}
            </div>
          </div>
        ) : audioUrl ? (
          <Space>
            <SoundOutlined style={{ color: '#36cfc9' }} />
            <span style={{ color: '#8ba3c0', fontSize: 12 }}>Recorded {formatTime(duration)}</span>
            {transcriptionMode === 'demo' && (
              <Tag color="gold" size="small">Demo Mode</Tag>
            )}
          </Space>
        ) : null}

        {recording ? (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={stopRecording}
            size="small"
          >
            Stop
          </Button>
        ) : (
          <Tooltip title="Short press: voice note | Long press: continuous dictation">
            <Button
              icon={<AudioOutlined />}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onTouchStart={handleMouseDown}
              onTouchEnd={handleMouseUp}
              size="small"
            >
              {audioUrl ? 'Re-record' : 'Record'}
            </Button>
          </Tooltip>
        )}

        {isTranscribing && (
          <Tag color="processing" icon={<SyncOutlined spin />}>
            Listening...
          </Tag>
        )}
      </div>

      {isTranscribing && (partialTranscript || transcript) && (
        <div
          style={{
            background: '#0f1d32',
            border: '1px solid rgba(54, 207, 201, 0.3)',
            borderRadius: 6,
            padding: '10px 12px',
            marginBottom: 12,
            minHeight: 40,
          }}
        >
          <div style={{ color: '#36cfc9', fontSize: 13, marginBottom: 4 }}>
            {transcript}
            {partialTranscript && (
              <span style={{ color: '#8ba3c0', fontStyle: 'italic' }}>
                {transcript ? ' ' : ''}{partialTranscript}
              </span>
            )}
          </div>
        </div>
      )}

      {audioUrl && transcript && !isTranscribing && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#8ba3c0' }}>Transcription</span>
            <Space size="small">
              <span style={{ fontSize: 11, color: syncDisplay.color, display: 'flex', alignItems: 'center', gap: 4 }}>
                {syncDisplay.icon}
                {syncDisplay.text}
              </span>
              {syncStatus === 'pending' && (
                <Button
                  type="link"
                  size="small"
                  icon={<SyncOutlined />}
                  onClick={handleRetrySync}
                  style={{ padding: 0, height: 'auto', fontSize: 11 }}
                >
                  Retry
                </Button>
              )}
              {!editingTranscript && (
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={startEditTranscript}
                  style={{ padding: 0, height: 'auto', fontSize: 11 }}
                >
                  Edit
                </Button>
              )}
            </Space>
          </div>
          {editingTranscript ? (
            <div>
              <TextArea
                value={editedTranscript}
                onChange={(e) => setEditedTranscript(e.target.value)}
                rows={3}
                autoSize
                style={{ marginBottom: 8 }}
              />
              <Space size="small">
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={saveEditTranscript}
                >
                  Save
                </Button>
                <Button
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={cancelEditTranscript}
                >
                  Cancel
                </Button>
              </Space>
            </div>
          ) : (
            <div
              style={{
                background: '#0f1d32',
                border: '1px solid rgba(54, 207, 201, 0.2)',
                borderRadius: 6,
                padding: '10px 12px',
                color: '#e0e8f0',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {transcript || 'No transcription available'}
            </div>
          )}
        </div>
      )}

      {audioUrl && !transcript && !isTranscribing && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#8ba3c0' }}>Audio Recording</span>
            <span style={{ fontSize: 11, color: '#faad14', display: 'flex', alignItems: 'center', gap: 4 }}>
              <CloudOutlined />
              Transcription pending
            </span>
          </div>
          <audio src={audioUrl} controls style={{ width: '100%', height: 36 }} />
        </div>
      )}

      {audioUrl && !editingTranscript && (
        <audio src={audioUrl} controls style={{ width: '100%', height: 36 }} />
      )}
    </div>
  );
}
