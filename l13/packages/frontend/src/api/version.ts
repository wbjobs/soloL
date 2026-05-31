import client from './client';
import type { Version, VersionDiff, CreateVersionRequest, ApiResponse } from '../types';

export async function createVersion(req: CreateVersionRequest): Promise<Version> {
  const response = await client.post<ApiResponse<Version>>('/versions', req);
  return response.data.data;
}

export async function listVersions(projectId: string): Promise<Version[]> {
  const response = await client.get<ApiResponse<Version[]>>(
    `/projects/${projectId}/versions`,
  );
  return response.data.data;
}

export async function getVersionDiff(
  versionId: string,
  previousVersionId?: string,
): Promise<VersionDiff> {
  const response = await client.get<ApiResponse<VersionDiff>>(
    `/versions/${versionId}/diff`,
    { params: { previousVersionId } },
  );
  return response.data.data;
}
