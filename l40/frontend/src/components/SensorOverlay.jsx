import React, { useEffect, useRef, useState } from 'react';
import { Card, Row, Col, Tag } from 'antd';
import { FireOutlined, ThunderboltOutlined, DashboardOutlined } from '@ant-design/icons';
import useMqtt from '../hooks/useMqtt';

function getStatus(value, type) {
  if (value == null) return { level: 'unknown', className: '', label: '无数据' };
  if (type === 'temperature') {
    if (value > 95) return { level: 'critical', className: 'value-critical', label: '危险' };
    if (value > 80) return { level: 'warning', className: 'value-warning', label: '警告' };
    return { level: 'normal', className: 'value-normal', label: '正常' };
  }
  if (type === 'vibration') {
    if (value > 8) return { level: 'critical', className: 'value-critical', label: '危险' };
    if (value > 5) return { level: 'warning', className: 'value-warning', label: '警告' };
    return { level: 'normal', className: 'value-normal', label: '正常' };
  }
  if (type === 'rpm') {
    return { level: 'normal', className: 'value-normal', label: '正常' };
  }
  return { level: 'unknown', className: '', label: '未知' };
}

const tagColorMap = {
  normal: 'success',
  warning: 'warning',
  critical: 'error',
  unknown: 'default',
};

function MiniSparkline({ data, color }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.length < 2) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    data.forEach((val, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((val - min) / range) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color + '40');
    gradient.addColorStop(1, color + '05');
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  }, [data, color]);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={32}
      style={{ width: '100%', height: 32, display: 'block' }}
    />
  );
}

export default function SensorOverlay({ equipmentId }) {
  const mqttData = useMqtt(equipmentId);
  const [history, setHistory] = useState({ temperature: [], vibration: [], rpm: [] });

  useEffect(() => {
    if (mqttData.temperature != null) {
      setHistory((prev) => ({
        ...prev,
        temperature: [...prev.temperature.slice(-29), mqttData.temperature],
      }));
    }
    if (mqttData.vibration != null) {
      setHistory((prev) => ({
        ...prev,
        vibration: [...prev.vibration.slice(-29), mqttData.vibration],
      }));
    }
    if (mqttData.rpm != null) {
      setHistory((prev) => ({
        ...prev,
        rpm: [...prev.rpm.slice(-29), mqttData.rpm],
      }));
    }
  }, [mqttData.temperature, mqttData.vibration, mqttData.rpm]);

  const sensors = [
    {
      key: 'temperature',
      label: '温度',
      icon: <FireOutlined />,
      value: mqttData.temperature,
      unit: '°C',
      decimals: 1,
      sparkColor: '#36cfc9',
    },
    {
      key: 'vibration',
      label: '振动',
      icon: <ThunderboltOutlined />,
      value: mqttData.vibration,
      unit: 'mm/s',
      decimals: 2,
      sparkColor: '#faad14',
    },
    {
      key: 'rpm',
      label: '转速',
      icon: <DashboardOutlined />,
      value: mqttData.rpm,
      unit: 'RPM',
      decimals: 0,
      sparkColor: '#1890ff',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sensors.map((s) => {
        const status = getStatus(s.value, s.key);
        return (
          <Card
            key={s.key}
            size="small"
            className="glass-card"
            bodyStyle={{ padding: '10px 14px' }}
          >
            <Row align="middle" justify="space-between">
              <Col>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ color: '#36cfc9', fontSize: 14 }}>{s.icon}</span>
                  <span style={{ fontSize: 12, color: '#8ba3c0' }}>{s.label}</span>
                  <Tag color={tagColorMap[status.level]} style={{ marginLeft: 4, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                    {status.label}
                  </Tag>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span
                    className={`${status.className} ${status.level === 'critical' ? 'sensor-pulse' : ''}`}
                    style={{ fontSize: 24, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {s.value != null ? s.value.toFixed(s.decimals) : '--'}
                  </span>
                  <span style={{ fontSize: 11, color: '#5a7a9a' }}>{s.unit}</span>
                </div>
              </Col>
              <Col>
                <div className="sparkline-container">
                  <MiniSparkline data={history[s.key]} color={s.sparkColor} />
                </div>
              </Col>
            </Row>
          </Card>
        );
      })}
    </div>
  );
}
