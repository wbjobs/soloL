import React, { useState, useEffect, useCallback } from 'react';
import { Badge, Progress, Tooltip, Button, Space, Popover, List, Tag, message } from 'antd';
import { CloudOutlined, CloudServerOutlined, SyncOutlined, WarningOutlined, CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { offlineCache } from '../services/offlineCache';

export default function SyncStatus() {
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [queueItems, setQueueItems] = useState([]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubscribe = offlineCache.onQueueChange(async ({ count, items }) => {
      setPendingCount(count);
      const status = await offlineCache.getQueueStatus();
      setFailedCount(status.failed);
      setQueueItems(status.items);
      setIsSyncing(status.isProcessing);
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, []);

  const handleSyncNow = useCallback(async () => {
    if (!isOnline) {
      message.error('Cannot sync while offline');
      return;
    }
    setIsSyncing(true);
    message.info('Starting sync...');
    try {
      await offlineCache.flushQueue();
      message.success('Sync complete');
    } catch (err) {
      message.error('Sync failed');
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline]);

  const handleRetryFailed = useCallback(async () => {
    if (!isOnline) {
      message.error('Cannot retry while offline');
      return;
    }
    setIsSyncing(true);
    message.info('Retrying failed items...');
    try {
      await offlineCache.retryFailedItems();
      message.success('Retry initiated');
    } catch (err) {
      message.error('Retry failed');
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline]);

  const getStatusIcon = () => {
    if (!isOnline) {
      return <CloudOutlined style={{ color: '#8ba3c0' }} />;
    }
    if (isSyncing) {
      return <SyncOutlined spin style={{ color: '#36cfc9' }} />;
    }
    if (failedCount > 0) {
      return <WarningOutlined style={{ color: '#faad14' }} />;
    }
    if (pendingCount > 0) {
      return <CloudOutlined style={{ color: '#faad14' }} />;
    }
    return <CloudServerOutlined style={{ color: '#52c41a' }} />;
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isSyncing) return 'Syncing...';
    if (failedCount > 0) return `${failedCount} failed`;
    if (pendingCount > 0) return `${pendingCount} pending`;
    return 'All synced';
  };

  const getStatusColor = () => {
    if (!isOnline) return 'default';
    if (failedCount > 0) return 'warning';
    if (pendingCount > 0) return 'processing';
    return 'success';
  };

  const totalCount = pendingCount + failedCount;

  const popoverContent = (
    <div style={{ width: 320 }}>
      <div style={{ marginBottom: 12 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, color: '#e0e8f0' }}>Sync Status</span>
          <Tag color={getStatusColor()} icon={getStatusIcon()}>
            {getStatusText()}
          </Tag>
        </Space>
      </div>

      {totalCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Progress
            percent={totalCount > 0 ? Math.round(((totalCount - pendingCount) / totalCount) * 100) : 100}
            size="small"
            strokeColor="#36cfc9"
            showInfo={false}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8ba3c0', marginTop: 4 }}>
            <span>{pendingCount} pending</span>
            <span>{failedCount} failed</span>
          </div>
        </div>
      )}

      {queueItems.length > 0 && (
        <List
          size="small"
          dataSource={queueItems.slice(0, 5)}
          style={{ maxHeight: 200, overflow: 'auto', marginBottom: 12 }}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: '8px 0',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: '#e0e8f0', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.data.type === 'defect' ? 'Defect report' :
                   item.data.audioBlob ? 'Voice recording' : 'Transcript'}
                </span>
                <Tag
                  size="small"
                  color={item.status === 'failed' ? 'error' : item.status === 'retrying' ? 'processing' : 'warning'}
                >
                  {item.status}
                </Tag>
              </Space>
              {item.lastError && (
                <div style={{ fontSize: 10, color: '#ff7875', marginTop: 2 }}>
                  {item.lastError}
                </div>
              )}
            </List.Item>
          )}
        />
      )}

      <Space style={{ width: '100%' }}>
        <Button
          type="primary"
          size="small"
          icon={<SyncOutlined />}
          onClick={handleSyncNow}
          disabled={!isOnline || isSyncing}
          style={{ flex: 1 }}
        >
          Sync Now
        </Button>
        {failedCount > 0 && (
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleRetryFailed}
            disabled={!isOnline || isSyncing}
            style={{ flex: 1 }}
          >
            Retry Failed
          </Button>
        )}
      </Space>
    </div>
  );

  return (
    <Popover
      content={popoverContent}
      title={null}
      trigger="click"
      open={popoverOpen}
      onOpenChange={setPopoverOpen}
      placement="bottomRight"
      overlayStyle={{
        background: '#0f1d32',
        border: '1px solid rgba(54, 207, 201, 0.2)',
        borderRadius: 8,
      }}
    >
      <Tooltip title={getStatusText()}>
        <Badge
          count={totalCount}
          size="small"
          offset={[4, -4]}
          color={failedCount > 0 ? '#faad14' : pendingCount > 0 ? '#36cfc9' : '#52c41a'}
        >
          <Button
            type="text"
            icon={getStatusIcon()}
            style={{
              color: isOnline ? '#36cfc9' : '#8ba3c0',
              padding: '4px 8px',
              height: 'auto',
            }}
          />
        </Badge>
      </Tooltip>
    </Popover>
  );
}
