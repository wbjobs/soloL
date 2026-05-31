import { ref, reactive } from 'vue'
import type { UploadProgress } from '@/types'
import { uploadChunk, completeUpload } from '@/utils/api'
import { computeSHA256, splitFileIntoChunks } from '@/utils/crypto'
import { generateFileId } from '@/utils/format'

const CHUNK_SIZE = 256 * 1024

export function useUpload() {
  const activeUploads = reactive<Map<string, UploadProgress>>(new Map())
  const completedUploads = ref<any[]>([])

  const startUpload = async (file: File) => {
    const fileId = generateFileId()
    const chunks = splitFileIntoChunks(file, CHUNK_SIZE)
    const totalChunks = chunks.length

    const progress: UploadProgress = {
      file_id: fileId,
      file_name: file.name,
      total_chunks: totalChunks,
      uploaded_chunks: 0,
      verified_chunks: 0,
      total_size: file.size,
      status: 'preparing',
      chunk_hashes: Array(totalChunks).fill(''),
    }

    activeUploads.set(fileId, progress)

    try {
      progress.status = 'uploading'

      for (let i = 0; i < chunks.length; i++) {
        const chunkBlob = chunks[i]
        const chunkHash = await computeSHA256(chunkBlob)
        progress.chunk_hashes[i] = chunkHash

        const result = await uploadChunk(
          fileId,
          i,
          chunkHash,
          totalChunks,
          chunkBlob
        )

        progress.uploaded_chunks++
        if (result.verified) {
          progress.verified_chunks++
        } else {
          throw new Error(`Chunk ${i} verification failed`)
        }
      }

      progress.status = 'verifying'

      const completeResult = await completeUpload(
        fileId,
        file.name,
        totalChunks,
        file.size,
        progress.chunk_hashes
      )

      progress.status = 'completed'

      const completed = {
        ...progress,
        torrent_url: completeResult.torrent_url,
        magnet_uri: completeResult.magnet_uri,
        info_hash: completeResult.info_hash,
      }

      completedUploads.value.push(completed)

      return completed
    } catch (error: any) {
      progress.status = 'error'
      progress.error = error.message
      throw error
    }
  }

  const clearUpload = (fileId: string) => {
    activeUploads.delete(fileId)
  }

  return {
    activeUploads,
    completedUploads,
    startUpload,
    clearUpload,
  }
}
