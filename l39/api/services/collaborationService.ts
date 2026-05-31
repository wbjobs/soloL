import { Annotation, User, ViewState } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'annotations');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface AnnotationSession {
  sessionId: string;
  gridId: string;
  users: Map<string, User>;
  annotations: Annotation[];
  hostId: string;
  createdAt: number;
}

const activeSessions = new Map<string, AnnotationSession>();

export function createSession(gridId: string, host: User): string {
  const sessionId = uuidv4();
  
  const session: AnnotationSession = {
    sessionId,
    gridId,
    users: new Map(),
    annotations: [],
    hostId: host.id,
    createdAt: Date.now()
  };
  
  session.users.set(host.id, host);
  activeSessions.set(sessionId, session);
  
  saveSession(sessionId);
  
  return sessionId;
}

export function joinSession(sessionId: string, user: User): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;
  
  session.users.set(user.id, { ...user, isOnline: true, lastActive: Date.now() });
  saveSession(sessionId);
  
  return true;
}

export function leaveSession(sessionId: string, userId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;
  
  const user = session.users.get(userId);
  if (user) {
    user.isOnline = false;
    user.lastActive = Date.now();
  }
  
  saveSession(sessionId);
  return true;
}

export function getSessionUsers(sessionId: string): User[] {
  const session = activeSessions.get(sessionId);
  if (!session) return [];
  
  return Array.from(session.users.values());
}

export function addAnnotation(sessionId: string, annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>): Annotation | null {
  const session = activeSessions.get(sessionId);
  if (!session) return null;
  
  const newAnnotation: Annotation = {
    ...annotation,
    id: uuidv4(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  session.annotations.push(newAnnotation);
  saveSession(sessionId);
  
  return newAnnotation;
}

export function updateAnnotation(sessionId: string, annotationId: string, updates: Partial<Annotation>): Annotation | null {
  const session = activeSessions.get(sessionId);
  if (!session) return null;
  
  const idx = session.annotations.findIndex(a => a.id === annotationId);
  if (idx === -1) return null;
  
  session.annotations[idx] = {
    ...session.annotations[idx],
    ...updates,
    updatedAt: Date.now()
  };
  
  saveSession(sessionId);
  return session.annotations[idx];
}

export function deleteAnnotation(sessionId: string, annotationId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;
  
  const idx = session.annotations.findIndex(a => a.id === annotationId);
  if (idx === -1) return false;
  
  session.annotations.splice(idx, 1);
  saveSession(sessionId);
  return true;
}

export function getAnnotations(sessionId: string): Annotation[] {
  const session = activeSessions.get(sessionId);
  if (!session) return [];
  
  return session.annotations;
}

export function lockAnnotation(sessionId: string, annotationId: string, userId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;
  
  const annotation = session.annotations.find(a => a.id === annotationId);
  if (!annotation || annotation.isLocked) return false;
  
  annotation.isLocked = true;
  annotation.lockedBy = userId;
  annotation.updatedAt = Date.now();
  
  saveSession(sessionId);
  return true;
}

export function unlockAnnotation(sessionId: string, annotationId: string, userId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;
  
  const annotation = session.annotations.find(a => a.id === annotationId);
  if (!annotation || !annotation.isLocked || annotation.lockedBy !== userId) return false;
  
  annotation.isLocked = false;
  annotation.lockedBy = undefined;
  annotation.updatedAt = Date.now();
  
  saveSession(sessionId);
  return true;
}

function saveSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  
  const sessionData = {
    sessionId: session.sessionId,
    gridId: session.gridId,
    users: Array.from(session.users.entries()),
    annotations: session.annotations,
    hostId: session.hostId,
    createdAt: session.createdAt
  };
  
  fs.writeFileSync(
    path.join(DATA_DIR, `${sessionId}.json`),
    JSON.stringify(sessionData, null, 2)
  );
}

export function loadSession(sessionId: string): boolean {
  const filePath = path.join(DATA_DIR, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return false;
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    const session: AnnotationSession = {
      sessionId: data.sessionId,
      gridId: data.gridId,
      users: new Map(data.users),
      annotations: data.annotations,
      hostId: data.hostId,
      createdAt: data.createdAt
    };
    
    activeSessions.set(sessionId, session);
    return true;
  } catch (e) {
    return false;
  }
}

export function listSessions(gridId?: string): { 
  sessionId: string; 
  gridId: string; 
  hostId: string;
  userCount: number;
  annotationCount: number;
  createdAt: number;
}[] {
  const sessions: { 
    sessionId: string; 
    gridId: string; 
    hostId: string;
    userCount: number;
    annotationCount: number;
    createdAt: number;
  }[] = [];
  
  for (const session of activeSessions.values()) {
    if (!gridId || session.gridId === gridId) {
      sessions.push({
        sessionId: session.sessionId,
        gridId: session.gridId,
        hostId: session.hostId,
        userCount: session.users.size,
        annotationCount: session.annotations.length,
        createdAt: session.createdAt
      });
    }
  }
  
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const sessionId = path.basename(file, '.json');
    if (!activeSessions.has(sessionId)) {
      loadSession(sessionId);
      const session = activeSessions.get(sessionId);
      if (session && (!gridId || session.gridId === gridId)) {
        sessions.push({
          sessionId: session.sessionId,
          gridId: session.gridId,
          hostId: session.hostId,
          userCount: session.users.size,
          annotationCount: session.annotations.length,
          createdAt: session.createdAt
        });
      }
    }
  }
  
  return sessions;
}

export function getUserColor(userId: string): string {
  const colors = [
    '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', 
    '#ffeaa7', '#dfe6e9', '#fd79a8', '#a29bfe',
    '#00b894', '#e17055', '#0984e3', '#6c5ce7'
  ];
  
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}
