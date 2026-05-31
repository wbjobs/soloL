import React, { useEffect, useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Space, Badge, Typography, message } from 'antd';
import {
  ExportOutlined,
  ArrowLeftOutlined,
  WifiOutlined,
  DisconnectOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../stores/project-store';
import { useProofreadStore } from '../stores/proofread-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';
import { getProject } from '../api/project';
import { getRoom } from '../api/room';
import { getBlocks, updateBlock } from '../api/proofread';
import { exportSrt } from '../api/export';
import { useSocket } from '../hooks/useSocket';
import { useWebRTC } from '../hooks/useWebRTC';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { WaveformDisplay } from '../components/waveform/WaveformDisplay';
import { BlockEditor } from '../components/editor/BlockEditor';
import { TimelineAdjuster } from '../components/editor/TimelineAdjuster';
import { CursorOverlay } from '../components/collab/CursorOverlay';
import { ParticipantList } from '../components/collab/ParticipantList';
import { downloadBlob, generateUserId } from '../utils';
import { otClient } from '../ot/ot-client';
import type { OTOperation } from '../types';

const { Title } = Typography;

const USER_ID = generateUserId();

export const RoomPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentProject, setCurrentProject, setLoading } = useProjectStore();
  const { blocks, setBlocks, activeBlockIndex, updateBlock: updateBlockInStore } = useProofreadStore();
  const seekTo = usePlayerStore((s) => s.seekTo);
  const connected = useRoomStore((s) => s.connected);
  const participants = useRoomStore((s) => s.participants);

  const { sendCursor, sendEdit, sendWebRTCSignal } = useSocket(
    id,
    USER_ID,
    `User-${USER_ID.slice(-4)}`,
  );

  const { createPeerConnection, broadcastMessage } = useWebRTC({
    userId: USER_ID,
    sendSignal: sendWebRTCSignal,
    onMessage: (fromUserId, data) => {
      if (data.type === 'cursor') {
        useRoomStore.getState().setCursor(fromUserId, data.cursor);
      } else if (data.type === 'edit' && data.op) {
        if (data.op.userId !== USER_ID) {
          otClient.receiveRemoteOp(data.op as OTOperation);
        }
      }
    },
  });

  useEffect(() => {
    if (!id) return;

    const loadRoomData = async () => {
      setLoading(true);
      try {
        const room = await getRoom(id);
        const project = await getProject(room.projectId);
        setCurrentProject(project);

        const projectBlocks = await getBlocks(room.projectId);
        setBlocks(projectBlocks);
      } catch (err) {
        message.error('Failed to load room');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadRoomData();
  }, [id, setCurrentProject, setBlocks, setLoading]);

  useEffect(() => {
    participants.forEach((p) => {
      if (p.id !== USER_ID && p.isOnline) {
        createPeerConnection(p.id, USER_ID < p.id);
      }
    });
  }, [participants, createPeerConnection]);

  const handleSeek = useCallback(
    (time: number) => {
      seekTo(time);
    },
    [seekTo],
  );

  const handleBlockClick = useCallback(
    (block: any) => {
      seekTo(block.startTime);
      sendCursor({
        blockIndex: block.index,
        field: 'correctedText',
        offset: 0,
      });
    },
    [seekTo, sendCursor],
  );

  const handleBlockTimeUpdate = useCallback(
    async (blockId: string, startTime: number, endTime: number) => {
      updateBlockInStore(blockId, { startTime, endTime });
      try {
        await updateBlock({ blockId, startTime, endTime });
      } catch (err) {
        console.error('Failed to update block time:', err);
      }
    },
    [updateBlockInStore],
  );

  const handleExport = useCallback(async () => {
    if (!currentProject) return;
    try {
      const blob = await exportSrt({ projectId: currentProject.id, format: 'srt' });
      downloadBlob(blob, `${currentProject.name}.srt`);
      message.success('SRT exported');
    } catch (err) {
      message.error('Export failed');
    }
  }, [currentProject]);

  const activeBlock = activeBlockIndex >= 0 && activeBlockIndex < blocks.length
    ? blocks[activeBlockIndex]
    : null;

  return (
    <div className="room-page">
      <div className="room-page__topbar">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
          Back
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          {currentProject?.name || 'Loading...'} — Room
        </Title>
        <Space>
          <Badge status={connected ? 'success' : 'error'} />
          <span style={{ color: connected ? '#52c41a' : '#ff4d4f', fontSize: 12 }}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <Button type="primary" icon={<ExportOutlined />} onClick={handleExport}>
            Export SRT
          </Button>
        </Space>
      </div>

      <div className="room-page__content">
        <div className="room-page__sidebar">
          <ParticipantList />
        </div>

        <div className="room-page__main">
          <div className="room-page__left">
            {currentProject?.videoUrl && (
              <VideoPlayer src={currentProject.videoUrl} />
            )}
            {currentProject?.videoUrl && (
              <WaveformDisplay
                src={currentProject.videoUrl}
                blocks={blocks}
                onSeek={handleSeek}
                onBlockTimeUpdate={handleBlockTimeUpdate}
              />
            )}
            {activeBlock && <TimelineAdjuster block={activeBlock} />}
          </div>

          <div className="room-page__right">
            <CursorOverlay />
            <BlockEditor
              onBlockClick={handleBlockClick}
              userId={USER_ID}
              broadcastMessage={broadcastMessage}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
