import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Statistic,
  Row,
  Col,
  Table,
  Button,
  Space,
  Typography,
  Progress,
  Tag,
  Spin,
  Alert,
} from 'antd';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  EditOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  AimOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { getReportStats, exportReportHtml } from '../api/ai';
import type { ReportStats, PerUserStats } from '../types';

const { Title, Text } = Typography;

const USER_COLORS = [
  '#165DFF', '#00B42A', '#FF7D00', '#F53F3F', '#722ED1',
  '#14C9C9', '#F7BA1E', '#FF57A5', '#4E5969', '#86909C',
];

function getColorForUser(index: number): string {
  return USER_COLORS[index % USER_COLORS.length];
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const ReportPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const loadStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getReportStats(id);
        setStats(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, [id]);

  const handleExportHtml = () => {
    if (id) {
      exportReportHtml(id);
    }
  };

  const userColumns = [
    {
      title: '用户',
      dataIndex: 'userId',
      key: 'userId',
      render: (userId: string, _: PerUserStats, index: number) => (
        <Space>
          <span
            style={{
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: getColorForUser(index),
            }}
          />
          <Text code>{userId.slice(0, 12)}...</Text>
        </Space>
      ),
    },
    {
      title: '编辑次数',
      dataIndex: 'editCount',
      key: 'editCount',
      render: (val: number) => (
        <Tag color="blue" icon={<EditOutlined />}>
          {val}
        </Tag>
      ),
    },
    {
      title: 'AI采纳',
      dataIndex: 'aiAdoptCount',
      key: 'aiAdoptCount',
      render: (val: number) => (
        <Tag color="green" icon={<CheckCircleOutlined />}>
          {val}
        </Tag>
      ),
    },
    {
      title: '冲突解决',
      dataIndex: 'conflictResolutions',
      key: 'conflictResolutions',
      render: (val: number) => (
        <Tag color="orange" icon={<ThunderboltOutlined />}>
          {val}
        </Tag>
      ),
    },
    {
      title: '时间轴调整',
      dataIndex: 'timelineAdjustments',
      key: 'timelineAdjustments',
      render: (val: number) => (
        <Tag color="purple" icon={<AimOutlined />}>
          {val}
        </Tag>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>正在加载报告...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px' }}>
        <Alert
          type="error"
          message="加载失败"
          description={error}
          showIcon
        />
        <Button
          style={{ marginTop: 16 }}
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/project/${id}`)}
        >
          返回编辑器
        </Button>
      </div>
    );
  }

  if (!stats) return null;

  const completionPercent = stats.totals.blocksTotal > 0
    ? Math.round((stats.totals.blocksCompleted / stats.totals.blocksTotal) * 100)
    : 0;

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(`/project/${id}`)}
          >
            返回编辑器
          </Button>
          <Title level={3} style={{ margin: 0 }}>
            校对报告 - {stats.projectInfo.name}
          </Title>
        </Space>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={handleExportHtml}
        >
          导出报告 (HTML)
        </Button>
      </div>

      <Alert
        message="项目概览"
        description={
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <div>创建时间: {new Date(stats.projectInfo.createdAt).toLocaleString()}</div>
            <div>字幕块数: {stats.projectInfo.blockCount} 块</div>
            <div>总时长: {formatDuration(stats.projectInfo.duration)}</div>
          </Space>
        }
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="总编辑次数"
              value={stats.totals.totalEdits}
              prefix={<EditOutlined style={{ color: '#165DFF' }} />}
              valueStyle={{ color: '#165DFF' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="AI采纳数"
              value={stats.totals.totalAiAdopts}
              prefix={<CheckCircleOutlined style={{ color: '#00B42A' }} />}
              valueStyle={{ color: '#00B42A' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="冲突解决"
              value={stats.totals.totalConflicts}
              prefix={<ThunderboltOutlined style={{ color: '#FF7D00' }} />}
              valueStyle={{ color: '#FF7D00' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="AI采纳率"
              value={stats.totals.aiAdoptionRate * 100}
              suffix="%"
              precision={1}
              prefix={<RobotOutlined style={{ color: '#722ED1' }} />}
              valueStyle={{ color: '#722ED1' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="完成进度" style={{ marginBottom: 24 }}>
        <Progress
          percent={completionPercent}
          status={completionPercent === 100 ? 'success' : 'active'}
          strokeColor={{
            '0%': '#108ee9',
            '100%': '#87d068',
          }}
        />
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <Text strong>{stats.totals.blocksCompleted}</Text>
          <Text type="secondary"> / {stats.totals.blocksTotal} 块已完成</Text>
        </div>
      </Card>

      <Card title="AI建议分析" style={{ marginBottom: 24 }}>
        <Row gutter={[16, 16]}>
          <Col span={6}>
            <Statistic
              title="总建议数"
              value={stats.aiSuggestionSummary.total}
              valueStyle={{ fontSize: 20 }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="已采纳"
              value={stats.aiSuggestionSummary.accepted}
              valueStyle={{ color: '#00B42A', fontSize: 20 }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="已拒绝"
              value={stats.aiSuggestionSummary.rejected}
              valueStyle={{ color: '#F53F3F', fontSize: 20 }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="待处理"
              value={stats.aiSuggestionSummary.pending}
              valueStyle={{ color: '#FF7D00', fontSize: 20 }}
            />
          </Col>
        </Row>
      </Card>

      <Card
        title="用户贡献统计"
        extra={<Text type="secondary">共 {stats.perUser.length} 位校对员</Text>}
      >
        <Table
          columns={userColumns}
          dataSource={stats.perUser}
          rowKey="userId"
          pagination={false}
        />
      </Card>
    </div>
  );
};
