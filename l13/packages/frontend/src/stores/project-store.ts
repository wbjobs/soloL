import { create } from 'zustand';
import type { Project } from '../types';

interface ProjectState {
  currentProject: Project | null;
  projectList: Project[];
  loading: boolean;
  error: string | null;
  setCurrentProject: (project: Project | null) => void;
  setProjectList: (projects: Project[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  projectList: [],
  loading: false,
  error: null,
  setCurrentProject: (project) => set({ currentProject: project }),
  setProjectList: (projects) => set({ projectList: projects }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
