import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Database, Wifi, Clock, HardDrive, Users, Settings2, Trash2 } from 'lucide-react'
import { useSettingsStore } from '../../store/useSettingsStore'
import { formatFileSize } from '../../utils/format.tsx'
import type { PeerInfo } from '../../../types'

const SettingsPage: React.FC = () => {
  const { settings, peers, syncEnabled, dbStats, setSettings, setPeers, setSyncEnabled, setDbStats } = useSettingsStore()
  const [activeTab, setActiveTab] = useState('general')

  useEffect(() => {
    loadSettings()
    loadDbStats()
    loadPeers()
    checkSyncStatus()
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.sync.onPeersChanged(loadPeers)
  }, [])

  const loadSettings = async () => {
    if (!window.electronAPI) return
    const allSettings = await window.electronAPI.settings.getAll()
    setSettings(allSettings)
  }

  const loadDbStats = async () => {
    if (!window.electronAPI) return
    const stats = await window.electronAPI.database.stats()
    setDbStats(stats)
  }

  const loadPeers = async () => {
    if (!window.electronAPI) return
    const peerList = await window.electronAPI.sync.peers()
    setPeers(peerList)
  }

  const checkSyncStatus = async () => {
    if (!window.electronAPI) return
    const enabled = await window.electronAPI.sync.status()
    setSyncEnabled(enabled)
  }

  const updateSetting = async (key: string, value: string) => {
    if (!window.electronAPI) return
    await window.electronAPI.settings.set(key, value)
    setSettings({ ...settings, [key]: value })
  }

  const toggleSync = async () => {
    if (!window.electronAPI) return
    if (syncEnabled) {
      await window.electronAPI.sync.disable()
      setSyncEnabled(false)
    } else {
      const success = await window.electronAPI.sync.enable()
      setSyncEnabled(success)
    }
  }

  const handleVacuum = async () => {
    if (!window.electronAPI) return
    await window.electronAPI.database.vacuum()
    loadDbStats()
  }

  const handleCleanup = async () => {
    if (!window.electronAPI) return
    await window.electronAPI.database.cleanup()
    loadDbStats()
  }

  const tabs = [
    { id: 'general', label: '通用', icon: Settings2 },
    { id: 'sync', label: '同步', icon: Wifi },
    { id: 'database', label: '数据库', icon: Database },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">

      <div className="flex-1 flex overflow-hidden">
        <div className="w-48 p-4 border-r border-white/5">
          <div className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm transition-all ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'general' && (
              <GeneralSettings settings={settings} updateSetting={updateSetting} />
            )}
            {activeTab === 'sync' && (
              <SyncSettings
                syncEnabled={syncEnabled}
                toggleSync={toggleSync}
                peers={peers}
                settings={settings}
                updateSetting={updateSetting}
              />
            )}
            {activeTab === 'database' && (
              <DatabaseSettings
                dbStats={dbStats}
                onVacuum={handleVacuum}
                onCleanup={handleCleanup}
                maxRecords={parseInt(String(settings.maxRecords || '10000'), 10)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

const GeneralSettings: React.FC<{
  settings: any
  updateSetting: (key: string, value: string) => void
}> = ({ settings, updateSetting }) => {
  return (
    <motion.div
      key="general"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      <h2 className="text-lg font-semibold text-gray-100">通用设置</h2>

      <div className="space-y-4">
        <SettingItem label="最大记录数">
          <input
            type="number"
            value={settings.maxRecords || '10000'}
            onChange={(e) => updateSetting('maxRecords', e.target.value)}
            className="w-32 px-3 py-1.5 bg-dark-700 border border-white/10 rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500/50"
          />
        </SettingItem>

        <SettingItem label="全局快捷键">
          <input
            type="text"
            value={settings.shortcut || 'CmdOrCtrl+Shift+V'}
            onChange={(e) => updateSetting('shortcut', e.target.value)}
            className="w-48 px-3 py-1.5 bg-dark-700 border border-white/10 rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500/50"
          />
        </SettingItem>

        <SettingItem label="启用OCR识别">
          <ToggleSwitch
            checked={settings.enableOcr !== 'false'}
            onChange={(checked) => updateSetting('enableOcr', String(checked))}
          />
        </SettingItem>
      </div>
    </motion.div>
  )
}

const SyncSettings: React.FC<{
  syncEnabled: boolean
  toggleSync: () => void
  peers: PeerInfo[]
  settings: any
  updateSetting: (key: string, value: string) => void
}> = ({ syncEnabled, toggleSync, peers, settings, updateSetting }) => {
  return (
    <motion.div
      key="sync"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      <h2 className="text-lg font-semibold text-gray-100">局域网同步</h2>

      <div className="space-y-4">
        <SettingItem label="启用局域网同步">
          <ToggleSwitch checked={syncEnabled} onChange={toggleSync} />
        </SettingItem>

        {syncEnabled && (
          <>
            <SettingItem label="同步端口">
              <input
                type="number"
                value={settings.syncPort || '8972'}
                onChange={(e) => updateSetting('syncPort', e.target.value)}
                className="w-24 px-3 py-1.5 bg-dark-700 border border-white/10 rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500/50"
              />
            </SettingItem>

            <div className="pt-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                <Users size={16} />
                已发现设备
              </h3>
              <div className="space-y-2">
                {peers.length === 0 ? (
                  <p className="text-sm text-gray-500">暂未发现其他设备</p>
                ) : (
                  peers.map((peer) => (
                    <div
                      key={peer.deviceId}
                      className="flex items-center justify-between p-3 rounded-xl bg-dark-700/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${peer.isOnline ? 'bg-green-500' : 'bg-gray-500'}`} />
                        <div>
                          <p className="text-sm text-gray-200">{peer.deviceName}</p>
                          <p className="text-xs text-gray-500">{peer.ipAddress}</p>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        peer.isOnline
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {peer.isOnline ? '在线' : '离线'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}

const DatabaseSettings: React.FC<{
  dbStats: { totalCount: number; size: number }
  onVacuum: () => void
  onCleanup: () => void
  maxRecords: number
}> = ({ dbStats, onVacuum, onCleanup, maxRecords }) => {
  return (
    <motion.div
      key="database"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      <h2 className="text-lg font-semibold text-gray-100">数据库管理</h2>

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={HardDrive} label="记录总数" value={dbStats.totalCount.toString()} />
        <StatCard icon={Database} label="数据库大小" value={formatFileSize(dbStats.size)} />
        <StatCard icon={Clock} label="记录上限" value={`${maxRecords} 条`} />
      </div>

      <div className="space-y-3 pt-4">
        <h3 className="text-sm font-medium text-gray-300">维护操作</h3>

        <div className="flex items-center justify-between p-4 rounded-xl bg-dark-700/50">
          <div>
            <p className="text-sm text-gray-200">压缩数据库</p>
            <p className="text-xs text-gray-500">清理碎片，减少磁盘占用</p>
          </div>
          <button
            onClick={onVacuum}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            压缩
          </button>
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl bg-dark-700/50">
          <div>
            <p className="text-sm text-gray-200">清理旧记录</p>
            <p className="text-xs text-gray-500">删除超出限制的非收藏记录</p>
          </div>
          <button
            onClick={onCleanup}
            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm rounded-lg transition-colors flex items-center gap-2"
          >
            <Trash2 size={14} />
            清理
          </button>
        </div>
      </div>
    </motion.div>
  )
}

const SettingItem: React.FC<{
  label: string
  children: React.ReactNode
}> = ({ label, children }) => {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-300">{label}</span>
      {children}
    </div>
  )
}

const ToggleSwitch: React.FC<{
  checked: boolean
  onChange: (checked: boolean) => void
}> = ({ checked, onChange }) => {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-dark-600'
      }`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

const StatCard: React.FC<{
  icon: any
  label: string
  value: string
}> = ({ icon: Icon, label, value }) => {
  return (
    <div className="p-4 rounded-xl bg-dark-700/50">
      <div className="flex items-center gap-2 text-gray-400 mb-2">
        <Icon size={16} />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-xl font-semibold text-gray-100">{value}</p>
    </div>
  )
}

export default SettingsPage
