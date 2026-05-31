import React, { useState } from 'react';
import { Timeline, Tag, Card, Badge, Space, Button, Empty, Descriptions } from 'antd';
import { ClockCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined, FileTextOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const statusConfig = {
  completed: { color: 'success', icon: <CheckCircleOutlined />, text: '已完成' },
  in_progress: { color: 'processing', icon: <ClockCircleOutlined />, text: '进行中' },
  pending: { color: 'default', icon: <ClockCircleOutlined />, text: '待处理' },
  failed: { color: 'error', icon: <ExclamationCircleOutlined />, text: '异常' },
};

const severityConfig = {
  low: { color: '#52c41a', text: '低' },
  medium: { color: '#faad14', text: '中' },
  high: { color: '#fa8c16', text: '高' },
  critical: { color: '#ff4d4f', text: '严重' },
};

function DefectDetail({ defect }) {
  return (
    <div
      className={`defect-item defect-severity-${defect.severity || 'medium'}`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>
          {defect.description || '未描述'}
        </span>
        <Tag
          color={severityConfig[defect.severity]?.color || '#8ba3c0'}
          style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}
        >
          {severityConfig[defect.severity]?.text || defect.severity}
        </Tag>
      </div>
      {defect.photo_url && (
        <img
          src={defect.photo_url}
          alt="defect"
          style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 4, marginTop: 6 }}
        />
      )}
    </div>
  );
}

function ComparisonView({ inspectionA, inspectionB }) {
  const defectsA = inspectionA.defects || [];
  const defectsB = inspectionB.defects || [];

  const allDescriptions = new Set([
    ...defectsA.map((d) => d.description),
    ...defectsB.map((d) => d.description),
  ]);

  return (
    <Card
      size="small"
      className="glass-card"
      title={
        <Space>
          <SwapOutlined style={{ color: '#36cfc9' }} />
          <span>缺陷对比</span>
        </Space>
      }
      style={{ marginTop: 16 }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: '#8ba3c0', marginBottom: 8 }}>
            {dayjs(inspectionA.created_at).format('YYYY-MM-DD HH:mm')}
          </div>
          {defectsA.length === 0 ? (
            <div style={{ color: '#5a7a9a', fontSize: 12 }}>无缺陷</div>
          ) : (
            defectsA.map((d, i) => <DefectDetail key={i} defect={d} />)
          )}
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#8ba3c0', marginBottom: 8 }}>
            {dayjs(inspectionB.created_at).format('YYYY-MM-DD HH:mm')}
          </div>
          {defectsB.length === 0 ? (
            <div style={{ color: '#5a7a9a', fontSize: 12 }}>无缺陷</div>
          ) : (
            defectsB.map((d, i) => <DefectDetail key={i} defect={d} />)
          )}
        </div>
      </div>
      <div style={{ marginTop: 12, padding: '8px 12px', background: '#0f1d32', borderRadius: 4, fontSize: 12 }}>
        <div style={{ color: '#8ba3c0', marginBottom: 4 }}>变化摘要</div>
        <div style={{ color: '#e0e8f0' }}>
          缺陷数量: {defectsA.length} → {defectsB.length}
          {defectsB.length > defectsA.length && (
            <Tag color="error" style={{ marginLeft: 8, fontSize: 10 }}>增加 {defectsB.length - defectsA.length}</Tag>
          )}
          {defectsB.length < defectsA.length && (
            <Tag color="success" style={{ marginLeft: 8, fontSize: 10 }}>减少 {defectsA.length - defectsB.length}</Tag>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function InspectionTimeline({ inspections, defectsMap, onDownloadReport }) {
  const [expandedId, setExpandedId] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState([]);

  if (!inspections || inspections.length === 0) {
    return (
      <Card className="glass-card" style={{ height: '100%' }}>
        <Empty description="暂无巡检记录" />
      </Card>
    );
  }

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const toggleCompare = (id) => {
    if (compareSelection.includes(id)) {
      setCompareSelection(compareSelection.filter((x) => x !== id));
    } else if (compareSelection.length < 2) {
      setCompareSelection([...compareSelection, id]);
    }
  };

  const selectedInspections = compareSelection.map((id) =>
    inspections.find((insp) => insp.id === id)
  ).filter(Boolean);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>巡检时间线</span>
        <Space>
          <Button
            size="small"
            type={compareMode ? 'primary' : 'default'}
            icon={<SwapOutlined />}
            onClick={() => {
              setCompareMode(!compareMode);
              setCompareSelection([]);
            }}
          >
            {compareMode ? '退出对比' : '对比模式'}
          </Button>
        </Space>
      </div>

      {compareMode && compareSelection.length === 2 && (
        <ComparisonView
          inspectionA={{
            ...selectedInspections[0],
            defects: defectsMap?.[selectedInspections[0]?.id] || [],
          }}
          inspectionB={{
            ...selectedInspections[1],
            defects: defectsMap?.[selectedInspections[1]?.id] || [],
          }}
        />
      )}

      <Timeline
        items={inspections.map((insp) => {
          const st = statusConfig[insp.status] || statusConfig.pending;
          const defects = defectsMap?.[insp.id] || [];
          const isExpanded = expandedId === insp.id;
          const isSelected = compareSelection.includes(insp.id);

          return {
            color: st.color === 'success' ? 'green' : st.color === 'processing' ? 'blue' : st.color === 'error' ? 'red' : 'gray',
            children: (
              <div
                style={{
                  background: isSelected ? 'rgba(24,144,255,0.1)' : 'transparent',
                  border: isSelected ? '1px solid #1890ff' : '1px solid transparent',
                  borderRadius: 6,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => compareMode ? toggleCompare(insp.id) : toggleExpand(insp.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <Badge status={st.color} text={st.text} />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {dayjs(insp.created_at).format('YYYY-MM-DD HH:mm')}
                    </span>
                  </Space>
                  <Space size={4}>
                    {defects.length > 0 && (
                      <Tag color="error" style={{ fontSize: 10, lineHeight: '16px' }}>
                        {defects.length} 缺陷
                      </Tag>
                    )}
                    <span style={{ fontSize: 11, color: '#5a7a9a' }}>
                      {insp.inspector || '未知'}
                    </span>
                  </Space>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 8 }} className="fade-in">
                    {defects.length > 0 ? (
                      defects.map((d, i) => <DefectDetail key={i} defect={d} />)
                    ) : (
                      <div style={{ color: '#5a7a9a', fontSize: 12, padding: '8px 0' }}>本次巡检无缺陷</div>
                    )}
                    {insp.notes && (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: '#0f1d32', borderRadius: 4, fontSize: 12, color: '#8ba3c0' }}>
                        {insp.notes}
                      </div>
                    )}
                    {onDownloadReport && (
                      <Button
                        size="small"
                        icon={<FileTextOutlined />}
                        style={{ marginTop: 8 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDownloadReport(insp.id);
                        }}
                      >
                        下载报告
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ),
          };
        })}
      />
    </div>
  );
}
