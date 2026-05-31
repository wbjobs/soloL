import React, { useState, useCallback } from 'react';
import {
  List,
  Button,
  Tag,
  Card,
  Space,
  Typography,
  Input,
  Modal,
  message,
  Badge,
  Tooltip,
  Empty,
  Descriptions,
  Dropdown,
} from 'antd';
import {
  PlusOutlined,
  ShareAltOutlined,
  DeleteOutlined,
  SyncOutlined,
  ImportOutlined,
  EnvironmentOutlined,
  UserOutlined,
  ClockCircleOutlined,
  MoreOutlined,
  WarningOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import AnchorShareModal from './AnchorShareModal';
import { offlineCache } from '../services/offlineCache';

const { Text, Title } = Typography;

const statusColors = {
  located: 'success',
  locating: 'processing',
  failed: 'error',
  pending: 'warning',
  synced: 'success',
};

const statusText = {
  located: 'Located',
  locating: 'Locating...',
  failed: 'Failed',
  pending: 'Pending Sync',
  synced: 'Synced',
};

export default function AnchorManager({
  anchors,
  sessionStatus,
  isDemoMode,
  pendingCount,
  isLoading,
  onCreateAnchor,
  onLocateAnchor,
  onDeleteAnchor,
  onShareAnchor,
  onImportAnchor,
  onUpdateAnchor,
  onRefresh,
  onRetryPending,
  currentCameraPosition,
}) {
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [selectedAnchor, setSelectedAnchor] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [createMode, setCreateMode] = useState(false);
  const [anchorName, setAnchorName] = useState('');

  const handleCreateAnchor = useCallback(async () => {
    if (!currentCameraPosition) {
      message.error('Camera position not available');
      return;
    }

    try {
      const anchor = await onCreateAnchor(
        currentCameraPosition,
        { x: 0, y: 0, z: 0, w: 1 },
        { name: anchorName || undefined }
      );
      message.success('Anchor created successfully');
      setAnchorName('');
      setCreateMode(false);
      return anchor;
    } catch (err) {
      message.error('Failed to create anchor: ' + (err.message || 'Unknown error'));
      throw err;
    }
  }, [currentCameraPosition, anchorName, onCreateAnchor]);

  const handleDeleteAnchor = useCallback(async (anchor) => {
    try {
      await onDeleteAnchor(anchor.id || anchor.anchor_id);
      message.success('Anchor deleted');
      setDeleteConfirm(null);
    } catch (err) {
      message.error('Failed to delete anchor: ' + (err.message || 'Unknown error'));
    }
  }, [onDeleteAnchor]);

  const handleShareClick = useCallback((anchor) => {
    setSelectedAnchor(anchor);
    setShareModalOpen(true);
  }, []);

  const handleDetailClick = useCallback((anchor) => {
    setSelectedAnchor(anchor);
    setDetailModalOpen(true);
  }, []);

  const getMenuItems = (anchor) => [
    {
      key: 'share',
      label: 'Share',
      icon: <ShareAltOutlined />,
      onClick: () => handleShareClick(anchor),
    },
    {
      key: 'locate',
      label: 'Re-locate',
      icon: <EnvironmentOutlined />,
      onClick: () => onLocateAnchor?.(anchor.id || anchor.anchor_id),
    },
    {
      type: 'divider',
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => setDeleteConfirm(anchor),
    },
  ];

  return (
    <>
      <Card
        className="glass-card"
        style={{ height: '100%' }}
        title={
          <Space>
            <EnvironmentOutlined style={{ color: '#36cfc9' }} />
            <span>Spatial Anchors</span>
            {isDemoMode && (
              <Tag color="warning" style={{ marginLeft: 8 }}>
                Demo Mode
              </Tag>
            )}
          </Space>
        }
        extra={
          <Space size={4}>
            {pendingCount > 0 && (
              <Tooltip title={`${pendingCount} pending operations`}>
                <Badge count={pendingCount} size="small">
                  <Button
                    size="small"
                    icon={<SyncOutlined spin />}
                    onClick={onRetryPending}
                  >
                    Sync
                  </Button>
                </Badge>
              </Tooltip>
            )}
            <Tooltip title="Refresh anchors">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={onRefresh}
                loading={isLoading}
              />
            </Tooltip>
            <Button
              size="small"
              icon={<ImportOutlined />}
              onClick={() => {
                setSelectedAnchor(null);
                setShareModalOpen(true);
              }}
            >
              Import
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateMode(true)}
            >
              Create
            </Button>
          </Space>
        }
        styles={{ body: { padding: 12, height: 'calc(100% - 57px)', overflowY: 'auto' } }}
      >
        {createMode && (
          <div
            className="fade-in"
            style={{
              background: 'rgba(54, 207, 201, 0.05)',
              border: '1px solid rgba(54, 207, 201, 0.3)',
              borderRadius: 6,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 13, color: '#36cfc9', fontWeight: 500, marginBottom: 8 }}>
              Create Anchor at Current Position
            </div>
            {currentCameraPosition && (
              <div
                style={{
                  fontSize: 11,
                  color: '#5a7a9a',
                  fontFamily: "'JetBrains Mono', monospace",
                  marginBottom: 8,
                  background: '#0f1d32',
                  padding: '6px 10px',
                  borderRadius: 4,
                }}
              >
                X: {currentCameraPosition.x?.toFixed(3)} Y: {currentCameraPosition.y?.toFixed(3)} Z: {currentCameraPosition.z?.toFixed(3)}
              </div>
            )}
            <Input
              placeholder="Anchor name (optional)"
              value={anchorName}
              onChange={(e) => setAnchorName(e.target.value)}
              style={{ marginBottom: 8 }}
              onPressEnter={handleCreateAnchor}
            />
            <Space>
              <Button type="primary" onClick={handleCreateAnchor} loading={isLoading}>
                Create Anchor
              </Button>
              <Button
                onClick={() => {
                  setCreateMode(false);
                  setAnchorName('');
                }}
              >
                Cancel
              </Button>
            </Space>
          </div>
        )}

        {sessionStatus !== 'ready' && sessionStatus !== 'idle' && (
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(24, 144, 255, 0.1)',
              border: '1px solid rgba(24, 144, 255, 0.3)',
              borderRadius: 6,
              marginBottom: 12,
              fontSize: 12,
              color: '#1890ff',
            }}
          >
            <SyncOutlined spin style={{ marginRight: 6 }} />
            Session: {sessionStatus}
          </div>
        )}

        {!anchors || anchors.length === 0 ? (
          <Empty
            description={
              <div style={{ color: '#5a7a9a' }}>
                <EnvironmentOutlined style={{ fontSize: 32, marginBottom: 8 }} />
                <div>No anchors nearby</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  Create an anchor to mark important locations
                </div>
              </div>
            }
            style={{ marginTop: 32 }}
          />
        ) : (
          <List
            size="small"
            dataSource={anchors}
            renderItem={(anchor) => {
              const anchorId = anchor.id || anchor.anchor_id;
              const status = anchor.status || 'located';
              const isLocal = anchor.isLocal || anchor.shared === false;
              const distance = anchor.distance != null
                ? `${anchor.distance.toFixed(2)}m`
                : null;

              return (
                <List.Item
                  key={anchorId}
                  onClick={() => handleDetailClick(anchor)}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 12px',
                    borderRadius: 6,
                    marginBottom: 6,
                    background: '#0f1d32',
                    border: '1px solid transparent',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#1a3352';
                    e.currentTarget.style.borderColor = 'rgba(54, 207, 201, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#0f1d32';
                    e.currentTarget.style.borderColor = 'transparent';
                  }}
                >
                  <List.Item.Meta
                    avatar={
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          background: isLocal ? 'rgba(54, 207, 201, 0.15)' : 'rgba(250, 173, 20, 0.15)',
                          border: `2px solid ${isLocal ? '#36cfc9' : '#faad14'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <EnvironmentOutlined
                          style={{ color: isLocal ? '#36cfc9' : '#faad14', fontSize: 16 }}
                        />
                      </div>
                    }
                    title={
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Space>
                          <Text
                            style={{
                              color: '#e0e8f0',
                              fontSize: 13,
                              fontWeight: 500,
                              maxWidth: 140,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {anchor.name || `Anchor ${anchorId.substr(-6).toUpperCase()}`}
                          </Text>
                          {anchor.isDemo && (
                            <Tag color="warning" style={{ fontSize: 10, margin: 0 }}>
                              DEMO
                            </Tag>
                          )}
                        </Space>
                        <Dropdown
                          menu={{ items: getMenuItems(anchor) }}
                          trigger={['click']}
                          placement="bottomRight"
                        >
                          <Button
                            type="text"
                            size="small"
                            icon={<MoreOutlined />}
                            onClick={(e) => e.stopPropagation()}
                            style={{ padding: '0 4px' }}
                          />
                        </Dropdown>
                      </Space>
                    }
                    description={
                      <div>
                        <Space size={8} style={{ marginBottom: 2 }}>
                          <Tag
                            color={statusColors[status]}
                            style={{ fontSize: 10, margin: 0, padding: '0 6px' }}
                          >
                            {statusText[status]}
                          </Tag>
                          <Tag
                            color={isLocal ? 'cyan' : 'gold'}
                            style={{ fontSize: 10, margin: 0, padding: '0 6px' }}
                          >
                            {isLocal ? 'Local' : 'Shared'}
                          </Tag>
                          {distance && (
                            <span
                              style={{
                                fontSize: 10,
                                color: '#8ba3c0',
                                fontFamily: "'JetBrains Mono', monospace",
                              }}
                            >
                              {distance}
                            </span>
                          )}
                        </Space>
                        <div
                          style={{
                            fontSize: 10,
                            color: '#5a7a9a',
                            fontFamily: "'JetBrains Mono', monospace",
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ID: {anchorId}
                        </div>
                        {anchor.creator && (
                          <div style={{ fontSize: 10, color: '#5a7a9a', marginTop: 2 }}>
                            <UserOutlined style={{ marginRight: 4 }} />
                            {anchor.creator}
                          </div>
                        )}
                      </div>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Card>

      <AnchorShareModal
        open={shareModalOpen}
        anchor={selectedAnchor}
        onClose={() => {
          setShareModalOpen(false);
          setSelectedAnchor(null);
        }}
        onShare={onShareAnchor}
        onImport={onImportAnchor}
        isLoading={isLoading}
      />

      <Modal
        title={
          <Space>
            <EnvironmentOutlined style={{ color: '#36cfc9' }} />
            <span>Anchor Details</span>
          </Space>
        }
        open={detailModalOpen}
        onCancel={() => {
          setDetailModalOpen(false);
          setSelectedAnchor(null);
        }}
        footer={[
          <Button
            key="locate"
            icon={<EnvironmentOutlined />}
            onClick={() => {
              onLocateAnchor?.(selectedAnchor?.id || selectedAnchor?.anchor_id);
            }}
            disabled={!selectedAnchor}
          >
            Re-locate
          </Button>,
          <Button
            key="share"
            icon={<ShareAltOutlined />}
            onClick={() => {
              setDetailModalOpen(false);
              handleShareClick(selectedAnchor);
            }}
            disabled={!selectedAnchor}
          >
            Share
          </Button>,
          <Button
            key="close"
            onClick={() => {
              setDetailModalOpen(false);
              setSelectedAnchor(null);
            }}
          >
            Close
          </Button>,
        ]}
        width={560}
      >
        {selectedAnchor && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Anchor ID">
              <code style={{ color: '#36cfc9' }}>
                {selectedAnchor.id || selectedAnchor.anchor_id}
              </code>
            </Descriptions.Item>
            {selectedAnchor.name && (
              <Descriptions.Item label="Name">{selectedAnchor.name}</Descriptions.Item>
            )}
            <Descriptions.Item label="Status">
              <Tag color={statusColors[selectedAnchor.status || 'located']}>
                {statusText[selectedAnchor.status || 'located']}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Type">
              <Tag color={(selectedAnchor.isLocal || selectedAnchor.shared === false) ? 'cyan' : 'gold'}>
                {(selectedAnchor.isLocal || selectedAnchor.shared === false) ? 'Local' : 'Shared'}
              </Tag>
            </Descriptions.Item>
            {selectedAnchor.creator && (
              <Descriptions.Item label="Creator">{selectedAnchor.creator}</Descriptions.Item>
            )}
            {selectedAnchor.position && (
              <Descriptions.Item label="Position">
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                    color: '#8ba3c0',
                  }}
                >
                  X: {selectedAnchor.position.x?.toFixed(4)}
                  <br />
                  Y: {selectedAnchor.position.y?.toFixed(4)}
                  <br />
                  Z: {selectedAnchor.position.z?.toFixed(4)}
                </div>
              </Descriptions.Item>
            )}
            {selectedAnchor.distance != null && (
              <Descriptions.Item label="Distance">
                <span style={{ color: '#36cfc9', fontFamily: "'JetBrains Mono', monospace" }}>
                  {selectedAnchor.distance.toFixed(2)} m
                </span>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Created">
              <Space>
                <ClockCircleOutlined style={{ color: '#8ba3c0' }} />
                {dayjs(selectedAnchor.created_at).format('YYYY-MM-DD HH:mm:ss')}
              </Space>
            </Descriptions.Item>
            {selectedAnchor.expires_at && (
              <Descriptions.Item label="Expires">
                <Space>
                  <WarningOutlined style={{ color: '#faad14' }} />
                  {dayjs(selectedAnchor.expires_at).format('YYYY-MM-DD HH:mm:ss')}
                </Space>
              </Descriptions.Item>
            )}
            {selectedAnchor.isDemo && (
              <Descriptions.Item label="Demo Mode">
                <Tag color="warning">
                  This anchor was created in demo mode
                </Tag>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>

      <Modal
        title="Delete Anchor"
        open={!!deleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
        onOk={() => deleteConfirm && handleDeleteAnchor(deleteConfirm)}
        okText="Delete"
        okButtonProps={{ danger: true }}
        confirmLoading={isLoading}
      >
        <p>
          Are you sure you want to delete anchor{' '}
          <code style={{ color: '#ff4d4f' }}>
            {deleteConfirm?.id?.substr(-8) || deleteConfirm?.anchor_id?.substr(-8)}
          </code>
          ?
        </p>
        <p style={{ color: '#8ba3c0', fontSize: 12 }}>
          This action cannot be undone. The anchor will be removed from all devices.
        </p>
      </Modal>
    </>
  );
}
