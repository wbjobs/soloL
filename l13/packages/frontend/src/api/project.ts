import client from './client';
import type { Project, ApiResponse } from '../types';

export async function createProject(name: string, video: File, srt: File): Promise<Project> {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('video', video);
  formData.append('srt', srt);

  const response = await client.post<ApiResponse<Project>>('/projects', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.data;
}

export async function getProject(id: string): Promise<Project> {
  const response = await client.get<ApiResponse<Project>>(`/projects/${id}`);
  return response.data.data;
}

export async function listProjects(page = 1, pageSize = 20): Promise<Project[]> {
  const response = await client.get<ApiResponse<Project[]>>('/projects', {
    params: { page, pageSize },
  });
  return response.data.data;
}
