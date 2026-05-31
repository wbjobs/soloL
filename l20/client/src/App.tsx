import { useState, useEffect, useRef, useCallback } from 'react';
import { useCamera } from './hooks/useCamera';
import { useSelfieSegmentation } from './hooks/useSelfieSegmentation';
import { useFaceMesh } from './hooks/useFaceMesh';
import { usePerformance } from './hooks/usePerformance';
import { useSocket } from './hooks/useSocket';
import { useConfig } from './hooks/useConfig';
import { useHandGesture } from './hooks/useHandGesture';
import { useStatistics } from './hooks/useStatistics';
import { AvatarViewer, AVATAR_MODELS } from './components/AvatarViewer';
import { PerformanceMonitor } from './components/PerformanceMonitor';
import { BackgroundConfig, GestureType } from './types';

const userId = 'user_' + Math.random().toString(36).substr(2, 9);
const BACKGROUND_IMAGES = [
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&h=1080&fit=crop',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1920&h=1080&fit=crop',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1920&h=1080&fit=crop'
];

const GESTURE_LABELS: Record<GestureType, string> = {
  fist: '✊ 握拳 → 星空',
  ok: '👌 OK → 办公室',
  victory: '✌️ V字 → 模糊',
  none: '无手势'
};

function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<string>('default');
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const animationFrameRef = useRef<number>(0);

  const { metrics, startFrame, endFrame, measureSegmentationAsync, measureFaceMeshAsync } = usePerformance();

  const { outputCanvasRef, setBackground, isReady: segmentationReady, initialize: initSegmentation, send: sendSegmentation } =
    useSelfieSegmentation();

  const { blendShapes, isReady: faceMeshReady, initialize: initFaceMesh, send: sendFaceMesh } =
    useFaceMesh();

  const { isConnected, roomUsers, connect: connectSocket, joinRoom } = useSocket({
    onBackgroundUpdated: (bg) => {
      setBackground(bg);
    }
  });

  const { fetchConfig, updateAvatar: saveAvatar } = useConfig(userId);
  const { reportBackgroundStart, reportGesture } = useStatistics(userId);

  const {
    isReady: gestureReady,
    currentGesture,
    initialize: initHandGesture,
    send: sendHandGesture
  } = useHandGesture(
    (config) => {
      setBackground(config);
      reportBackgroundStart(config);
    },
    (gesture: GestureType) => {
      reportGesture(gesture, gesture);
    }
  );

  const handleBackgroundChange = useCallback((type: BackgroundConfig['type'], url?: string) => {
    const config: BackgroundConfig = { type, url };
    setBackground(config);
    reportBackgroundStart(config);
  }, [setBackground, reportBackgroundStart]);

  const handleBlurChange = useCallback((amount: number) => {
    const config: BackgroundConfig = { type: 'blur', blurAmount: amount };
    setBackground(config);
    reportBackgroundStart(config);
  }, [setBackground, reportBackgroundStart]);

  const handleAvatarSelect = useCallback((avatarId: string) => {
    setSelectedAvatar(avatarId);
    saveAvatar(avatarId);
  }, [saveAvatar]);

  const handleJoinRoom = useCallback(() => {
    if (inputRoomId.trim()) {
      joinRoom(inputRoomId.trim(), userId);
      setRoomId(inputRoomId.trim());
    }
  }, [inputRoomId, joinRoom]);

  useEffect(() => {
    const initialize = async () => {
      try {
        await Promise.all([initSegmentation(), initFaceMesh(), initHandGesture()]);
        connectSocket();
        fetchConfig();

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1920, height: 1080, frameRate: 30 },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setIsInitialized(true);
      } catch (error) {
        console.error('Initialization failed:', error);
      }
    };

    initialize();
  }, [initSegmentation, initFaceMesh, initHandGesture, connectSocket, fetchConfig]);

  useEffect(() => {
    if (!isInitialized || !videoRef.current || !segmentationReady || !faceMeshReady) return;

    let lastTime = 0;
    let frameCount = 0;
    const targetInterval = 1000 / 30;

    const processFrame = async (currentTime: number) => {
      animationFrameRef.current = requestAnimationFrame(processFrame);

      if (currentTime - lastTime < targetInterval) return;
      if (!videoRef.current || videoRef.current.readyState < 2) return;

      lastTime = currentTime;
      frameCount++;
      startFrame();

      await measureSegmentationAsync(() => sendSegmentation(videoRef.current!));
      await measureFaceMeshAsync(() => sendFaceMesh(videoRef.current!));

      if (gestureReady && frameCount % 3 === 0) {
        sendHandGesture(videoRef.current!);
      }

      endFrame();
    };

    animationFrameRef.current = requestAnimationFrame(processFrame);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isInitialized, segmentationReady, faceMeshReady, gestureReady, startFrame, endFrame, sendSegmentation, sendFaceMesh, sendHandGesture, measureSegmentationAsync, measureFaceMeshAsync]);

  const selectedAvatarModel = AVATAR_MODELS.find(a => a.id === selectedAvatar);

  return (
    <div className="app-container">
      <div className="room-panel">
        <div className="room-input">
          <input
            type="text"
            placeholder="输入房间号加入房间..."
            value={inputRoomId}
            onChange={(e) => setInputRoomId(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleJoinRoom()}
          />
          <button className="btn" onClick={handleJoinRoom}>
            {roomId ? '已加入: ' + roomId : '加入房间'}
          </button>
          <span style={{ color: isConnected ? '#4ade80' : '#f87171', fontSize: '12px', alignSelf: 'center' }}>
            {isConnected ? '● 已连接' : '● 未连接'}
          </span>
        </div>
        {roomUsers.length > 0 && (
          <div className="room-users">
            {roomUsers.map((user, idx) => (
              <span key={idx} className="user-chip">
                {user.userId.slice(0, 8)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="main-content">
        <div className="video-panel">
          <div className="video-container">
            <video
              ref={videoRef}
              className="video-canvas hidden"
              playsInline
              muted
            />
            <canvas
              ref={outputCanvasRef}
              className="segmentation-canvas"
            />
          </div>
          <PerformanceMonitor metrics={metrics} />

          {currentGesture.gesture !== 'none' && (
            <div style={{
              position: 'absolute', top: 80, right: 16,
              background: 'rgba(99, 102, 241, 0.9)',
              padding: '8px 14px', borderRadius: 8,
              fontSize: 14, fontWeight: 600, zIndex: 100
            }}>
              {GESTURE_LABELS[currentGesture.gesture]}
              <span style={{ marginLeft: 8, opacity: 0.7, fontSize: 12 }}>
                {(currentGesture.confidence * 100).toFixed(0)}%
              </span>
            </div>
          )}

          <div className="control-panel" style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
            <div className="control-section">
              <div className="control-label">手势识别换背景</div>
              <div className="button-group" style={{ fontSize: 12, gap: 12 }}>
                <span>✊ 握拳 → 星空</span>
                <span>👌 OK → 办公室</span>
                <span>✌️ V字 → 模糊</span>
              </div>
            </div>

            <div className="control-section">
              <div className="control-label">背景效果</div>
              <div className="button-group">
                <button
                  className="btn"
                  onClick={() => handleBackgroundChange('none')}
                >
                  原始
                </button>
                <button
                  className="btn"
                  onClick={() => handleBlurChange(15)}
                >
                  模糊
                </button>
                <button
                  className="btn"
                  onClick={() => handleBackgroundChange('image', BACKGROUND_IMAGES[0])}
                >
                  图片1
                </button>
                <button
                  className="btn"
                  onClick={() => handleBackgroundChange('image', BACKGROUND_IMAGES[1])}
                >
                  图片2
                </button>
                <button
                  className="btn"
                  onClick={() => handleBackgroundChange('image', BACKGROUND_IMAGES[2])}
                >
                  图片3
                </button>
              </div>
            </div>

            <div className="control-section">
              <div className="control-label">模糊程度: 15px</div>
              <input
                type="range"
                className="slider"
                min="0"
                max="50"
                defaultValue="15"
                onChange={(e) => handleBlurChange(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div className="avatar-panel">
          <div className="avatar-viewer">
            <AvatarViewer
              modelUrl={selectedAvatarModel?.url}
              blendShapes={blendShapes}
            />
          </div>

          <div className="control-panel">
            <div className="control-section">
              <div className="control-label">选择虚拟形象</div>
              <div className="avatar-selector">
                {AVATAR_MODELS.map((avatar) => (
                  <div
                    key={avatar.id}
                    className={`avatar-item ${selectedAvatar === avatar.id ? 'active' : ''}`}
                    onClick={() => handleAvatarSelect(avatar.id)}
                    title={avatar.name}
                  >
                    <img src={avatar.thumbnail} alt={avatar.name} />
                  </div>
                ))}
              </div>
            </div>

            <div className="control-section">
              <div className="control-label">表情参数 (前8项)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px', fontSize: '11px' }}>
                {Object.entries(blendShapes)
                  .slice(0, 8)
                  .map(([key, value]) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>{key.slice(0, 10)}:</span>
                      <span style={{ color: (value as number) > 0.5 ? '#4ade80' : '#f1f5f9' }}>
                        {((value as number) * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
