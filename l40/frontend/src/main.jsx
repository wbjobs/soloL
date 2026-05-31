import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './App.css';

const theme = {
  token: {
    colorPrimary: '#1890ff',
    colorBgContainer: '#0f1d32',
    colorBgElevated: '#132742',
    colorBgLayout: '#0a1628',
    colorText: '#e0e8f0',
    colorTextSecondary: '#8ba3c0',
    colorBorder: '#1e3a5f',
    borderRadius: 6,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  algorithm: antdTheme.darkAlgorithm,
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={theme}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
