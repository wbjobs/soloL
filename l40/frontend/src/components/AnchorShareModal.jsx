import React, { useState, useMemo } from 'react';
import { Modal, Tabs, Input, Button, Tag, Space, message, Select, QRCode, Typography } from 'antd';
import { CopyOutlined, ShareAltOutlined, ImportOutlined, QrcodeOutlined, ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const { Text, Paragraph } = Typography;

const expiryOptions = [
  { value: 1, label: '1 hour' },
  { value: 24, label: '24 hours' },
  { value: 168, label: '7 days' },
  { value: 720, label: '30 days' },
];

export default function AnchorShareModal({
  open,
  anchor,
  onClose,
  onShare,
  onImport,
  isLoading = false,
}) {
  const [activeTab, setActiveTab] = useState('share');
  const [shareCode, setShareCode] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [expiryHours, setExpiryHours] = useState(24);
  const [importCode, setImportCode] = useState('');
  const [shareInfo, setShareInfo] = useState(null);
  const [generating, setGenerating] = useState(false);

  const qrValue = useMemo(() => {
    if (shareUrl) return shareUrl;
    if (shareCode) return `anchor://${shareCode}`;
    return '';
  }, [shareUrl, shareCode]);

  const handleGenerateShare = async () => {
    if (!anchor || !onShare) return;

    setGenerating(true);
    try {
      const result = await onShare(anchor.id, { expiryHours, markAsShared: true });
      setShareCode(result.shareCode);
      setShareUrl(result.shareUrl);
      setShareInfo(result);
      message.success('Share code generated');
    } catch (err) {
      message.error('Failed to generate share code: ' + (err.message || 'Unknown error'));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label} copied to clipboard`);
    } catch (err) {
      message.error('Failed to copy');
    }
  };

  const handleImport = async () => {
    if (!importCode.trim() || !onImport) return;

    try {
      const result = await onImport(importCode.trim());
      message.success('Anchor imported successfully');
      setImportCode('');
      onClose?.();
      return result;
    } catch (err) {
      message.error('Failed to import: ' + (err.message || 'Invalid share code'));
      throw err;
    }
  };

  const handleClose = () => {
    setShareCode('');
    setShareUrl('');
    setShareInfo(null);
    setImportCode('');
    setActiveTab('share');
    onClose?.();
  };

  return (
    <Modal
      title={
        <Space>
          <ShareAltOutlined style={{ color: '#36cfc9' }} />
          <span>{activeTab === 'share' ? 'Share Anchor' : 'Import Anchor'}</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={520}
      footer={null}
      destroyOnClose
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        centered
        items={[
          {
            key: 'share',
            label: (
              <Space>
                <ShareAltOutlined />
                Share
              </Space>
            ),
            children: (
              <div className="fade-in">
                {anchor && (
                  <div
                    style={{
                      background: '#0f1d32',
                      borderRadius: 6,
                      padding: '12px 16px',
                      marginBottom: 16,
                    }}
                  >
                    <div style={{ fontSize: 12, color: '#5a7a9a', marginBottom: 4 }}>
                      Anchor ID
                    </div>
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 13,
                        color: '#36cfc9',
                        wordBreak: 'break-all',
                      }}
                    >
                      {anchor.id || anchor.anchor_id}
                    </div>
                    {anchor.creator && (
                      <div style={{ fontSize: 12, color: '#8ba3c0', marginTop: 8 }}>
                        Created by: {anchor.creator}
                      </div>
                    )}
                    {anchor.position && (
                      <div
                        style={{
                          fontSize: 11,
                          color: '#5a7a9a',
                          fontFamily: "'JetBrains Mono', monospace",
                          marginTop: 4,
                        }}
                      >
                        Pos: X={anchor.position.x?.toFixed(3)} Y={anchor.position.y?.toFixed(3)} Z={anchor.position.z?.toFixed(3)}
                      </div>
                    )}
                  </div>
                )}

                {!shareInfo ? (
                  <div>
                    <div style={{ fontSize: 13, color: '#8ba3c0', marginBottom: 8 }}>
                      Expiry Time
                    </div>
                    <Select
                      value={expiryHours}
                      onChange={setExpiryHours}
                      style={{ width: '100%', marginBottom: 16 }}
                      options={expiryOptions}
                    />
                    <Button
                      type="primary"
                      icon={<QrcodeOutlined />}
                      onClick={handleGenerateShare}
                      loading={generating || isLoading}
                      block
                      size="large"
                    >
                      Generate Share Code
                    </Button>
                  </div>
                ) : (
                  <div>
                    {qrValue && (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'center',
                          padding: 24,
                          background: '#fff',
                          borderRadius: 8,
                          marginBottom: 16,
                        }}
                      >
                        <QRCode
                          value={qrValue}
                          size={180}
                          color="#0a1628"
                          bgColor="#fff"
                        />
                      </div>
                    )}

                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: '#8ba3c0', marginBottom: 6 }}>
                        Share Code
                      </div>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          value={shareCode}
                          readOnly
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 18,
                            letterSpacing: 4,
                            textAlign: 'center',
                          }}
                        />
                        <Button
                          icon={<CopyOutlined />}
                          onClick={() => handleCopy(shareCode, 'Share code')}
                        />
                      </Space.Compact>
                    </div>

                    {shareUrl && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, color: '#8ba3c0', marginBottom: 6 }}>
                          Share URL
                        </div>
                        <Space.Compact style={{ width: '100%' }}>
                          <Input
                            value={shareUrl}
                            readOnly
                            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
                          />
                          <Button
                            icon={<CopyOutlined />}
                            onClick={() => handleCopy(shareUrl, 'Share URL')}
                          />
                        </Space.Compact>
                      </div>
                    )}

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: '#0f1d32',
                        borderRadius: 6,
                        marginBottom: 16,
                      }}
                    >
                      <Space>
                        <ClockCircleOutlined style={{ color: '#faad14' }} />
                        <span style={{ fontSize: 12, color: '#8ba3c0' }}>
                          Expires
                        </span>
                      </Space>
                      <span style={{ fontSize: 12, color: '#e0e8f0' }}>
                        {shareInfo.expiresAt
                          ? dayjs(shareInfo.expiresAt).format('YYYY-MM-DD HH:mm')
                          : dayjs().add(expiryHours, 'hour').format('YYYY-MM-DD HH:mm')}
                      </span>
                    </div>

                    {shareInfo.isLocal && (
                      <Tag color="warning" style={{ width: '100%', textAlign: 'center', padding: '4px 0' }}>
                        ⚠ Local share only - works offline on this device
                      </Tag>
                    )}

                    <Button
                      onClick={() => {
                        setShareInfo(null);
                        setShareCode('');
                        setShareUrl('');
                      }}
                      block
                      style={{ marginTop: 8 }}
                    >
                      Generate New Code
                    </Button>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'import',
            label: (
              <Space>
                <ImportOutlined />
                Import
              </Space>
            ),
            children: (
              <div className="fade-in">
                <Paragraph style={{ color: '#8ba3c0', marginBottom: 16 }}>
                  Enter a 6-character share code to import an anchor from another device.
                </Paragraph>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: '#8ba3c0', marginBottom: 6 }}>
                    Share Code
                  </div>
                  <Input
                    value={importCode}
                    onChange={(e) => setImportCode(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                    maxLength={6}
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 24,
                      letterSpacing: 8,
                      textAlign: 'center',
                      textTransform: 'uppercase',
                    }}
                    onPressEnter={handleImport}
                  />
                </div>

                <div
                  style={{
                    padding: '12px 16px',
                    background: 'rgba(54, 207, 201, 0.05)',
                    border: '1px solid rgba(54, 207, 201, 0.2)',
                    borderRadius: 6,
                    marginBottom: 16,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    💡 Tips:
                    <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                      <li>Codes are case-insensitive</li>
                      <li>Offline imports work with locally generated codes</li>
                      <li>Imported anchors are saved to your local device</li>
                    </ul>
                  </Text>
                </div>

                <Button
                  type="primary"
                  icon={<ImportOutlined />}
                  onClick={handleImport}
                  loading={isLoading}
                  disabled={!importCode.trim() || importCode.length !== 6}
                  block
                  size="large"
                >
                  Import Anchor
                </Button>
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}
