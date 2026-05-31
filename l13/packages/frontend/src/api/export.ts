import client from './client';
import type { ExportSrtRequest, ApiResponse } from '../types';

export async function exportSrt(req: ExportSrtRequest): Promise<Blob> {
  const response = await client.post<Blob>('/export', req, {
    responseType: 'blob',
  });
  return response.data;
}
