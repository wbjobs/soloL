import { useState, useEffect } from 'react'
import useStore from '../store/useStore'

export default function OperationLogViewer() {
  const {
    selectedMidi,
    operationLogs,
    loadOperationLogs,
    clearOperationLogs
  } = useStore()

  const [showLogs, setShowLogs] = useState(false)

  useEffect(() => {
    if (selectedMidi && showLogs) {
      loadOperationLogs()
    }
  }, [selectedMidi?._id, showLogs])

  const getOperationIcon = (type) => {
    const icons = {
      'create_annotation': '➕',
      'update_annotation': '✏️',
      'delete_annotation': '🗑️',
      'train_model': '🧠',
      'predict_chord': '🔮',
      'apply_prediction': '✅',
      'export_report': '📄',
      'save_snapshot': '💾'
    }
    return icons[type] || '📝'
  }

  const getOperationName = (type) => {
    const names = {
      'create_annotation': '创建标注',
      'update_annotation': '更新标注',
      'delete_annotation': '删除标注',
      'train_model': '训练模型',
      'predict_chord': '预测和弦',
      'apply_prediction': '应用预测',
      'export_report': '导出报告',
      'save_snapshot': '保存快照'
    }
    return names[type] || type
  }

  const formatData = (data) => {
    if (!data) return '-'
    try {
      return JSON.stringify(data).substring(0, 50)
    } catch {
      return String(data).substring(0, 50)
    }
  }

  if (!selectedMidi) return null

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h3 style={styles.title}>📋 操作日志</h3>
        <button
          onClick={() => setShowLogs(!showLogs)}
          style={styles.toggleButton}
        >
          {showLogs ? '收起' : '展开'}
        </button>
      </div>

      {showLogs && (
        <>
          <div style={styles.toolbar}>
            <button onClick={loadOperationLogs} style={styles.refreshButton}>
              🔄 刷新
            </button>
            <button onClick={clearOperationLogs} style={styles.clearButton}>
              清空日志
            </button>
          </div>

          <div style={styles.logContainer}>
            {operationLogs.length === 0 ? (
              <p style={styles.emptyText}>暂无操作日志</p>
            ) : (
              operationLogs.map((log, index) => (
                <div key={log.id || index} style={styles.logItem}>
                  <div style={styles.logIcon}>
                    {getOperationIcon(log.type)}
                  </div>
                  <div style={styles.logContent}>
                    <div style={styles.logHeader}>
                      <span style={styles.logType}>
                        {getOperationName(log.type)}
                      </span>
                      <span style={styles.logUser}>
                        {log.user || '匿名'}
                      </span>
                    </div>
                    <div style={styles.logData}>
                      {formatData(log.data)}
                    </div>
                    <div style={styles.logTime}>
                      {new Date(log.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={styles.footer}>
            <span style={styles.count}>
              共 {operationLogs.length} 条记录
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  panel: {
    padding: '16px',
    borderBottom: '1px solid #e0e0e0'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  title: {
    margin: 0,
    fontSize: '16px',
    color: '#1a1a2e'
  },
  toggleButton: {
    padding: '4px 12px',
    backgroundColor: '#e0e7ff',
    color: '#4338ca',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  toolbar: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px'
  },
  refreshButton: {
    padding: '4px 12px',
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '11px'
  },
  clearButton: {
    padding: '4px 12px',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '11px'
  },
  logContainer: {
    maxHeight: '200px',
    overflowY: 'auto',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    backgroundColor: '#fafafa'
  },
  emptyText: {
    padding: '20px',
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: '12px',
    fontStyle: 'italic'
  },
  logItem: {
    display: 'flex',
    gap: '10px',
    padding: '10px 12px',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: 'white'
  },
  logIcon: {
    fontSize: '18px',
    width: '24px',
    textAlign: 'center'
  },
  logContent: {
    flex: 1
  },
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px'
  },
  logType: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#374151'
  },
  logUser: {
    fontSize: '11px',
    color: '#6b7280'
  },
  logData: {
    fontSize: '11px',
    color: '#6b7280',
    fontFamily: 'monospace',
    marginBottom: '4px',
    wordBreak: 'break-all'
  },
  logTime: {
    fontSize: '10px',
    color: '#9ca3af'
  },
  footer: {
    marginTop: '8px',
    textAlign: 'right'
  },
  count: {
    fontSize: '11px',
    color: '#6b7280'
  }
}
