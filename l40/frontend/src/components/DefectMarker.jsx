import React, { useState, useRef, useCallback } from 'react';
import { Modal, Form, Select, Input, Button, Upload, Space, message } from 'antd';
import { CameraOutlined, AudioOutlined, PictureOutlined, DeleteOutlined, CloudOutlined } from '@ant-design/icons';
import VoiceRecorder from './VoiceRecorder';
import { offlineCache } from '../services/offlineCache';

const { TextArea } = Input;

export default function DefectMarker({ open, position, onClose, onSubmit }) {
  const [form] = Form.useForm();
  const [photoBlob, setPhotoBlob] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [voiceBlob, setVoiceBlob] = useState(null);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

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
      setCameraOpen(true);
    } catch (err) {
      message.error('无法访问摄像头');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }, []);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      setPhotoBlob(blob);
      setPhotoPreview(URL.createObjectURL(blob));
      stopCamera();
      message.success('照片已拍摄');
    }, 'image/jpeg', 0.85);
  }, [stopCamera]);

  const removePhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoBlob(null);
    setPhotoPreview(null);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const description = values.description || '';
      const fullDescription = voiceTranscript
        ? `${description}\n\n[Voice Note]: ${voiceTranscript}`.trim()
        : description;

      const formData = new FormData();
      formData.append('position', JSON.stringify({ x: position.x, y: position.y, z: position.z }));
      formData.append('severity', values.severity);
      formData.append('description', fullDescription);
      formData.append('voice_transcript', voiceTranscript || '');

      if (photoBlob) {
        formData.append('photo', photoBlob, `defect_${Date.now()}.jpg`);
      }
      if (voiceBlob) {
        formData.append('voice', voiceBlob, `voice_${Date.now()}.webm`);
      }

      try {
        await onSubmit(formData);
        setSavedOffline(false);
        message.success('缺陷已记录');
      } catch (err) {
        console.log('Online submit failed, saving offline:', err);
        await offlineCache.addDefect({
          position: { x: position.x, y: position.y, z: position.z },
          severity: values.severity,
          description: fullDescription,
          voice_transcript: voiceTranscript || '',
          photo: photoBlob,
          voice: voiceBlob,
          originalError: err.message,
        });
        setSavedOffline(true);
        message.warning('已离线保存，联网后自动同步');
      }

      form.resetFields();
      removePhoto();
      setVoiceBlob(null);
      setVoiceTranscript('');
    } catch (err) {
      if (err.errorFields) return;
      message.error('提交失败: ' + (err.message || '未知错误'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    stopCamera();
    removePhoto();
    setVoiceBlob(null);
    setVoiceTranscript('');
    setSavedOffline(false);
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title="记录缺陷"
      open={open}
      onCancel={handleCancel}
      width={560}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={submitting}
          onClick={handleSubmit}
        >
          提交缺陷
        </Button>,
      ]}
    >
      {position && (
        <div style={{
          background: '#0f1d32',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 16,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          color: '#36cfc9',
        }}>
          位置: X={position.x?.toFixed(3)} Y={position.y?.toFixed(3)} Z={position.z?.toFixed(3)}
        </div>
      )}

      <Form form={form} layout="vertical" size="middle">
        <Form.Item
          name="severity"
          label="严重程度"
          rules={[{ required: true, message: '请选择严重程度' }]}
        >
          <Select placeholder="选择严重程度">
            <Select.Option value="low">
              <span style={{ color: '#52c41a' }}>● 低</span> - 轻微问题
            </Select.Option>
            <Select.Option value="medium">
              <span style={{ color: '#faad14' }}>● 中</span> - 需要关注
            </Select.Option>
            <Select.Option value="high">
              <span style={{ color: '#fa8c16' }}>● 高</span> - 需要尽快处理
            </Select.Option>
            <Select.Option value="critical">
              <span style={{ color: '#ff4d4f' }}>● 严重</span> - 立即停机
            </Select.Option>
          </Select>
        </Form.Item>

        <Form.Item name="description" label="描述">
          <TextArea
            rows={3}
            placeholder="描述缺陷详情..."
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#8ba3c0', marginBottom: 8 }}>现场照片</div>
        {cameraOpen ? (
          <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden' }}>
            <video
              ref={videoRef}
              style={{ width: '100%', borderRadius: 6 }}
              playsInline
              muted
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <Space style={{ marginTop: 8 }}>
              <Button type="primary" icon={<CameraOutlined />} onClick={capturePhoto}>
                拍照
              </Button>
              <Button onClick={stopCamera}>取消</Button>
            </Space>
          </div>
        ) : photoPreview ? (
          <div style={{ position: 'relative' }}>
            <img
              src={photoPreview}
              alt="defect"
              style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 6 }}
            />
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={removePhoto}
              style={{ position: 'absolute', top: 8, right: 8 }}
            >
              删除
            </Button>
          </div>
        ) : (
          <Space>
            <Button icon={<CameraOutlined />} onClick={startCamera}>
              拍摄照片
            </Button>
            <Upload
              beforeUpload={(file) => {
                setPhotoBlob(file);
                setPhotoPreview(URL.createObjectURL(file));
                return false;
              }}
              showUploadList={false}
              accept="image/*"
            >
              <Button icon={<PictureOutlined />}>选择图片</Button>
            </Upload>
          </Space>
        )}
      </div>

      <div>
        <div style={{ fontSize: 13, color: '#8ba3c0', marginBottom: 8 }}>语音备注</div>
        <VoiceRecorder
          onRecordingComplete={(blob, transcript) => {
            setVoiceBlob(blob);
            setVoiceTranscript(transcript);
          }}
          onTranscriptionChange={(text) => setVoiceTranscript(text)}
        />
        {savedOffline && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: '#1a2d4a', borderRadius: 6, border: '1px solid rgba(250, 173, 20, 0.3)' }}>
            <span style={{ color: '#faad14', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <CloudOutlined />
              Saved offline - will sync when online
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
