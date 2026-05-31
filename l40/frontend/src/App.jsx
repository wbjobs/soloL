import React from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Space } from 'antd';
import { SearchOutlined, HistoryOutlined, ExperimentOutlined } from '@ant-design/icons';
import InspectionPage from './pages/InspectionPage';
import HistoryPage from './pages/HistoryPage';
import SyncStatus from './components/SyncStatus';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/', icon: <SearchOutlined />, label: '设备巡检' },
  { key: '/history', icon: <HistoryOutlined />, label: '巡检历史' },
];

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header className="app-header">
        <div className="header-logo">
          <ExperimentOutlined style={{ fontSize: 22, marginRight: 10 }} />
          <span className="header-title">MR 工业设备巡检系统</span>
        </div>
        <div className="header-status">
          <Space size={16}>
            <SyncStatus />
            <span className="status-dot online" />
            <span>系统在线</span>
          </Space>
        </div>
      </Header>
      <Layout>
        <Sider
          width={200}
          className="app-sider"
          breakpoint="lg"
          collapsedWidth={0}
        >
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            className="sider-menu"
          />
          <div className="sider-footer">
            <div className="sider-version">v1.0.0</div>
          </div>
        </Sider>
        <Layout className="app-content-layout">
          <Content className="app-content">
            <Routes>
              <Route path="/" element={<InspectionPage />} />
              <Route path="/history" element={<HistoryPage />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
}
