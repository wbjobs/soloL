import React, { useState, useEffect, useCallback } from 'react';
import { Card, Input, List, Tag, DatePicker, Select, Space, Button, Spin, Empty, message } from 'antd';
import {
  SearchOutlined,
  HistoryOutlined,
  DownloadOutlined,
  ReloadOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import InspectionTimeline from '../components/InspectionTimeline';
import { getEquipmentList, getInspections, getDefects, getReportUrl } from '../services/api';

const { RangePicker } = DatePicker;

const statusFilters = [
  { label: '全部', value: '' },
  { label: '已完成', value: 'completed' },
  { label: '进行中', value: 'in_progress' },
  { label: '异常', value: 'failed' },
];

export default function HistoryPage() {
  const [equipmentList, setEquipmentList] = useState([]);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [inspections, setInspections] = useState([]);
  const [defectsMap, setDefectsMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState(null);

  useEffect(() => {
    loadEquipmentList();
  }, []);

  const loadEquipmentList = useCallback(async () => {
    try {
      const res = await getEquipmentList();
      const list = res.data || [];
      setEquipmentList(Array.isArray(list) ? list : []);
    } catch {
      setEquipmentList([]);
    }
  }, []);

  const loadInspections = useCallback(async (equipmentId) => {
    setLoading(true);
    try {
      const res = await getInspections(equipmentId);
      let list = res.data || [];
      if (!Array.isArray(list)) list = [];

      if (statusFilter) {
        list = list.filter((i) => i.status === statusFilter);
      }
      if (dateRange && dateRange[0] && dateRange[1]) {
        list = list.filter((i) => {
          const d = dayjs(i.created_at);
          return d.isAfter(dateRange[0]) && d.isBefore(dateRange[1]);
        });
      }

      list.sort((a, b) => dayjs(b.created_at).valueOf() - dayjs(a.created_at).valueOf());
      setInspections(list);

      const dMap = {};
      await Promise.all(
        list.map(async (insp) => {
          try {
            const dRes = await getDefects(insp.id);
            dMap[insp.id] = dRes.data || [];
          } catch {
            dMap[insp.id] = [];
          }
        })
      );
      setDefectsMap(dMap);
    } catch (err) {
      message.error('加载巡检记录失败');
      setInspections([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateRange]);

  const handleSelectEquipment = useCallback((eq) => {
    setSelectedEquipment(eq);
    loadInspections(eq.id);
  }, [loadInspections]);

  const handleDownloadReport = useCallback((inspectionId) => {
    const url = getReportUrl(inspectionId);
    window.open(url, '_blank');
  }, []);

  const handleRefresh = useCallback(() => {
    if (selectedEquipment) {
      loadInspections(selectedEquipment.id);
    }
  }, [selectedEquipment, loadInspections]);

  const filteredList = equipmentList.filter((eq) => {
    if (!searchText) return true;
    const s = searchText.toLowerCase();
    return (
      (eq.name && eq.name.toLowerCase().includes(s)) ||
      (eq.qr_code && eq.qr_code.toLowerCase().includes(s)) ||
      (eq.location && eq.location.toLowerCase().includes(s))
    );
  });

  const statusColorMap = {
    normal: 'success',
    warning: 'warning',
    error: 'error',
    offline: 'default',
  };

  return (
    <div className="history-layout">
      <div className="history-left">
        <Card
          size="small"
          className="glass-card"
          title={
            <Space>
              <SearchOutlined style={{ color: '#36cfc9' }} />
              <span>设备列表</span>
            </Space>
          }
          style={{ height: '100%' }}
          bodyStyle={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 200px)' }}
        >
          <div style={{ padding: '8px 12px' }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索设备..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              size="small"
            />
          </div>
          <List
            dataSource={filteredList}
            locale={{ emptyText: <Empty description="无设备" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            renderItem={(eq) => (
              <List.Item
                onClick={() => handleSelectEquipment(eq)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: selectedEquipment?.id === eq.id ? 'rgba(24,144,255,0.1)' : 'transparent',
                  borderLeft: selectedEquipment?.id === eq.id ? '3px solid #1890ff' : '3px solid transparent',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{eq.name}</span>
                    <Tag
                      color="processing"
                      style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}
                    >
                      在线
                    </Tag>
                  </div>
                  <div style={{ fontSize: 11, color: '#5a7a9a', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
                    {eq.qr_code}
                  </div>
                  {eq.location && (
                    <div style={{ fontSize: 11, color: '#5a7a9a', marginTop: 1 }}>
                      {eq.location}
                    </div>
                  )}
                </div>
              </List.Item>
            )}
          />
        </Card>
      </div>

      <div className="history-right">
        {!selectedEquipment ? (
          <Card className="glass-card" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty
              description="请选择设备查看巡检历史"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </Card>
        ) : (
          <div>
            <Card
              size="small"
              className="glass-card"
              style={{ marginBottom: 12 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <Space>
                  <HistoryOutlined style={{ color: '#36cfc9' }} />
                  <span style={{ fontWeight: 500 }}>{selectedEquipment.name}</span>
                  <span style={{ color: '#5a7a9a', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                    {selectedEquipment.qr_code}
                  </span>
                </Space>
                <Space size={8}>
                  <Select
                    size="small"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={statusFilters.map((f) => ({ label: f.label, value: f.value }))}
                    style={{ width: 100 }}
                  />
                  <RangePicker
                    size="small"
                    value={dateRange}
                    onChange={setDateRange}
                    placeholder={['开始日期', '结束日期']}
                  />
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={handleRefresh}
                    loading={loading}
                  >
                    刷新
                  </Button>
                </Space>
              </div>
            </Card>

            <Spin spinning={loading}>
              <Card className="glass-card" bodyStyle={{ padding: 16 }}>
                {inspections.length === 0 && !loading ? (
                  <Empty description="该设备暂无巡检记录" />
                ) : (
                  <InspectionTimeline
                    inspections={inspections}
                    defectsMap={defectsMap}
                    onDownloadReport={handleDownloadReport}
                  />
                )}
              </Card>
            </Spin>
          </div>
        )}
      </div>
    </div>
  );
}
