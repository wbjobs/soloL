import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import MainWindow from './pages/MainWindow'
import FloatWindow from './pages/FloatWindow'
import SettingsPage from './pages/SettingsPage'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/main" element={<MainWindow />} />
        <Route path="/float" element={<FloatWindow />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
)
