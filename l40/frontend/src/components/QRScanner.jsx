import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Modal, Input, Button, message, Space } from 'antd';
import { CameraOutlined, KeyOutlined, StopOutlined } from '@ant-design/icons';
import jsQR from 'jsqr';

export default function QRScanner({ open, onClose, onQRDetected }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');

  const stopCamera = useCallback(() => {
    if (scanTimerRef.current) {
      cancelAnimationFrame(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setScanning(true);
      scanFrame();
    } catch (err) {
      console.error('Camera error:', err);
      message.error('无法访问摄像头，请检查权限设置');
    }
  }, []);

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      scanTimerRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    if (code && code.data) {
      message.success(`识别到设备编码: ${code.data}`);
      stopCamera();
      onQRDetected(code.data);
      return;
    }

    scanTimerRef.current = requestAnimationFrame(scanFrame);
  }, [onQRDetected, stopCamera]);

  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [open, startCamera, stopCamera]);

  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (!code) {
      message.warning('请输入设备编码');
      return;
    }
    stopCamera();
    onQRDetected(code);
  };

  const handleClose = () => {
    stopCamera();
    setManualCode('');
    onClose();
  };

  return (
    <Modal
      title={
        <Space>
          <CameraOutlined />
          <span>扫描设备二维码</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      footer={null}
      width={520}
      centered
    >
      <div style={{ position: 'relative', width: '100%', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          style={{
            width: '100%',
            display: scanning ? 'block' : 'none',
            borderRadius: 8,
          }}
          playsInline
          muted
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {scanning && (
          <>
            <div className="qr-scanner-overlay" />
            <div className="qr-scanner-corners"><span /></div>
          </>
        )}

        {!scanning && (
          <div
            style={{
              height: 300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#8ba3c0',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <CameraOutlined style={{ fontSize: 48, opacity: 0.3 }} />
            <span>点击下方按钮启动摄像头</span>
            <Button
              type="primary"
              icon={<CameraOutlined />}
              onClick={startCamera}
            >
              启动摄像头
            </Button>
          </div>
        )}
      </div>

      {scanning && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <Button
            icon={<StopOutlined />}
            onClick={stopCamera}
            danger
            size="small"
          >
            停止扫描
          </Button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div
          style={{
            textAlign: 'center',
            color: '#5a7a9a',
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          — 或手动输入设备编码 —
        </div>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            prefix={<KeyOutlined />}
            placeholder="输入设备编码"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onPressEnter={handleManualSubmit}
          />
          <Button type="primary" onClick={handleManualSubmit}>
            查询
          </Button>
        </Space.Compact>
      </div>
    </Modal>
  );
}
