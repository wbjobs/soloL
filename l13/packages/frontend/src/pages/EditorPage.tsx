import React, { useEffect, useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Space, Modal, message, Typography, Badge } from 'antd';
import {
  ExportOutlined,
  HistoryOutlined,
  TeamOutlined,
  ArrowLeftOutlined,
  RobotOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../stores/project-store';
import { useProofreadStore } from '../stores/proofread-store';
import { usePlayerStore } from '../stores/player-store';
import { useAISuggestionStore } from '../stores/ai-store';
import { getProject } from '../api/project';
import { getBlocks, updateBlock } from '../api/proofread';
import { exportSrt } from '../api/export';
import { listVersions, createVersion } from '../api/version';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { WaveformDisplay } from '../components/waveform/WaveformDisplay';
import { BlockEditor } from '../components/editor/BlockEditor';
import { TimelineAdjuster } from '../components/editor/TimelineAdjuster';
import { downloadBlob, generateUserId } from '../utils';

const { Title } = Typography;

const USER_ID = generateUserId();

export const EditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentProject, setCurrentProject, setLoading } = useProjectStore();
  const { blocks, setBlocks, activeBlockIndex, updateBlock: updateBlockInStore } = useProofreadStore();
  const { suggestions, fetchSuggestions, generateSuggestions, generating } = useAISuggestionStore();
  const seekTo = usePlayerStore((s) => s.seekTo);
  const [versionsVisible, setVersionsVisible] = useState(false);
  const [versions, setVersions] = useState<any[]>([]);

  const activeBlock = activeBlockIndex >= 0 && activeBlockIndex < blocks.length
    ? blocks[activeBlockIndex]
    : null;

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const project = await getProject(id);
        setCurrentProject(project);

        const projectBlocks = await getBlocks(id);
        setBlocks(projectBlocks);

        await fetchSuggestions(id);
      } catch (err) {
        message.error('Failed to load project');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id, setCurrentProject, setBlocks, setLoading, fetchSuggestions]);

  const handleGenerateAISuggestions = useCallback(async () => {
    if (!id) return;
    try {
      await generateSuggestions(id, { userId: USER_ID });
      message.success('AI 建议生成完成');
    } catch (err) {
      message.error('AI 建议生成失败');
      console.error(err);
    }
  }, [id, generateSuggestions]);

  const handleSeek = useCallback(
    (time: number) => {
      seekTo(time);
    },
    [seekTo],
  );

  const handleBlockClick = useCallback(
    (block: any) => {
      seekTo(block.startTime);
    },
    [seekTo],
  );

  const handleBlockTimeUpdate = useCallback(
    async (blockId: string, startTime: number, endTime: number) => {
      updateBlockInStore(blockId, { startTime, endTime });
      try {
        await updateBlock({ blockId, startTime, endTime, userId: USER_ID });
      } catch (err) {
        console.error('Failed to update block time:', err);
      }
    },
    [updateBlockInStore],
  );

  const handleExport = useCallback(async () => {
    if (!id) return;
    try {
      const blob = await exportSrt({ projectId: id, format: 'srt' });
      const filename = `${currentProject?.name || 'subtitles'}.srt`;
      downloadBlob(blob, filename);
      message.success('SRT exported');
    } catch (err) {
      message.error('Export failed');
      console.error(err);
    }
  }, [id, currentProject]);

  const handleShowVersions = useCallback(async () => {
    if (!id) return;
    try {
      const v = await listVersions(id);
      setVersions(v);
      setVersionsVisible(true);
    } catch (err) {
      message.error('Failed to load versions');
      console.error(err);
    }
  }, [id]);

  const handleCreateVersion = useCallback(async () => {
    if (!id) return;
    try {
      await createVersion({ projectId: id, label: `v${versions.length + 1}` });
      message.success('Version created');
      const v = await listVersions(id);
      setVersions(v);
    } catch (err) {
      message.error('Failed to create version');
    }
  }, [id, versions]);

  const handleCreateRoom = useCallback(async () => {
    navigate(`/room/${id}`);
  }, [navigate, id]);

  const handleViewReport = useCallback(() => {
    navigate(`/project/${id}/report`);
  }, [navigate, id]);

  const pendingSuggestionsCount = suggestions.filter((s) => s.status === 'pending').length;

  return (
    <div className="editor-page">
      <div className="editor-page__topbar">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
          Back
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          {currentProject?.name || 'Loading...'}
        </Title>
        <Space>
          <Badge count={pendingSuggestionsCount > 0 ? pendingSuggestionsCount : undefined}>
            <Button
              icon={<RobotOutlined />}
              loading={generating}
              onClick={handleGenerateAISuggestions}
            >
              {suggestions.length > 0 ? '重新识别' : 'AI 识别'}
            </Button>
          </Badge>
          <Button icon={<BarChartOutlined />} onClick={handleViewReport}>
            报告
          </Button>
          <Button icon={<TeamOutlined />} onClick={handleCreateRoom}>
            Collab
          </Button>
          <Button icon={<HistoryOutlined />} onClick={handleShowVersions}>
            Versions
          </Button>
          <Button type="primary" icon={<ExportOutlined />} onClick={handleExport}>
            Export SRT
          </Button>
        </Space>
      </div>

      <div className="editor-page__content">
        <div className="editor-page__left">
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

        <div className="editor-page__right">
          <BlockEditor onBlockClick={handleBlockClick} userId={USER_ID} />
        </div>
      </div>

      <Modal
        title="Version History"
        open={versionsVisible}
        onCancel={() => setVersionsVisible(false)}
        footer={[
          <Button key="create" type="primary" onClick={handleCreateVersion}>
            Create Version
          </Button>,
          <Button key="close" onClick={() => setVersionsVisible(false)}>
            Close
          </Button>,
        ]}
      >
        <div>
          {versions.length === 0 && <p>No versions yet</p>}
          {versions.map((v) => (
            <div key={v.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <strong>{v.label}</strong>
              <span style={{ marginLeft: 8, color: '#999' }}>
                {new Date(v.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
};
