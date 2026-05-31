const API_BASE = 'http://localhost:8000'

export async function uploadChunk(
  fileId: string,
  chunkIndex: number,
  chunkHash: string,
  totalChunks: number,
  chunkBlob: Blob
): Promise<any> {
  const formData = new FormData()
  formData.append('file', chunkBlob, `chunk_${chunkIndex}`)
  formData.append('file_id', fileId)
  formData.append('chunk_index', String(chunkIndex))
  formData.append('chunk_hash', chunkHash)
  formData.append('total_chunks', String(totalChunks))

  const response = await fetch(`${API_BASE}/api/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    throw new Error(`Upload chunk ${chunkIndex} failed`)
  }
  return response.json()
}

export async function completeUpload(
  fileId: string,
  fileName: string,
  totalChunks: number,
  totalSize: number,
  chunkHashes: string[]
): Promise<any> {
  const response = await fetch(`${API_BASE}/api/upload/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_id: fileId,
      file_name: fileName,
      total_chunks: totalChunks,
      total_size: totalSize,
      chunk_hashes: chunkHashes,
    }),
  })
  if (!response.ok) {
    throw new Error('Complete upload failed')
  }
  return response.json()
}

export async function fetchFiles(): Promise<any> {
  const response = await fetch(`${API_BASE}/api/files`)
  if (!response.ok) {
    throw new Error('Fetch files failed')
  }
  return response.json()
}

export async function fetchStats(fileId: string): Promise<any> {
  const response = await fetch(`${API_BASE}/api/stats/${fileId}`)
  if (!response.ok) {
    throw new Error('Fetch stats failed')
  }
  return response.json()
}

export async function fetchTorrent(fileId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}/api/torrent/${fileId}`)
  if (!response.ok) {
    throw new Error('Fetch torrent failed')
  }
  return response.blob()
}

export async function fetchChunk(fileId: string, chunkIndex: number): Promise<Blob> {
  const response = await fetch(`${API_BASE}/api/chunk/${fileId}/${chunkIndex}`)
  if (!response.ok) {
    throw new Error('Fetch chunk failed')
  }
  return response.blob()
}

export async function fetchPeerHealth(infoHash: string): Promise<any> {
  const response = await fetch(`${API_BASE}/tracker/health/${infoHash}`)
  if (!response.ok) {
    throw new Error('Fetch peer health failed')
  }
  return response.json()
}

export async function fetchHotFiles(): Promise<any> {
  const response = await fetch(`${API_BASE}/api/hotness`)
  if (!response.ok) {
    throw new Error('Fetch hot files failed')
  }
  return response.json()
}

export async function fetchFileHotness(fileId: string): Promise<any> {
  const response = await fetch(`${API_BASE}/api/hotness/${fileId}`)
  if (!response.ok) {
    throw new Error('Fetch file hotness failed')
  }
  return response.json()
}

export async function fetchNodes(): Promise<any> {
  const response = await fetch(`${API_BASE}/api/nodes`)
  if (!response.ok) {
    throw new Error('Fetch nodes failed')
  }
  return response.json()
}

export async function fetchHeatmap(): Promise<any> {
  const response = await fetch(`${API_BASE}/api/nodes/heatmap`)
  if (!response.ok) {
    throw new Error('Fetch heatmap failed')
  }
  return response.json()
}

export async function fetchReplicas(infoHash?: string): Promise<any> {
  const url = infoHash ? `${API_BASE}/api/replicas?info_hash=${infoHash}` : `${API_BASE}/api/replicas`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Fetch replicas failed')
  }
  return response.json()
}

export async function createReplicas(fileId: string, count?: number, targetNodeIds?: string[]): Promise<any> {
  const response = await fetch(`${API_BASE}/api/replicas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_id: fileId,
      count: count,
      target_node_ids: targetNodeIds,
    }),
  })
  if (!response.ok) {
    throw new Error('Create replicas failed')
  }
  return response.json()
}

export async function removeReplica(containerId: string): Promise<any> {
  const response = await fetch(`${API_BASE}/api/replicas`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ container_id: containerId }),
  })
  if (!response.ok) {
    throw new Error('Remove replica failed')
  }
  return response.json()
}
