import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Users, 
  Plus, 
  Trash2, 
  MapPin, 
  LineChart, 
  MessageCircle,
  ChevronDown, 
  ChevronUp,
  Copy,
  Check,
  LogIn,
  LogOut
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { collaborationAPI } from '../../utils/api';
import { Annotation, User, ViewState } from '../../../shared/types';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

interface CollaborationPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

type AnnotationType = 'fault' | 'well' | 'comment' | 'polygon' | 'line';

const annotationTypeIcons: Record<AnnotationType, JSX.Element> = {
  fault: <LineChart size={14} />,
  well: <MapPin size={14} />,
  comment: <MessageCircle size={14} />,
  polygon: <div className="w-3 h-3 border-2 border-current" />,
  line: <div className="w-4 h-0.5 bg-current" />
};

const annotationTypeNames: Record<AnnotationType, string> = {
  fault: '断层线',
  well: '井位建议',
  comment: '注释',
  polygon: '多边形',
  line: '测线'
};

export function CollaborationPanel({ isOpen, onToggle }: CollaborationPanelProps) {
  const { 
    gridId, 
    collaborationSessionId,
    collaborationUsers,
    currentUser,
    annotations,
    setCollaborationSessionId,
    setCollaborationUsers,
    setCurrentUser,
    setAnnotations,
    addAnnotation,
    deleteAnnotation,
    setRemoteCursor,
    removeRemoteCursor,
    setRemoteView,
    showAnnotations,
    setShowAnnotations
  } = useStore();
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [userName, setUserName] = useState('');
  const [selectedAnnotationType, setSelectedAnnotationType] = useState<AnnotationType>('fault');
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number; z: number }[]>([]);
  const [sessionList, setSessionList] = useState<{
    sessionId: string;
    gridId: string;
    hostId: string;
    userCount: number;
    annotationCount: number;
    createdAt: number;
  }[]>([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<{
    userId: string;
    userName: string;
    userColor: string;
    text: string;
    timestamp: number;
  }[]>([]);
  
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (gridId && !collaborationSessionId) {
      loadSessions();
    }
  }, [gridId]);

  const loadSessions = async () => {
    if (!gridId) return;
    try {
      const result = await collaborationAPI.listSessions(gridId);
      setSessionList(result.sessions);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  };

  const connectSocket = useCallback((sessionId: string, user: User) => {
    const socket = io('http://localhost:3001', {
      transports: ['websocket', 'polling']
    });
    
    socket.on('connect', () => {
      socket.emit('join-session', { sessionId, user });
      setIsConnecting(false);
    });

    socket.on('joined', (data: { sessionId: string; user: User; users: User[]; annotations: Annotation[] }) => {
      setCollaborationUsers(data.users);
      setAnnotations(data.annotations);
    });

    socket.on('user-joined', (user: User) => {
      setCollaborationUsers(prev => {
        const existing = prev.find(u => u.id === user.id);
        if (existing) {
          return prev.map(u => u.id === user.id ? user : u);
        }
        return [...prev, user];
      });
      addSystemMessage(`${user.name} 加入了会话`);
    });

    socket.on('user-left', (user: User) => {
      setCollaborationUsers(prev => prev.filter(u => u.id !== user.id));
      removeRemoteCursor(user.id);
      addSystemMessage(`${user.name} 离开了会话`);
    });

    socket.on('cursor-position', (data: { userId: string; userName: string; userColor: string; x: number; y: number; point?: { x: number; y: number; z: number } }) => {
      setRemoteCursor(data.userId, {
        x: data.x,
        y: data.y,
        point: data.point,
        userName: data.userName,
        userColor: data.userColor
      });
    });

    socket.on('view-state', (data: { userId: string; viewState: ViewState }) => {
      setRemoteView(data.userId, data.viewState);
    });

    socket.on('annotation-added', (annotation: Annotation) => {
      addAnnotation(annotation);
    });

    socket.on('annotation-updated', (annotation: Annotation) => {
      useStore.setState(state => ({
        annotations: state.annotations.map(a => a.id === annotation.id ? annotation : a)
      }));
    });

    socket.on('annotation-deleted', (annotationId: string) => {
      deleteAnnotation(annotationId);
    });

    socket.on('chat-message', (msg: { userId: string; userName: string; userColor: string; text: string; timestamp: number }) => {
      setChatMessages(prev => [...prev, msg]);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from signaling server');
    });

    socketRef.current = socket;
  }, [addAnnotation, deleteAnnotation, setAnnotations, setCollaborationUsers, setRemoteCursor, setRemoteView, removeRemoteCursor]);

  const addSystemMessage = (text: string) => {
    setChatMessages(prev => [...prev, {
      userId: 'system',
      userName: '系统',
      userColor: '#888',
      text,
      timestamp: Date.now()
    }]);
  };

  const createSession = async () => {
    if (!gridId || !userName.trim()) return;
    
    setIsConnecting(true);
    
    try {
      const userId = uuidv4();
      const user: User = {
        id: userId,
        name: userName.trim(),
        avatar: '',
        color: '',
        isOnline: true,
        lastActive: Date.now()
      };
      
      const result = await collaborationAPI.createSession(gridId, user);
      setCollaborationSessionId(result.sessionId);
      setCurrentUser({ ...user, color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0') });
      
      connectSocket(result.sessionId, user);
      loadSessions();
    } catch (e) {
      console.error('Failed to create session:', e);
      setIsConnecting(false);
    }
  };

  const joinSession = async (sessionId: string) => {
    if (!userName.trim()) return;
    
    setIsConnecting(true);
    
    try {
      const userId = uuidv4();
      const user: User = {
        id: userId,
        name: userName.trim(),
        avatar: '',
        color: '',
        isOnline: true,
        lastActive: Date.now()
      };
      
      const result = await collaborationAPI.joinSession(sessionId, user);
      if (result.success) {
        setCollaborationSessionId(sessionId);
        setCurrentUser(result.user);
        connectSocket(sessionId, user);
        setShowSessionList(false);
      }
    } catch (e) {
      console.error('Failed to join session:', e);
      setIsConnecting(false);
    }
  };

  const leaveSession = () => {
    if (socketRef.current) {
      socketRef.current.emit('leave-session');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setCollaborationSessionId(null);
    setCollaborationUsers([]);
    setCurrentUser(null);
    setAnnotations([]);
    setChatMessages([]);
  };

  const sendAnnotation = (annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (socketRef.current && currentUser) {
      socketRef.current.emit('add-annotation', annotation);
    }
  };

  const handleDeleteAnnotation = (annotationId: string) => {
    if (socketRef.current) {
      socketRef.current.emit('delete-annotation', annotationId);
    }
  };

  const sendChat = () => {
    if (!chatMessage.trim() || !socketRef.current) return;
    socketRef.current.emit('chat-message', { text: chatMessage.trim() });
    setChatMessage('');
  };

  const copySessionId = () => {
    if (collaborationSessionId) {
      navigator.clipboard.writeText(collaborationSessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const toggleDrawingMode = () => {
    setIsDrawingMode(!isDrawingMode);
    setDrawingPoints([]);
  };

  const addDrawingPoint = (point: { x: number; y: number; z: number }) => {
    setDrawingPoints(prev => [...prev, point]);
  };

  const finishDrawing = () => {
    if (drawingPoints.length > 0 && currentUser) {
      const annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'> = {
        type: selectedAnnotationType,
        author: currentUser.name,
        authorId: currentUser.id,
        color: currentUser.color,
        name: `${annotationTypeNames[selectedAnnotationType]} ${annotations.length + 1}`,
        description: '',
        points: drawingPoints,
        properties: {},
        isLocked: false
      };
      sendAnnotation(annotation);
    }
    setDrawingPoints([]);
    setIsDrawingMode(false);
  };

  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <Users size={18} className="text-green-400" />
          <span className="text-sm font-medium text-white">协作标注</span>
          {collaborationSessionId && (
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          )}
        </div>
        {isOpen ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>

      {isOpen && (
        <div className="mt-2 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">显示标注</span>
            <button
              onClick={() => setShowAnnotations(!showAnnotations)}
              className={`w-10 h-5 rounded-full transition-colors ${showAnnotations ? 'bg-green-600' : 'bg-gray-600'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform ${showAnnotations ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {!collaborationSessionId ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">您的名字</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="输入您的名字..."
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500"
                />
              </div>

              {!showSessionList ? (
                <div className="flex gap-2">
                  <button
                    onClick={createSession}
                    disabled={!userName.trim() || isConnecting}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors text-sm"
                  >
                    <Plus size={16} />
                    {isConnecting ? '连接中...' : '创建会话'}
                  </button>
                  <button
                    onClick={() => setShowSessionList(true)}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-sm"
                  >
                    <LogIn size={16} />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-300">选择会话</span>
                    <button
                      onClick={() => setShowSessionList(false)}
                      className="text-xs text-gray-400 hover:text-gray-300"
                    >
                      返回
                    </button>
                  </div>
                  {sessionList.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">暂无可用会话</p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {sessionList.map(session => (
                        <button
                          key={session.sessionId}
                          onClick={() => joinSession(session.sessionId)}
                          disabled={isConnecting}
                          className="w-full p-2 bg-gray-700 hover:bg-gray-600 rounded text-left transition-colors disabled:opacity-50"
                        >
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-400 truncate">{session.sessionId.slice(0, 8)}...</span>
                            <span className="text-xs text-gray-500">{session.userCount}人在线</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {session.annotationCount}个标注
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-gray-800 rounded-lg p-2">
                <div>
                  <div className="text-xs text-gray-400">会话ID</div>
                  <div className="text-sm text-white font-mono">{collaborationSessionId.slice(0, 12)}...</div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={copySessionId}
                    className="p-2 hover:bg-gray-700 rounded transition-colors"
                    title="复制会话ID"
                  >
                    {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} className="text-gray-400" />}
                  </button>
                  <button
                    onClick={leaveSession}
                    className="p-2 hover:bg-gray-700 rounded transition-colors text-red-400"
                    title="离开会话"
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-400 mb-2">在线用户 ({collaborationUsers.length})</div>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {collaborationUsers.map(user => (
                    <div key={user.id} className="flex items-center gap-2 text-sm">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: user.color }}
                      />
                      <span className="text-white">{user.name}</span>
                      {user.id === currentUser?.id && (
                        <span className="text-xs text-gray-500">(您)</span>
                      )}
                      {user.isOnline && (
                        <span className="w-2 h-2 bg-green-500 rounded-full ml-auto" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-2">标注工具</div>
                <div className="grid grid-cols-5 gap-1 mb-2">
                  {(Object.keys(annotationTypeNames) as AnnotationType[]).map(type => (
                    <button
                      key={type}
                      onClick={() => setSelectedAnnotationType(type)}
                      className={`p-2 rounded text-center transition-colors ${
                        selectedAnnotationType === type 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                      title={annotationTypeNames[type]}
                    >
                      {annotationTypeIcons[type]}
                    </button>
                  ))}
                </div>
                <button
                  onClick={toggleDrawingMode}
                  className={`w-full py-2 rounded-lg text-sm transition-colors ${
                    isDrawingMode 
                      ? 'bg-red-600 hover:bg-red-700 text-white' 
                      : 'bg-gray-700 hover:bg-gray-600 text-white'
                  }`}
                >
                  {isDrawingMode ? (
                    <span onClick={finishDrawing}>完成绘制</span>
                  ) : (
                    <span>开始绘制 {annotationTypeNames[selectedAnnotationType]}</span>
                  )}
                </button>
                {isDrawingMode && drawingPoints.length > 0 && (
                  <p className="text-xs text-gray-400 mt-2 text-center">
                    已添加 {drawingPoints.length} 个点，点击"完成绘制"保存
                  </p>
                )}
              </div>

              {annotations.length > 0 && (
                <div className="bg-gray-800 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-2">标注列表 ({annotations.length})</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {annotations.map(annotation => (
                      <div 
                        key={annotation.id} 
                        className="flex items-center gap-2 p-2 bg-gray-700 rounded group"
                      >
                        <div 
                          className="w-3 h-3 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: annotation.color }}
                        />
                        <span className="text-sm text-white truncate flex-1">{annotation.name}</span>
                        <button
                          onClick={() => handleDeleteAnnotation(annotation.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-600 rounded text-red-400 transition-opacity"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-2">聊天室</div>
                <div className="space-y-1 max-h-32 overflow-y-auto mb-2">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className="text-xs">
                      <span style={{ color: msg.userColor }} className="font-medium">{msg.userName}: </span>
                      <span className="text-gray-300">{msg.text}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                    placeholder="发送消息..."
                    className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm placeholder-gray-500"
                  />
                  <button
                    onClick={sendChat}
                    disabled={!chatMessage.trim()}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-white text-sm transition-colors"
                  >
                    发送
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
