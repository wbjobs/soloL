import client from './client';
import type { ProofreadBlock, UpdateBlockRequest, MoveTimelineRequest, ApiResponse } from '../types';

export async function getBlocks(projectId: string): Promise<ProofreadBlock[]> {
  const response = await client.get<ApiResponse<ProofreadBlock[]>>(
    `/projects/${projectId}/blocks`,
  );
  return response.data.data;
}

export async function updateBlock(req: UpdateBlockRequest): Promise<ProofreadBlock> {
  const { blockId, ...data } = req;
  const response = await client.patch<ApiResponse<ProofreadBlock>>(
    `/blocks/${blockId}`,
    data,
  );
  return response.data.data;
}

export async function moveTimeline(req: MoveTimelineRequest): Promise<ProofreadBlock> {
  const { blockId, ...data } = req;
  const response = await client.patch<ApiResponse<ProofreadBlock>>(
    `/blocks/${blockId}/timeline`,
    data,
  );
  return response.data.data;
}
