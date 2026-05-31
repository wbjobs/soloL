import { useState } from 'react'
import useStore from '../store/useStore'
import { exportAPI } from '../services/api'

const ANNOTATION_TYPES = [
  { value: 'chord', label: '和弦进行', color: '#22c55e' },
  { value: 'melody', label: '旋律动机', color: '#f59e0b' },
  { value: 'rhythm', label: '节奏型', color: '#ec4899' },
  { value: 'other', label: '其他', color: '#6366f1' }
]

function AnnotationPanel() {
  const {
    selectedMidi,
    annotations,
    onlineUsers,
    createAnnotation,
    deleteAnnotation,
    timePosition,
    selectedMidiId,
    username
  } = useStore()

  const [formData, setFormData] = useState({
    type: 'chord',
    label: '',
    start_time: 0,
    end_time: 1,
    metadata: ''
  })

  const [editingId, setEditingId] = useState(null)

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const setCurrentTime = (field) => {
    setFormData(prev => ({ ...prev, [field]: parseFloat(timePosition.toFixed(2)) }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!selectedMidiId) return

    try {
      const metadata = formData.metadata ? JSON.parse(formData.metadata) : undefined

      await createAnnotation({
        midi_id: selectedMidiId,
        type: formData.type,
        label: formData.label,
        start_time: parseFloat(formData.start_time),
        end_time: parseFloat(formData.end_time),
        created_by: username,
        metadata
      })

      setFormData({
        type: 'chord',
        label: '',
        start_time: 0,
        end_time: 1,
        metadata: ''
      })
    } catch (error) {
      alert('创建标注失败: ' + error.message)
    }
  }

  const handleDelete = async (annotationId) => {
    if (confirm('确定要删除这个标注吗？')) {
      try {
        await deleteAnnotation(annotationId)
      } catch (error) {
        alert('删除失败: ' + error.message)
      }
    }
  }

  const handleExport = () => {
    if (selectedMidiId) {
      exportAPI.download(selectedMidiId)
    }
  }

  const formatTime = (seconds) => {
    return seconds.toFixed(2) + 's'
  }

  if (!selectedMidi) {
    return (
      <div className="annotation-panel">
        <div className="empty-state">
          <div className="empty-state-icon">✏️</div>
          <div className="empty-state-text">选择一个 MIDI 文件</div>
          <div className="empty-state-subtext">加载后可以添加标注</div>
        </div>
      </div>
    )
  }

  return (
    <div className="annotation-panel">
      <div className="annotation-header">
        <h3>在线用户 ({onlineUsers.length})</h3>
        <div className="online-users">
          {onlineUsers.map((user) => (
            <div key={user.user_id} className="user-badge">
              <span className="user-dot"></span>
              <span>{user.username}</span>
            </div>
          ))}
        </div>
      </div>

      <form className="annotation-form" onSubmit={handleSubmit}>
        <h3 style={{ fontSize: '14px', color: '#a0a0d0', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          添加标注
        </h3>

        <div className="form-group">
          <label>类型</label>
          <select
            value={formData.type}
            onChange={(e) => handleInputChange('type', e.target.value)}
          >
            {ANNOTATION_TYPES.map(type => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>标签</label>
          <input
            type="text"
            value={formData.label}
            onChange={(e) => handleInputChange('label', e.target.value)}
            placeholder="如: C-G-Am-F 进行"
            required
          />
        </div>

        <div className="time-inputs">
          <div className="form-group">
            <label>
              开始时间
              <button
                type="button"
                className="btn btn-small btn-secondary"
                style={{ marginLeft: '4px', padding: '2px 6px', fontSize: '10px' }}
                onClick={() => setCurrentTime('start_time')}
              >
                当前
              </button>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max={selectedMidi.total_duration}
              value={formData.start_time}
              onChange={(e) => handleInputChange('start_time', e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>
              结束时间
              <button
                type="button"
                className="btn btn-small btn-secondary"
                style={{ marginLeft: '4px', padding: '2px 6px', fontSize: '10px' }}
                onClick={() => setCurrentTime('end_time')}
              >
                当前
              </button>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max={selectedMidi.total_duration}
              value={formData.end_time}
              onChange={(e) => handleInputChange('end_time', e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label>元数据 (JSON, 可选)</label>
          <textarea
            value={formData.metadata}
            onChange={(e) => handleInputChange('metadata', e.target.value)}
            placeholder='{"chords": ["C", "G", "Am", "F"], "key": "C"}'
            rows={2}
          />
        </div>

        <button type="submit" className="btn">
          添加标注
        </button>
      </form>

      <div className="annotation-header">
        <h3>标注列表 ({annotations.length})</h3>
      </div>

      <div className="annotation-list">
        {annotations.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px' }}>
            <div className="empty-state-icon" style={{ fontSize: '32px' }}>📝</div>
            <div className="empty-state-text" style={{ fontSize: '13px' }}>暂无标注</div>
            <div className="empty-state-subtext" style={{ fontSize: '11px' }}>添加第一个标注开始协作</div>
          </div>
        ) : (
          annotations.map((annot) => (
            <div key={annot.id} className={`annotation-item ${annot.type}`}>
              <div className="annotation-header-row">
                <span className="annotation-label">{annot.label}</span>
                <span className="annotation-type">
                  {ANNOTATION_TYPES.find(t => t.value === annot.type)?.label || annot.type}
                </span>
              </div>
              <div className="annotation-time">
                {formatTime(annot.start_time)} - {formatTime(annot.end_time)}
                <span style={{ marginLeft: '8px', color: '#6060a0' }}>
                  时长: {(annot.end_time - annot.start_time).toFixed(2)}s
                </span>
              </div>
              {annot.metadata && (
                <div style={{ fontSize: '10px', color: '#6060a0', marginTop: '4px', wordBreak: 'break-all' }}>
                  {JSON.stringify(annot.metadata)}
                </div>
              )}
              <div className="annotation-creator">
                由 {annot.created_by} 创建
              </div>
              <div className="annotation-actions">
                <button
                  className="btn btn-small btn-secondary"
                  onClick={() => {
                    setFormData({
                      type: annot.type,
                      label: annot.label,
                      start_time: annot.start_time,
                      end_time: annot.end_time,
                      metadata: annot.metadata ? JSON.stringify(annot.metadata) : ''
                    })
                    setEditingId(annot.id)
                  }}
                >
                  编辑
                </button>
                <button
                  className="btn btn-small btn-danger"
                  onClick={() => handleDelete(annot.id)}
                >
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="export-section">
        <button className="btn btn-secondary" onClick={handleExport}>
          📥 导出标注为 JSON
        </button>
      </div>
    </div>
  )
}

export default AnnotationPanel
