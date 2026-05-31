import { Server as HTTPServer } from 'http';
import { Server as IOServer, Socket } from 'socket.io';
import { User, ViewState, Annotation, CollaborationMessage } from '../../shared/types';
import { 
  joinSession, 
  leaveSession, 
  getSessionUsers, 
  addAnnotation, 
  updateAnnotation, 
  deleteAnnotation,
  getAnnotations,
  getUserColor
} from './collaborationService.js';

let io: IOServer | null = null;

interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  from: string;
  to: string;
  data: unknown;
}

interface SessionSocket {
  userId: string;
  sessionId: string;
  user: User;
}

const socketSessions = new Map<string, SessionSocket>();

export function setupSignalingServer(httpServer: HTTPServer): void {
  if (io) return;
  
  io = new IOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });
  
  io.on('connection', (socket: Socket) => {
    console.log('Socket connected:', socket.id);
    
    socket.on('join-session', (data: { sessionId: string; user: User }) => {
      handleJoinSession(socket, data.sessionId, data.user);
    });
    
    socket.on('leave-session', () => {
      handleLeaveSession(socket);
    });
    
    socket.on('signal', (message: SignalingMessage) => {
      handleSignal(socket, message);
    });
    
    socket.on('view-state', (viewState: ViewState) => {
      handleViewState(socket, viewState);
    });
    
    socket.on('cursor-position', (position: { x: number; y: number; point?: { x: number; y: number; z: number } }) => {
      handleCursorPosition(socket, position);
    });
    
    socket.on('add-annotation', (annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>) => {
      handleAddAnnotation(socket, annotation);
    });
    
    socket.on('update-annotation', (data: { annotationId: string; updates: Partial<Annotation> }) => {
      handleUpdateAnnotation(socket, data.annotationId, data.updates);
    });
    
    socket.on('delete-annotation', (annotationId: string) => {
      handleDeleteAnnotation(socket, annotationId);
    });
    
    socket.on('chat-message', (message: { text: string }) => {
      handleChatMessage(socket, message.text);
    });
    
    socket.on('disconnect', () => {
      handleLeaveSession(socket);
      console.log('Socket disconnected:', socket.id);
    });
  });
}

function handleJoinSession(socket: Socket, sessionId: string, user: User): void {
  const userWithColor: User = {
    ...user,
    color: getUserColor(user.id),
    isOnline: true,
    lastActive: Date.now()
  };
  
  const success = joinSession(sessionId, userWithColor);
  
  if (!success) {
    socket.emit('error', { message: 'Failed to join session' });
    return;
  }
  
  socketSessions.set(socket.id, {
    userId: user.id,
    sessionId,
    user: userWithColor
  });
  
  socket.join(sessionId);
  
  socket.emit('joined', {
    sessionId,
    user: userWithColor,
    users: getSessionUsers(sessionId),
    annotations: getAnnotations(sessionId)
  });
  
  socket.to(sessionId).emit('user-joined', userWithColor);
}

function handleLeaveSession(socket: Socket): void {
  const session = socketSessions.get(socket.id);
  if (!session) return;
  
  leaveSession(session.sessionId, session.userId);
  
  socket.to(session.sessionId).emit('user-left', session.user);
  
  socket.leave(session.sessionId);
  socketSessions.delete(socket.id);
}

function handleSignal(socket: Socket, message: SignalingMessage): void {
  const session = socketSessions.get(socket.id);
  if (!session) return;
  
  const targetSocket = findSocketByUserId(message.to);
  if (targetSocket) {
    targetSocket.emit('signal', {
      type: message.type,
      from: session.userId,
      data: message.data
    });
  }
}

function handleViewState(socket: Socket, viewState: ViewState): void {
  const session = socketSessions.get(socket.id);
  if (!session) return;
  
  socket.to(session.sessionId).emit('view-state', {
    userId: session.userId,
    viewState
  });
}

function handleCursorPosition(socket: Socket, position: { x: number; y: number; point?: { x: number; y: number; z: number } }): void {
  const session = socketSessions.get(socket.id);
  if (!session) return;
  
  socket.to(session.sessionId).emit('cursor-position', {
    userId: session.userId,
    userName: session.user.name,
    userColor: session.user.color,
    ...position
  });
}

function handleAddAnnotation(socket: Socket, annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>): void {
  const session = socketSessions.get(socket.id);
  if (!session) return;
  
  const newAnnotation = addAnnotation(session.sessionId, annotation);
  if (!newAnnotation) return;
  
  io?.to(session.sessionId).emit('annotation-added', newAnnotation);
}

function handleUpdateAnnotation(socket: Socket, annotationId: string, updates: Partial<Annotation>): void {
  const session = socketSessions.get(socket.id);
  if (!session) return;
  
  const updated = updateAnnotation(session.sessionId, annotationId, updates);
  if (!updated) return;
  
  io?.to(session.sessionId).emit('annotation-updated', updated);
}

function handleDeleteAnnotation(socket: Socket, annotationId: string): void {
  const session = socketSessions.get(socket.id);
  if (!session) return;
  
  const success = deleteAnnotation(session.sessionId, annotationId);
  if (!success) return;
  
  io?.to(session.sessionId).emit('annotation-deleted', annotationId);
}

function handleChatMessage(socket: Socket, text: string): void {
  const session = socketSessions.get(socket.id);
  if (!session) return;
  
  io?.to(session.sessionId).emit('chat-message', {
    userId: session.userId,
    userName: session.user.name,
    userColor: session.user.color,
    text,
    timestamp: Date.now()
  });
}

function findSocketByUserId(userId: string): Socket | null {
  for (const [socketId, session] of socketSessions.entries()) {
    if (session.userId === userId) {
      const sockets = io?.sockets.sockets;
      if (sockets) {
        const socket = sockets.get(socketId);
        if (socket) return socket;
      }
    }
  }
  return null;
}

export function getIo(): IOServer | null {
  return io;
}
