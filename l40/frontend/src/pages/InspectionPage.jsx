import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Steps, Button, Card, Descriptions, Tag, Space, Empty, Spin, Input, message, Modal, Result, Switch, Select, Badge, Tooltip, Popover, List, Collapse } from 'antd';
import {
  QrcodeOutlined,
  EyeOutlined,
  ToolOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  PlusCircleOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  SettingOutlined,
  BulbOutlined,
  ExperimentOutlined,
  RadarChartOutlined,
  ClusterOutlined,
  ShareAltOutlined,
  PushpinOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  AlertOutlined,
  TeamOutlined,
  AudioOutlined,
  EditOutlined,
  CompassOutlined,
  EnvironmentOutlined,
  AimOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import QRScanner from '../components/QRScanner';
import ModelViewer from '../components/ModelViewer';
import SensorOverlay from '../components/SensorOverlay';
import DefectMarker from '../components/DefectMarker';
import AnchorManager from '../components/AnchorManager';
import AnchorShareModal from '../components/AnchorShareModal';
import VibrationSpectrum from '../components/VibrationSpectrum';
import RemoteExpertPanel from '../components/RemoteExpertPanel';
import InspectionPathPanel from '../components/InspectionPathPanel';
import {
  getEquipmentByQr,
  getEquipmentList,
  createInspection,
  updateInspection,
  createDefect,
  getReportUrl,
} from '../services/api';
import usePerformanceMonitor from '../hooks/usePerformanceMonitor';
import useAnomalyDetection from '../hooks/useAnomalyDetection';
import { useSpatialAnchors } from '../hooks/useSpatialAnchors';
import { offlineCache } from '../services/offlineCache';
import { onAnomaly, destroyDetector, getAnomalyState } from '../services/anomalyDetector';

const { TextArea } = Input;
const { Option } = Select;

const stepItems = [
  { title: '扫描识别', icon: <QrcodeOutlined /> },
  { title: '设备检查', icon: <EyeOutlined /> },
  { title: '缺陷记录', icon: <ToolOutlined /> },
  { title: '完成巡检', icon: <FileTextOutlined /> },
  { title: '生成报告', icon: <CheckCircleOutlined /> },
];

const FACTORY_MODE = 'factory';
const SINGLE_MODE = 'single';

export default function InspectionPage() {
  const [current, setCurrent] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [equipment, setEquipment] = useState(null);
  const [allEquipment, setAllEquipment] = useState([]);
  const [mode, setMode] = useState(SINGLE_MODE);
  const [inspection, setInspection] = useState(null);
  const [defects, setDefects] = useState([]);
  const [defectModalOpen, setDefectModalOpen] = useState(false);
  const [defectPosition, setDefectPosition] = useState(null);
  const [notes, setNotes] = useState('');
  const [reportReady, setReportReady] = useState(false);

  const [arMode, setArMode] = useState(false);
  const [showPerformance, setShowPerformance] = useState(false);
  const [anchorShareOpen, setAnchorShareOpen] = useState(false);
  const [anchorManagerOpen, setAnchorManagerOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [remoteExpertOpen, setRemoteExpertOpen] = useState(false);
  const [pathPlannerOpen, setPathPlannerOpen] = useState(false);
  const [anomalyAlerts, setAnomalyAlerts] = useState({});
  const [showSpectrum, setShowSpectrum] = useState(false);
  const [navigationPath, setNavigationPath] = useState(null);

  const performance = usePerformanceMonitor({
    fpsThreshold: 30,
    memoryThreshold: 0.85,
  });

  const anomalyDetection = useAnomalyDetection({
    equipmentId: equipment?.id,
    autoStart: true,
  });

  const spatialAnchors = useSpatialAnchors({
    equipmentId: equipment?.id,
    radius: 50,
    autoInitialize: true,
  });

  const cameraPositionRef = useRef({ x: 0, y: 1.6, z: 3 });

  useEffect(() => {
    onAnomaly((alert) => {
      setAnomalyAlerts((prev) => ({
        ...prev,
        [alert.equipmentId]: alert,
      }));
      if (alert.level === 'critical') {
        message.error(`⚠ 设备 ${alert.equipmentId} 检测到严重异常! 异常分数: ${(alert.score * 100).toFixed(0)}%`);
      } else if (alert.level === 'warning') {
        message.warning(`设备 ${alert.equipmentId} 检测到异常预警，分数: ${(alert.score * 100).toFixed(0)}%`);
      }
    });
    return () => destroyDetector();
  }, []);

  useEffect(() => {
    if (mode === FACTORY_MODE) {
      loadAllEquipment();
    }
  }, [mode]);

  useEffect(() => {
    const handleOnline = () => {
      message.success('网络已恢复，正在同步待上传数据...');
      offlineCache.flushQueue();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  const loadAllEquipment = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getEquipmentList();
      const list = res.data || [];
      const equipmentWithPositions = list.map((eq, index) => ({
        ...eq,
        position: [
          (index % 8 - 4) * 5,
          0,
          Math.floor(index / 8) * 5 - 10,
        ],
        rotation: [0, 0, 0],
        scale: 1,
      }));
      setAllEquipment(equipmentWithPositions);
    } catch (err) {
      message.error('加载设备列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQRDetected = useCallback(async (code) => {
    setScannerOpen(false);
    setLoading(true);
    try {
      const res = await getEquipmentByQr(code);
      const eq = res.data;
      setEquipment(eq);
      setCurrent(1);
      message.success(`设备已加载: ${eq.name}`);
    } catch (err) {
      message.error('未找到该设备，请检查编码');
    } finally {
      setLoading(false);
    }
  }, []);

  const startInspection = useCallback(async () => {
    if (!equipment) return;
    setLoading(true);
    try {
      const res = await createInspection({
        equipment_id: equipment.id,
        inspector: '当前巡检员',
      });
      const insp = res.data;
      setInspection(insp);
      setCurrent(2);
      message.success('巡检已开始');
    } catch (err) {
      if (!navigator.onLine) {
        message.info('网络离线，巡检数据将本地缓存');
        const pendingInsp = {
          equipment_id: equipment.id,
          inspector: '当前巡检员',
          status: 'in_progress',
          _localId: Date.now(),
        };
        await offlineCache.add('pending_defects', {
          type: 'inspection',
          data: pendingInsp,
        });
        setInspection({ ...pendingInsp, id: Date.now(), _local: true });
        setCurrent(2);
      } else {
        message.error('创建巡检失败');
      }
    } finally {
      setLoading(false);
    }
  }, [equipment]);

  const handleModelClick = useCallback((equipmentOrPoint, point) => {
    if (current < 2) return;

    if (mode === FACTORY_MODE && equipmentOrPoint && equipmentOrPoint.id) {
      setEquipment(equipmentOrPoint);
      message.info(`已选择: ${equipmentOrPoint.name}`);
      return;
    }

    const clickPoint = point || equipmentOrPoint;
    setDefectPosition(clickPoint);
    setDefectModalOpen(true);
  }, [current, mode]);

  const handleDefectSubmit = useCallback(async (formData) => {
    if (!inspection) return;
    formData.append('inspection_id', inspection.id);

    try {
      const res = await createDefect(formData);
      const newDefect = res.data;
      if (newDefect.position && typeof newDefect.position === 'object') {
        // position already parsed from backend JSON
      } else {
        newDefect.position = defectPosition;
      }
      setDefects((prev) => [...prev, newDefect]);
      setDefectModalOpen(false);
      setDefectPosition(null);
      message.success('缺陷已记录');
    } catch (err) {
      if (!navigator.onLine) {
        const pendingDefect = {
          inspection_id: inspection.id,
          position: defectPosition,
          severity: formData.get('severity'),
          description: formData.get('description'),
          _localId: Date.now(),
        };
        await offlineCache.add('pending_defects', {
          type: 'defect',
          data: pendingDefect,
          formData: Array.from(formData.entries()),
        });
        const localDefect = {
          ...pendingDefect,
          id: Date.now(),
          _local: true,
          _offline: true,
          position: defectPosition,
        };
        setDefects((prev) => [...prev, localDefect]);
        setDefectModalOpen(false);
        setDefectPosition(null);
        message.info('网络离线，缺陷已本地缓存，将在恢复网络后上传');
      } else {
        message.error('提交失败: ' + (err.message || '未知错误'));
      }
    }
  }, [inspection, defectPosition]);

  const completeInspection = useCallback(async () => {
    if (!inspection) return;
    setLoading(true);
    try {
      if (inspection._local) {
        await offlineCache.add('pending_defects', {
          type: 'complete_inspection',
          data: { ...inspection, status: 'completed', notes },
        });
        message.info('网络离线，完成状态已本地缓存');
      } else {
        await updateInspection(inspection.id, {
          status: 'completed',
          notes,
        });
      }
      setCurrent(3);
      message.success('巡检已完成');
    } catch (err) {
      if (!navigator.onLine) {
        message.info('网络离线，完成状态已本地缓存');
        setCurrent(3);
      } else {
        message.error('完成巡检失败');
      }
    } finally {
      setLoading(false);
    }
  }, [inspection, notes]);

  const generateReport = useCallback(() => {
    setCurrent(4);
    setReportReady(true);
  }, []);

  const downloadReport = useCallback(() => {
    if (!inspection) return;
    const url = getReportUrl(inspection.id);
    window.open(url, '_blank');
  }, [inspection]);

  const resetInspection = useCallback(() => {
    setCurrent(0);
    setEquipment(null);
    setInspection(null);
    setDefects([]);
    setDefectModalOpen(false);
    setDefectPosition(null);
    setNotes('');
    setReportReady(false);
  }, []);

  const severityConfig = {
    low: { color: 'success', text: '低' },
    medium: { color: 'warning', text: '中' },
    high: { color: 'warning', text: '高' },
    critical: { color: 'error', text: '严重' },
  };

  const fpsColor = performance.fps >= 50 ? '#52c41a' : performance.fps >= 30 ? '#faad14' : '#ff4d4f';

  const performancePopover = (
    <div className="ar-performance-panel" style={{ width: 260, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#36cfc9' }}>
        <RadarChartOutlined style={{ marginRight: 6 }} />
        性能监控
      </div>
      <List size="small">
        <List.Item>
          <span style={{ color: '#8ba3c0' }}>帧率</span>
          <span style={{ color: fpsColor, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
            {performance.fps} FPS
          </span>
        </List.Item>
        <List.Item>
          <span style={{ color: '#8ba3c0' }}>内存使用</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            {performance.memory ? `${performance.memory.percentage.toFixed(1)}%` : '--'}
          </span>
        </List.Item>
        <List.Item>
          <span style={{ color: '#8ba3c0' }}>LOD 偏差</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            {performance.lodBias.toFixed(1)}x
          </span>
        </List.Item>
        <List.Item>
          <span style={{ color: '#8ba3c0' }}>性能状态</span>
          <Badge
            status={performance.isLowPerformance ? 'warning' : 'success'}
            text={performance.isLowPerformance ? '低性能' : '正常'}
          />
        </List.Item>
      </List>
      {performance.isLowPerformance && (
        <div style={{ marginTop: 8, padding: 8, background: 'rgba(250, 173, 20, 0.1)', borderRadius: 4, fontSize: 11, color: '#faad14' }}>
          <WarningOutlined style={{ marginRight: 4 }} />
          性能受限，已自动降低模型精度
        </div>
      )}
    </div>
  );

  const settingsPopover = (
    <div style={{ width: 240, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#36cfc9' }}>
        <SettingOutlined style={{ marginRight: 6 }} />
        显示设置
      </div>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <BulbOutlined />
            <span>AR 模式 (HoloLens)</span>
          </Space>
          <Switch checked={arMode} onChange={setArMode} size="small" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <RadarChartOutlined />
            <span>显示性能</span>
          </Space>
          <Switch checked={showPerformance} onChange={setShowPerformance} size="small" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <ClusterOutlined />
            <span>场景模式</span>
          </Space>
          <Select
            value={mode}
            onChange={setMode}
            size="small"
            style={{ width: 100 }}
          >
            <Option value={SINGLE_MODE}>单设备</Option>
            <Option value={FACTORY_MODE}>车间模式</Option>
          </Select>
        </div>
      </Space>
      {arMode && (
        <div style={{ marginTop: 10, padding: 8, background: 'rgba(54, 207, 201, 0.1)', borderRadius: 4, fontSize: 11, color: '#36cfc9' }}>
          <ExperimentOutlined style={{ marginRight: 4 }} />
          HoloLens 优化已启用：阴影质量降低，LOD 切换更积极
        </div>
      )}
    </div>
  );

  const viewerEquipmentList = mode === FACTORY_MODE ? allEquipment : equipment ? [{
    ...equipment,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  }] : [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 16px' }}>
        <Steps
          current={current}
          items={stepItems}
          size="small"
          style={{ flex: 1, marginRight: 16 }}
        />
        <Space size={8}>
          {mode === FACTORY_MODE && (
            <Badge count={allEquipment.length} size="small">
              <Tag color="blue" icon={<ClusterOutlined />}>
                车间模式
              </Tag>
            </Badge>
          )}
          {arMode && (
            <Tag color="cyan" icon={<ThunderboltOutlined />}>
              HoloLens 优化
            </Tag>
          )}
          {Object.keys(anomalyAlerts).length > 0 && (
            <Tag color="error" icon={<AlertOutlined />}>
              {Object.keys(anomalyAlerts).length} 异常
            </Tag>
          )}
          {anomalyDetection.anomalyState?.level === 'warning' && (
            <Tag color="warning" icon={<SafetyCertificateOutlined />}>
              AI 预警 {(anomalyDetection.anomalyState.score * 100).toFixed(0)}%
            </Tag>
          )}
          {anomalyDetection.anomalyState?.level === 'critical' && (
            <Tag color="error" icon={<AlertOutlined />} style={{ animation: 'pulse-dot 1s infinite' }}>
              AI 严重异常!
            </Tag>
          )}
          <Tooltip title="振动频谱">
            <Button
              type="text"
              icon={<RadarChartOutlined />}
              onClick={() => setShowSpectrum(!showSpectrum)}
              size="small"
              style={{ color: showSpectrum ? '#36cfc9' : undefined }}
            />
          </Tooltip>
          <Tooltip title="远程专家">
            <Button
              type="text"
              icon={<TeamOutlined />}
              onClick={() => setRemoteExpertOpen(!remoteExpertOpen)}
              size="small"
              style={{ color: remoteExpertOpen ? '#36cfc9' : undefined }}
            />
          </Tooltip>
          <Tooltip title="路径规划">
            <Button
              type="text"
              icon={<CompassOutlined />}
              onClick={() => setPathPlannerOpen(!pathPlannerOpen)}
              size="small"
              style={{ color: pathPlannerOpen ? '#36cfc9' : undefined }}
            />
          </Tooltip>
          <Tooltip title="空间锚点">
            <Button
              type="text"
              icon={<PushpinOutlined />}
              onClick={() => setAnchorManagerOpen(true)}
              size="small"
            >
              锚点 {spatialAnchors.pendingCount > 0 && `(${spatialAnchors.pendingCount})`}
            </Button>
          </Tooltip>
          <Tooltip title="分享锚点">
            <Button
              type="text"
              icon={<ShareAltOutlined />}
              onClick={() => setAnchorShareOpen(true)}
              size="small"
            />
          </Tooltip>
          <Popover
            content={performancePopover}
            trigger="click"
            placement="bottomRight"
          >
            <Button
              type="text"
              size="small"
              icon={<RadarChartOutlined />}
              style={{ color: fpsColor }}
            >
              {performance.fps} FPS
            </Button>
          </Popover>
          <Popover
            content={settingsPopover}
            trigger="click"
            placement="bottomRight"
          >
            <Button type="text" icon={<SettingOutlined />} size="small" />
          </Popover>
        </Space>
      </div>

      {current === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Card className="glass-card" style={{ width: 560, textAlign: 'center' }}>
            <Spin spinning={loading}>
              <div style={{ padding: '40px 0' }}>
                <QrcodeOutlined style={{ fontSize: 64, color: '#36cfc9', marginBottom: 24 }} />
                <h2 style={{ color: '#e0e8f0', marginBottom: 8 }}>扫描设备二维码</h2>
                <p style={{ color: '#8ba3c0', marginBottom: 24 }}>
                  使用摄像头扫描设备上的二维码，或手动输入编码
                </p>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space>
                    <Button
                      type="primary"
                      icon={<QrcodeOutlined />}
                      size="large"
                      onClick={() => setScannerOpen(true)}
                    >
                      扫描二维码
                    </Button>
                    <Button
                      icon={<ClusterOutlined />}
                      size="large"
                      onClick={() => {
                        setMode(FACTORY_MODE);
                        setCurrent(1);
                        message.info('已进入车间模式，显示周围所有设备');
                      }}
                    >
                      进入车间模式
                    </Button>
                  </Space>
                </Space>
              </div>
            </Spin>
          </Card>
        </div>
      )}

      {current >= 1 && current <= 3 && (mode === FACTORY_MODE || equipment) && (
        <div className="inspection-layout">
          <div className="inspection-left">
            {equipment && (
              <Card
                size="small"
                className="glass-card"
                title={
                  <Space>
                    <InfoCircleOutlined style={{ color: '#36cfc9' }} />
                    <span>设备信息</span>
                  </Space>
                }
              >
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="名称">{equipment.name}</Descriptions.Item>
                  <Descriptions.Item label="编码">
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{equipment.qr_code}</span>
                  </Descriptions.Item>
                  <Descriptions.Item label="位置">{equipment.location || '--'}</Descriptions.Item>
                </Descriptions>
                {equipment.specs && Object.keys(equipment.specs).length > 0 && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(54,207,201,0.1)' }}>
                    {Object.entries(equipment.specs).map(([key, value]) => (
                      <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                        <span style={{ color: '#5a7a9a' }}>{key}</span>
                        <span style={{ color: '#e0e8f0', fontFamily: "'JetBrains Mono', monospace" }}>{String(value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {equipment && <SensorOverlay equipmentId={equipment.id} />}

            {showSpectrum && equipment && (
              <Card
                size="small"
                className="glass-card"
                title={
                  <Space>
                    <RadarChartOutlined style={{ color: '#36cfc9' }} />
                    <span>振动频谱</span>
                    {anomalyDetection.isDemoMode && <Tag color="default" style={{ fontSize: 10 }}>Demo</Tag>}
                  </Space>
                }
              >
                <VibrationSpectrum
                  spectrumData={anomalyDetection.spectrumData}
                  sampleRate={1000}
                  compact
                />
                {anomalyDetection.anomalyState && anomalyDetection.anomalyState.level !== 'normal' && (
                  <div style={{ marginTop: 8, padding: '4px 8px', borderRadius: 4, fontSize: 11,
                    background: anomalyDetection.anomalyState.level === 'critical' ? 'rgba(255,77,79,0.1)' : 'rgba(250,173,20,0.1)',
                    color: anomalyDetection.anomalyState.level === 'critical' ? '#ff4d4f' : '#faad14' }}>
                    <AlertOutlined style={{ marginRight: 4 }} />
                    AI 异常分数: {(anomalyDetection.anomalyState.score * 100).toFixed(1)}%
                    {anomalyDetection.anomalyState.details?.signals?.length > 0 && (
                      <span> — {anomalyDetection.anomalyState.details.signals.join(', ')}</span>
                    )}
                  </div>
                )}
              </Card>
            )}

            {remoteExpertOpen && (
              <RemoteExpertPanel />
            )}

            {pathPlannerOpen && (
              <InspectionPathPanel
                equipmentList={mode === FACTORY_MODE ? allEquipment : equipment ? [equipment] : []}
                onPathPlanned={(path) => setNavigationPath(path)}
              />
            )}

            {current >= 1 && !inspection && equipment && (
              <Button
                type="primary"
                block
                size="large"
                icon={<EyeOutlined />}
                onClick={startInspection}
                loading={loading}
              >
                开始巡检
              </Button>
            )}

            {current >= 2 && (
              <Card
                size="small"
                className="glass-card"
                title={
                  <Space>
                    <ToolOutlined style={{ color: '#ff4d4f' }} />
                    <span>缺陷列表 ({defects.length})</span>
                  </Space>
                }
                extra={
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<PlusCircleOutlined />}
                    onClick={() => {
                      setDefectPosition({ x: 0, y: 0, z: 0 });
                      setDefectModalOpen(true);
                    }}
                  >
                    添加
                  </Button>
                }
              >
                {defects.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击3D模型标记缺陷" />
                ) : (
                  defects.map((d, i) => (
                    <div key={d.id || i} className={`defect-item defect-severity-${d.severity || 'medium'}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, flex: 1 }}>{d.description || `缺陷 #${i + 1}`}</span>
                        <Space>
                          {d._offline && (
                            <Tooltip title="离线缓存">
                              <Tag color="default" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>
                                离线
                              </Tag>
                            </Tooltip>
                          )}
                          <Tag
                            color={severityConfig[d.severity]?.color || 'default'}
                            style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}
                          >
                            {severityConfig[d.severity]?.text || d.severity}
                          </Tag>
                        </Space>
                      </div>
                    </div>
                  ))
                )}
              </Card>
            )}
          </div>

          <div className="inspection-center">
            <ModelViewer
              equipment={viewerEquipmentList}
              modelUrl={equipment?.model_path}
              onModelClick={handleModelClick}
              defects={defects}
              sensorData={{}}
              arMode={arMode}
              lodBias={performance.lodBias}
              showPerformance={showPerformance}
              anchors={spatialAnchors.anchors}
              anomalyAlerts={anomalyAlerts}
              navigationPath={navigationPath}
            />
            {current >= 2 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(10,22,40,0.85)',
                  padding: '6px 16px',
                  borderRadius: 20,
                  fontSize: 12,
                  color: '#36cfc9',
                  border: '1px solid rgba(54,207,201,0.3)',
                  pointerEvents: 'none',
                }}
              >
                {mode === FACTORY_MODE ? '点击设备卡片选择设备，点击模型表面标记缺陷' : '点击模型表面标记缺陷位置'}
              </div>
            )}
            {showPerformance && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  background: 'rgba(10,22,40,0.85)',
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  border: '1px solid rgba(54,207,201,0.2)',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ color: fpsColor }}>FPS: {performance.fps}</div>
                {performance.memory && (
                  <div style={{ color: performance.memory.percentage > 80 ? '#ff4d4f' : '#8ba3c0' }}>
                    MEM: {performance.memory.percentage.toFixed(1)}%
                  </div>
                )}
                <div style={{ color: '#36cfc9' }}>LOD: {performance.lodBias.toFixed(1)}x</div>
              </div>
            )}
          </div>

          <div className="inspection-right">
            {current === 2 && (
              <>
                <Card size="small" className="glass-card" title="巡检操作">
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Button
                      block
                      icon={<PlusCircleOutlined />}
                      onClick={() => {
                        setDefectPosition({ x: 0, y: 0, z: 0 });
                        setDefectModalOpen(true);
                      }}
                    >
                      手动添加缺陷
                    </Button>
                    <Button
                      block
                      icon={<PushpinOutlined />}
                      onClick={() => setAnchorManagerOpen(true)}
                    >
                      管理空间锚点
                    </Button>
                    <div style={{ fontSize: 12, color: '#5a7a9a', textAlign: 'center' }}>
                      或点击3D模型表面标记缺陷
                    </div>
                  </Space>
                </Card>

                <Card size="small" className="glass-card" title="巡检备注">
                  <TextArea
                    rows={4}
                    placeholder="添加巡检备注..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={1000}
                    showCount
                  />
                </Card>

                <Button
                  type="primary"
                  block
                  size="large"
                  icon={<CheckCircleOutlined />}
                  onClick={completeInspection}
                  loading={loading}
                >
                  完成巡检
                </Button>
              </>
            )}

            {current === 3 && (
              <Card className="glass-card" title="巡检完成">
                <Result
                  status="success"
                  title="巡检已完成"
                  subTitle={`共发现 ${defects.length} 个缺陷`}
                  extra={[
                    <Button
                      key="report"
                      type="primary"
                      icon={<FileTextOutlined />}
                      onClick={generateReport}
                    >
                      生成报告
                    </Button>,
                    <Button key="new" onClick={resetInspection}>
                      新建巡检
                    </Button>,
                  ]}
                />
              </Card>
            )}
          </div>
        </div>
      )}

      {current === 4 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Card className="glass-card" style={{ width: 480, textAlign: 'center' }}>
            <Result
              status="success"
              title="巡检报告已生成"
              subTitle={`设备 ${equipment?.name} 巡检报告`}
              extra={[
                <Button
                  key="download"
                  type="primary"
                  icon={<DownloadOutlined />}
                  size="large"
                  onClick={downloadReport}
                >
                  下载报告
                </Button>,
                <Button key="new" onClick={resetInspection}>
                  新建巡检
                </Button>,
              ]}
            />
          </Card>
        </div>
      )}

      <QRScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onQRDetected={handleQRDetected}
      />

      <DefectMarker
        open={defectModalOpen}
        position={defectPosition}
        onClose={() => {
          setDefectModalOpen(false);
          setDefectPosition(null);
        }}
        onSubmit={handleDefectSubmit}
      />

      <AnchorManager
        open={anchorManagerOpen}
        onClose={() => setAnchorManagerOpen(false)}
        {...spatialAnchors}
        currentCameraPosition={cameraPositionRef.current}
      />

      <AnchorShareModal
        open={anchorShareOpen}
        onClose={() => setAnchorShareOpen(false)}
        anchors={spatialAnchors.anchors}
        onShare={spatialAnchors.shareAnchor}
        onImport={spatialAnchors.importAnchor}
      />
    </div>
  );
}
