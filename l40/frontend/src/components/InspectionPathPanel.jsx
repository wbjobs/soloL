import React, { useState, useCallback, useMemo } from 'react';
import {
  Card,
  List,
  Button,
  Rate,
  Progress,
  Tag,
  Space,
  Empty,
  message,
  Tooltip,
} from 'antd';
import {
  SwapOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CheckCircleOutlined,
  FastForwardOutlined,
  ReloadOutlined,
  EnvironmentOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { buildGraph, planInspectionRoute, estimateTotalTime } from '../services/pathPlanner';

const priorityColorMap = {
  5: 'error',
  4: 'warning',
  3: 'processing',
  2: 'default',
  1: 'default',
};

export default function InspectionPathPanel({
  equipmentList = [],
  onRoutePlanned,
  onNavigationStart,
  onNavigationStop,
  navigationState,
  onSkipWaypoint,
  onCompleteWaypoint,
  onReplan,
}) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [priorities, setPriorities] = useState({});
  const [routeResult, setRouteResult] = useState(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [completedWaypoints, setCompletedWaypoints] = useState(new Set());
  const [skippedWaypoints, setSkippedWaypoints] = useState(new Set());

  const toggleEquipment = useCallback((eqId) => {
    setSelectedIds((prev) =>
      prev.includes(eqId) ? prev.filter((id) => id !== eqId) : [...prev, eqId]
    );
  }, []);

  const handlePriorityChange = useCallback((eqId, value) => {
    setPriorities((prev) => ({ ...prev, [eqId]: value }));
  }, []);

  const handlePlanRoute = useCallback(() => {
    if (selectedIds.length === 0) {
      message.warning('请至少选择一个设备');
      return;
    }

    setIsPlanning(true);
    try {
      const equipmentWithPriorities = equipmentList.map((eq) => ({
        ...eq,
        priority: priorities[eq.id] || 3,
      }));

      const graph = buildGraph(equipmentWithPriorities, []);

      if (graph.nodes.length === 0) {
        message.error('无法构建路径图');
        setIsPlanning(false);
        return;
      }

      const startNodeId = graph.nodes[0].id;
      const result = planInspectionRoute(graph, startNodeId, selectedIds);

      if (!result) {
        message.error('无法规划巡检路线，请检查设备位置');
        setIsPlanning(false);
        return;
      }

      setRouteResult(result);
      setCompletedWaypoints(new Set());
      setSkippedWaypoints(new Set());
      message.success(`路线已规划，总距离 ${result.totalDistance.toFixed(1)}m`);
      onRoutePlanned?.(result);
    } catch (err) {
      message.error('路线规划失败: ' + err.message);
    } finally {
      setIsPlanning(false);
    }
  }, [selectedIds, equipmentList, priorities, onRoutePlanned]);

  const completionPercent = useMemo(() => {
    if (!routeResult) return 0;
    const total = routeResult.path.length;
    if (total === 0) return 100;
    return Math.round((completedWaypoints.size / total) * 100);
  }, [routeResult, completedWaypoints]);

  const estimatedTime = useMemo(() => {
    if (!routeResult) return 0;
    return estimateTotalTime(routeResult.path);
  }, [routeResult]);

  const handleComplete = useCallback((nodeId) => {
    setCompletedWaypoints((prev) => new Set(prev).add(nodeId));
    onCompleteWaypoint?.(nodeId);
  }, [onCompleteWaypoint]);

  const handleSkip = useCallback((nodeId) => {
    setSkippedWaypoints((prev) => new Set(prev).add(nodeId));
    onSkipWaypoint?.(nodeId);
  }, [onSkipWaypoint]);

  const handleReplan = useCallback(() => {
    setRouteResult(null);
    setCompletedWaypoints(new Set());
    setSkippedWaypoints(new Set());
    onReplan?.();
  }, [onReplan]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '100%', overflow: 'auto' }}>
      <Card
        size="small"
        className="glass-card"
        title={
          <Space>
            <SwapOutlined style={{ color: '#36cfc9' }} />
            <span>巡检路径规划</span>
          </Space>
        }
      >
        <List
          size="small"
          dataSource={equipmentList}
          renderItem={(eq) => (
            <List.Item
              style={{
                padding: '4px 0',
                background: selectedIds.includes(eq.id) ? 'rgba(54,207,201,0.05)' : 'transparent',
              }}
              actions={[
                <Rate
                  key="rate"
                  count={5}
                  value={priorities[eq.id] || 3}
                  onChange={(val) => handlePriorityChange(eq.id, val)}
                  style={{ fontSize: 12 }}
                />,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(eq.id)}
                      onChange={() => toggleEquipment(eq.id)}
                      style={{ accentColor: '#36cfc9' }}
                    />
                    <span style={{ fontSize: 12 }}>{eq.name}</span>
                    <Tag
                      color={priorityColorMap[priorities[eq.id] || 3]}
                      style={{ fontSize: 9, lineHeight: '16px', margin: 0 }}
                    >
                      P{priorities[eq.id] || 3}
                    </Tag>
                  </Space>
                }
              />
            </List.Item>
          )}
        />

        <Button
          type="primary"
          block
          icon={<SwapOutlined />}
          onClick={handlePlanRoute}
          loading={isPlanning}
          disabled={selectedIds.length === 0}
          style={{ marginTop: 8 }}
        >
          规划路线 ({selectedIds.length} 个设备)
        </Button>
      </Card>

      {routeResult && (
        <Card
          size="small"
          className="glass-card"
          title={
            <Space>
              <EnvironmentOutlined style={{ color: '#36cfc9' }} />
              <span>规划路线</span>
            </Space>
          }
          extra={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={handleReplan}
              type="text"
            >
              重新规划
            </Button>
          }
        >
          <div style={{ marginBottom: 8 }}>
            <Space split="|" style={{ fontSize: 11, color: '#8ba3c0' }}>
              <span>
                <EnvironmentOutlined /> {routeResult.totalDistance.toFixed(1)}m
              </span>
              <span>
                <ClockCircleOutlined /> {estimatedTime.toFixed(1)} min
              </span>
              <span>{routeResult.path.length} 站</span>
            </Space>
          </div>

          <Progress
            percent={completionPercent}
            size="small"
            strokeColor="#36cfc9"
            format={(pct) => `${pct}%`}
            style={{ marginBottom: 8 }}
          />

          <List
            size="small"
            dataSource={routeResult.path}
            renderItem={(wp, idx) => {
              const isCompleted = completedWaypoints.has(wp.nodeId);
              const isSkipped = skippedWaypoints.has(wp.nodeId);
              const isCurrent = navigationState?.currentWaypointIndex === idx;

              return (
                <List.Item
                  style={{
                    padding: '4px 8px',
                    background: isCurrent ? 'rgba(54,207,201,0.1)' : 'transparent',
                    borderLeft: isCurrent ? '2px solid #36cfc9' : '2px solid transparent',
                    opacity: isCompleted ? 0.5 : isSkipped ? 0.4 : 1,
                  }}
                  actions={[
                    !isCompleted && !isSkipped && (
                      <Space key="actions" size={4}>
                        <Tooltip title="完成检查">
                          <Button
                            size="small"
                            type="text"
                            icon={<CheckCircleOutlined />}
                            style={{ color: '#52c41a' }}
                            onClick={() => handleComplete(wp.nodeId)}
                          />
                        </Tooltip>
                        <Tooltip title="跳过">
                          <Button
                            size="small"
                            type="text"
                            icon={<FastForwardOutlined />}
                            style={{ color: '#faad14' }}
                            onClick={() => handleSkip(wp.nodeId)}
                          />
                        </Tooltip>
                      </Space>
                    ),
                  ].filter(Boolean)}
                >
                  <Space size={4}>
                    <span style={{ color: '#5a7a9a', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                      {idx + 1}
                    </span>
                    <span style={{ fontSize: 12, color: isCompleted ? '#52c41a' : isSkipped ? '#faad14' : '#e0e8f0' }}>
                      {wp.name}
                    </span>
                    <Tag
                      color={priorityColorMap[wp.priority]}
                      style={{ fontSize: 9, lineHeight: '14px', margin: 0, padding: '0 4px' }}
                    >
                      P{wp.priority}
                    </Tag>
                    {wp.cumulativeDistance > 0 && (
                      <span style={{ fontSize: 10, color: '#5a7a9a', fontFamily: "'JetBrains Mono', monospace" }}>
                        {wp.cumulativeDistance.toFixed(1)}m
                      </span>
                    )}
                    {isCompleted && <Tag color="success" style={{ fontSize: 9, margin: 0, padding: '0 4px' }}>完成</Tag>}
                    {isSkipped && <Tag color="warning" style={{ fontSize: 9, margin: 0, padding: '0 4px' }}>跳过</Tag>}
                  </Space>
                </List.Item>
              );
            }}
          />
        </Card>
      )}

      {routeResult && (
        <Space style={{ width: '100%' }}>
          {!navigationState?.isNavigating ? (
            <Button
              type="primary"
              block
              icon={<PlayCircleOutlined />}
              onClick={onNavigationStart}
            >
              开始导航
            </Button>
          ) : (
            <>
              <Button
                danger
                block
                icon={<PauseCircleOutlined />}
                onClick={onNavigationStop}
              >
                停止导航
              </Button>
            </>
          )}
        </Space>
      )}

      {!routeResult && equipmentList.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无设备数据"
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
}
