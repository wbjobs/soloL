import axios from './client';
import type { AISuggestion, ReportStats } from '../types';

export async function generateAISuggestions(
  projectId: string,
  options?: { language?: string; model?: string; userId?: string },
): Promise<AISuggestion[]> {
  const { data } = await axios.post(
    `/whisper/${projectId}/transcribe`,
    options,
  );
  return data;
}

export async function getAISuggestions(projectId: string): Promise<AISuggestion[]> {
  const { data } = await axios.get(`/whisper/${projectId}/suggestions`);
  return data;
}

export async function adoptSuggestion(
  suggestionId: string,
  userId: string,
): Promise<void> {
  await axios.post(`/whisper/suggestions/${suggestionId}/adopt`, { userId });
}

export async function rejectSuggestion(
  suggestionId: string,
  userId: string,
): Promise<void> {
  await axios.post(`/whisper/suggestions/${suggestionId}/reject`, { userId });
}

export async function getReportStats(projectId: string): Promise<ReportStats> {
  const { data } = await axios.get(`/report/${projectId}/stats`);
  return data;
}

export async function exportReportHtml(projectId: string): Promise<void> {
  window.open(`/api/report/${projectId}/pdf`, '_blank');
}
