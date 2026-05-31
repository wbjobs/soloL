import React from 'react'
import { FileText, Image, File, Layers } from 'lucide-react'

interface TypeFilterProps {
  value: string
  onChange: (value: string) => void
}

const types = [
  { value: 'all', label: '全部', icon: Layers },
  { value: 'text', label: '文本', icon: FileText },
  { value: 'image', label: '图片', icon: Image },
  { value: 'file', label: '文件', icon: File },
]

const TypeFilter: React.FC<TypeFilterProps> = ({ value, onChange }) => {
  return (
    <div className="flex items-center gap-1 p-1 bg-dark-800/50 rounded-xl">
      {types.map((type) => {
        const Icon = type.icon
        const isActive = value === type.value

        return (
          <button
            key={type.value}
            onClick={() => onChange(type.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
              isActive
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
            }`}
          >
            <Icon size={14} />
            <span>{type.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default TypeFilter
