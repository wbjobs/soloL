import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { lintGutter, lintKeymap } from '@codemirror/lint';
import { renderAbc } from 'abcjs';
import {
  Music, Users, Save, Play, Pause, Square, Volume2, Clock,
  Home, Copy, Check, Lock, Unlock, History, Settings,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw,
  Sparkles
} from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useWebRTC } from '../hooks/useWebRTC';
import { useMIDIPlayer } from '../hooks/useMIDIPlayer';
import { useCollaborationStore } from '../store/useCollaborationStore';
import { useEditorStore } from '../store/useEditorStore';
import { DEFAULT_ABC_SCORE, generateRandomColor, validateABC, parseMeasureBoundaries } from '../utils/abcUtils';
import AIPanel from '../components/AIPanel';
import ExportMenu from '../components/ExportMenu';
import type { User, EditorChange, ScoreVersion, LockedSection, Position } from '../../shared/types';

interface EditorPageProps {
  isDemo?: boolean;
}

export default function EditorPage({ isDemo = false }: EditorPageProps) {
  const { roomId = 'demo' } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const editorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const cursorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [roomName, setRoomName] = useState(isDemo ? '演示房间' : roomId);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [playbackController, setPlaybackController] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [showAIPanel, setShowAIPanel] = useState(true);
  const playbackControllerRef = useRef<string | null>(null);
  const sendMidiPlayRef = useRef<((startNote?: number) => void) | null>(null);
  const sendMidiStopRef = useRef<(() => void) | null>(null);
  const sendMidiSeekRef = useRef<((noteIndex: number) => void) | null>(null);
  const sendCursorRef = useRef<((position: Position, selection?: { anchor: Position; head: Position }) => void) | null>(null);
  const sendContentChangeRef = useRef<((changes: EditorChange[], version: number) => void) | null>(null);
  const usersRef = useRef<User[]>([]);

  const {
    currentUser, users, content, version, lockedSections, versions,
    connectionStatus, setContent, addUser, removeUser, updateUserCursor,
    lockSection, unlockSection, addVersion, setConnectionStatus,
    setCurrentUser, setUsers, setVersion, setLockedSections, setVersions
  } = useCollaborationStore();

  const {
    cursorPosition, setCursor, setSelection, isPlaying, setPlaying,
    playPosition, setPlayPosition, playbackSpeed, setPlaybackSpeed
  } = useEditorStore();

  const userId = localStorage.getItem('userId') || 'user-demo';
  const userName = localStorage.getItem('userName') || '用户';

  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws';

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    playbackControllerRef.current = playbackController;
  }, [playbackController]);

  const isPlaybackController = playbackController === userId || playbackController === null;

  const acquirePlaybackControl = useCallback(() => {
    if (playbackControllerRef.current === null || playbackControllerRef.current === userId) {
      setPlaybackController(userId);
      playbackControllerRef.current = userId;
      return true;
    }
    return false;
  }, [userId]);

  const releasePlaybackControl = useCallback(() => {
    if (playbackControllerRef.current === userId) {
      setPlaybackController(null);
      playbackControllerRef.current = null;
    }
  }, [userId]);

  const onMIDIComplete = useCallback(() => {
    setPlaying(false);
    releasePlaybackControl();
  }, [setPlaying, releasePlaybackControl]);

  const { playbackState, notes, play, pause, stop, seek, setPlaybackSpeed: setMIDISpeed, loadABC } = useMIDIPlayer({
    abcContent: content || DEFAULT_ABC_SCORE,
    onNoteStart: (note, index) => {
      if (note.startLine !== undefined && note.startCh !== undefined) {
        setPlayPosition(index);
      }
    },
    onComplete: onMIDIComplete
  });

  const handlePlay = useCallback(() => {
    if (acquirePlaybackControl()) {
      play(playPosition);
      setPlaying(true);
      sendMidiPlayRef.current?.(playPosition);
    } else {
      const controller = usersRef.current.find(u => u.id === playbackControllerRef.current);
      console.log(`${controller?.name || '其他用户'} 正在控制播放`);
    }
  }, [acquirePlaybackControl, play, setPlaying, playPosition]);

  const handlePause = useCallback(() => {
    if (playbackControllerRef.current === userId || playbackControllerRef.current === null) {
      pause();
      setPlaying(false);
      sendMidiStopRef.current?.();
      releasePlaybackControl();
    }
  }, [userId, pause, setPlaying, releasePlaybackControl]);

  const handleStop = useCallback(() => {
    if (playbackControllerRef.current === userId || playbackControllerRef.current === null) {
      stop();
      setPlaying(false);
      setPlayPosition(0);
      sendMidiStopRef.current?.();
      releasePlaybackControl();
    }
  }, [userId, stop, setPlaying, setPlayPosition, releasePlaybackControl]);

  const handleSeek = useCallback((noteIndex: number) => {
    if (playbackControllerRef.current === userId || playbackControllerRef.current === null) {
      seek(noteIndex);
      setPlayPosition(noteIndex);
      sendMidiSeekRef.current?.(noteIndex);
    }
  }, [userId, seek, setPlayPosition]);

  const handleCursorChange = useCallback((position: Position, selection?: { anchor: Position; head: Position }) => {
    setCursor(position);
    setSelectedLine(position.line);
    if (selection) {
      setSelection(selection);
    }

    if (cursorTimeoutRef.current) {
      clearTimeout(cursorTimeoutRef.current);
    }

    cursorTimeoutRef.current = setTimeout(() => {
      if (!isDemo && currentUser) {
        sendCursorRef.current?.(position, selection);
      }
    }, 50);
  }, [isDemo, currentUser, setCursor, setSelection]);

  const handleInsertChord = useCallback((newContent: string) => {
    if (editorViewRef.current) {
      const tr = editorViewRef.current.state.update({
        changes: {
          from: 0, to: editorViewRef.current.state.doc.length,
          insert: newContent
        }
      });
      editorViewRef.current.dispatch(tr);
    }
    setContent(newContent);
    loadABC(newContent);
  }, [setContent, loadABC]);

  const handleContentChange = useCallback((changes: EditorChange[]) => {
    if (!editorViewRef.current) return;

    const newContent = editorViewRef.current.state.doc.toString();
    setContent(newContent);

    if (!isDemo) {
      sendContentChangeRef.current?.(changes, version + 1);
      setVersion(version + 1);
    }

    loadABC(newContent);
  }, [isDemo, version, setContent, setVersion, loadABC]);

  const {
    sendJoinRoom, sendOffer, sendAnswer, sendIceCandidate
  } = useWebSocket({
    url: wsUrl,
    roomId,
    userId,
    autoReconnect: !isDemo,
    onConnected: () => {
      if (!isDemo) {
        setConnectionStatus('connected');
        sendJoinRoom(userName);
      }
    },
    onDisconnected: () => {
      if (!isDemo) {
        setConnectionStatus('disconnected');
      }
    },
    onError: () => {
      if (!isDemo) {
        setConnectionStatus('error');
      }
    },
    onRoomState: (message) => {
      setContent(message.currentScore);
      setVersion(message.currentVersion);
      setUsers(message.users);
      setLockedSections(message.lockedSections);
      loadABC(message.currentScore);

      const existingUser = message.users.find(u => u.id === userId);
      if (existingUser) {
        setCurrentUser(existingUser);
      } else {
        const newUser: User = {
          id: userId,
          name: userName,
          color: generateRandomColor(),
          connectedAt: Date.now()
        };
        setCurrentUser(newUser);
      }
    },
    onUserJoined: (message) => {
      addUser(message.user);
      if (!isDemo && currentUser && message.user.id !== userId) {
        connectToPeer(message.user.id, true);
      }
    },
    onUserLeft: (message) => {
      removeUser(message.userId);
      if (playbackControllerRef.current === message.userId) {
        setPlaybackController(null);
      }
      if (!isDemo) {
        disconnectFromPeer(message.userId);
      }
    },
    onOffer: (message) => {
      if (!isDemo) {
        handleOffer(message.userId, message.sdp);
      }
    },
    onAnswer: (message) => {
      if (!isDemo) {
        handleAnswer(message.userId, message.sdp);
      }
    },
    onIceCandidate: (message) => {
      if (!isDemo) {
        handleIceCandidate(message.userId, message.candidate);
      }
    },
    onLocksReleased: (message) => {
      if (!isDemo) {
        console.log(`用户 ${message.userId} 的锁已释放:`, message.releasedSectionIds);
        message.releasedSectionIds.forEach(sectionId => {
          unlockSection(sectionId);
        });
      }
    }
  });

  const {
    connectToPeer, disconnectFromPeer, handleOffer, handleAnswer, handleIceCandidate,
    sendCursor, sendContentChange, sendSectionLock, sendSaveVersion,
    sendMidiPlay, sendMidiStop, sendMidiSeek
  } = useWebRTC({
    userId,
    roomId,
    onPeerConnected: (peerId) => {
      console.log('Connected to peer:', peerId);
    },
    onPeerDisconnected: (peerId) => {
      console.log('Disconnected from peer:', peerId);
    },
    onCursor: (peerId, position, selection) => {
      updateUserCursor(peerId, position, selection);
    },
    onContentChange: (peerId, changes, newVersion) => {
      if (editorViewRef.current) {
        const tr = editorViewRef.current.state.update({
          changes: changes.map(c => ({
            from: c.from.line * 1000 + c.from.ch,
            to: c.to.line * 1000 + c.to.ch,
            insert: c.text.join('\n')
          }))
        });
        editorViewRef.current.dispatch(tr);
      }
      setVersion(newVersion);
    },
    onSectionLock: (peerId, sectionId, locked, range) => {
      if (locked) {
        const user = users.find(u => u.id === peerId);
        const section: LockedSection = {
          id: sectionId,
          roomId,
          startLine: range.start,
          endLine: range.end,
          lockedBy: peerId,
          lockedByUserName: user?.name || '未知用户',
          lockedAt: Date.now(),
          expiresAt: Date.now() + 30000
        };
        lockSection(section);
      } else {
        unlockSection(sectionId);
      }
    },
    onSaveVersion: (peerId, content, message) => {
      const user = users.find(u => u.id === peerId);
      const newVersion: ScoreVersion = {
        id: `version-${Date.now()}`,
        roomId,
        version: versions.length + 1,
        content,
        message,
        userId: peerId,
        userName: user?.name || '未知用户',
        createdAt: Date.now()
      };
      addVersion(newVersion);
    },
    onMidiPlay: (peerId, startNote) => {
      setPlaybackController(peerId);
      play(startNote);
      setPlaying(true);
    },
    onMidiStop: () => {
      stop();
      setPlaying(false);
      setPlaybackController(null);
    },
    onMidiSeek: (peerId, noteIndex) => {
      seek(noteIndex);
      setPlayPosition(noteIndex);
    },
    onIceCandidate: (peerId, candidate) => {
      sendIceCandidate(peerId, candidate);
    },
    onOffer: (peerId, sdp) => {
      sendOffer(peerId, sdp);
    },
    onAnswer: (peerId, sdp) => {
      sendAnswer(peerId, sdp);
    }
  });

  useEffect(() => {
    sendMidiPlayRef.current = sendMidiPlay;
    sendMidiStopRef.current = sendMidiStop;
    sendMidiSeekRef.current = sendMidiSeek;
    sendCursorRef.current = sendCursor;
    sendContentChangeRef.current = sendContentChange;
  }, [sendMidiPlay, sendMidiStop, sendMidiSeek, sendCursor, sendContentChange]);

  useEffect(() => {
    if (isDemo) {
      setConnectionStatus('connected');
      const demoUser: User = {
        id: userId,
        name: userName,
        color: generateRandomColor(),
        connectedAt: Date.now()
      };
      setCurrentUser(demoUser);
      setUsers([demoUser]);
      setContent(DEFAULT_ABC_SCORE);
      setVersion(1);
      loadABC(DEFAULT_ABC_SCORE);

      const mockUsers: User[] = [
        { id: 'mock-1', name: '小明', color: '#ef4444', connectedAt: Date.now() - 60000, cursor: { line: 3, ch: 5 } },
        { id: 'mock-2', name: '小红', color: '#3b82f6', connectedAt: Date.now() - 120000, cursor: { line: 5, ch: 10 } }
      ];
      mockUsers.forEach(u => addUser(u));

      const mockVersions: ScoreVersion[] = [
        { id: 'v1', roomId: 'demo', version: 1, content: DEFAULT_ABC_SCORE, message: '初始版本', userId: 'mock-1', userName: '小明', createdAt: Date.now() - 300000 },
        { id: 'v2', roomId: 'demo', version: 2, content: DEFAULT_ABC_SCORE, message: '调整节奏', userId: 'mock-2', userName: '小红', createdAt: Date.now() - 120000 }
      ];
      setVersions(mockVersions);
    }
  }, [isDemo, userId, userName, setCurrentUser, setUsers, setContent, setVersion, setConnectionStatus, loadABC, addUser, setVersions]);

  useEffect(() => {
    if (!editorRef.current) return;

    const lintExtension = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const doc = update.state.doc.toString();
        const { errors } = validateABC(doc);
        
        if (errors.length > 0) {
          console.log('ABC Validation errors:', errors);
        }
      }
    });

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet) {
        const mainSelection = update.state.selection.main;
        const head = update.state.doc.lineAt(mainSelection.head);
        const anchor = update.state.doc.lineAt(mainSelection.anchor);

        const position: Position = {
          line: head.number - 1,
          ch: mainSelection.head - head.from
        };

        const selection = mainSelection.empty ? undefined : {
          anchor: { line: anchor.number - 1, ch: mainSelection.anchor - anchor.from },
          head: { line: head.number - 1, ch: mainSelection.head - head.from }
        };

        handleCursorChange(position, selection);
      }

      if (update.docChanged) {
        const changes: EditorChange[] = update.changes.toJSON().map((c: unknown) => c as EditorChange);
        handleContentChange(changes);

        const doc = update.state.doc.toString();
        const boundaries = parseMeasureBoundaries(doc);
        
        if (currentUser && !isDemo) {
          const mainSelection = update.state.selection.main;
          const line = update.state.doc.lineAt(mainSelection.head).number - 1;
          
          boundaries.forEach(boundary => {
            if (line >= boundary.startLine && line <= boundary.endLine) {
              const isLocked = lockedSections.some(
                s => s.id === boundary.sectionId && s.lockedBy !== userId
              );
              
              if (!isLocked) {
                sendSectionLock(boundary.sectionId, true, {
                  start: boundary.startLine,
                  end: boundary.endLine
                });
              }
            }
          });
        }
      }
    });

    const state = EditorState.create({
      doc: content || DEFAULT_ABC_SCORE,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        bracketMatching(),
        autocompletion(),
        lintGutter(),
        syntaxHighlighting(defaultHighlightStyle),
        keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap, ...lintKeymap]),
        updateListener,
        lintExtension,
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '14px',
            backgroundColor: '#0f172a',
            color: '#e2e8f0'
          },
          '.cm-content': {
            padding: '16px',
            fontFamily: '"JetBrains Mono", monospace',
            lineHeight: '1.6'
          },
          '.cm-gutters': {
            backgroundColor: '#1e293b',
            color: '#64748b',
            borderRight: '1px solid #334155'
          },
          '.cm-activeLineGutter': {
            backgroundColor: '#334155',
            color: '#fbbf24'
          },
          '.cm-activeLine': {
            backgroundColor: '#1e3a5f20'
          },
          '.cm-selectionBackground': {
            backgroundColor: '#f59e0b40'
          },
          '.cm-cursor': {
            borderLeftColor: '#f59e0b',
            borderLeftWidth: '2px'
          }
        }, { dark: true })
      ]
    });

    const view = new EditorView({
      state,
      parent: editorRef.current
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
    };
  }, []);

  useEffect(() => {
    if (!previewRef.current || !content) return;

    try {
      previewRef.current.innerHTML = '';
      renderAbc(previewRef.current, content, {
        responsive: 'resize',
        staffwidth: 720 * zoomLevel,
        paddingtop: 30,
        paddingbottom: 30,
        paddingleft: 50,
        paddingright: 50,
        add_classes: true,
      } as Parameters<typeof renderAbc>[2]);
    } catch (error) {
      console.error('Failed to render ABC:', error);
    }
  }, [content, zoomLevel]);

  const handleSaveVersion = async () => {
    setIsSaving(true);
    const message = saveMessage || `版本 ${versions.length + 1}`;

    try {
      if (!isDemo) {
        sendSaveVersion(content, message);
      }

      const newVersion: ScoreVersion = {
        id: `version-${Date.now()}`,
        roomId,
        version: versions.length + 1,
        content,
        message,
        userId,
        userName: currentUser?.name || userName,
        createdAt: Date.now()
      };
      addVersion(newVersion);
      setSaveMessage('');
    } catch (error) {
      console.error('Failed to save version:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      handlePause();
    } else {
      handlePlay();
    }
  };

  const handleStopButton = () => {
    handleStop();
  };

  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const noteIndex = parseInt(e.target.value, 10);
    handleSeek(noteIndex);
  };

  const controllerUser = users.find(u => u.id === playbackController);
  const controllerDisplay = controllerUser 
    ? `${controllerUser.name} 正在控制播放`
    : playbackController 
      ? '其他用户正在控制播放'
      : '';

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const speed = parseFloat(e.target.value);
    setPlaybackSpeed(speed);
    setMIDISpeed(speed);
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-emerald-400';
      case 'connecting': return 'text-amber-400';
      case 'error': return 'text-rose-400';
      default: return 'text-slate-400';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return '已连接';
      case 'connecting': return '连接中...';
      case 'error': return '连接错误';
      default: return '未连接';
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors group"
          >
            <Home className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
          </button>
          <div className="w-px h-6 bg-slate-700" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-amber-500 rounded-xl flex items-center justify-center">
              <Music className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold text-white">{roomName}</h1>
              <div className="flex items-center gap-2 text-xs">
                <span className={`w-2 h-2 rounded-full ${getConnectionStatusColor()} animate-pulse`} />
                <span className="text-slate-400 font-mono">{getConnectionStatusText()}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-lg">
            <Users className="w-4 h-4 text-slate-400" />
            <span className="font-mono text-sm text-slate-300">{users.length} 在线</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-lg">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="font-mono text-sm text-slate-300">v{version}</span>
          </div>
          <button
            onClick={() => setShowVersions(!showVersions)}
            className={`p-2 rounded-lg transition-colors ${showVersions ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <History className="w-5 h-5" />
          </button>
          <button
            onClick={handleCopyRoomId}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors group"
          >
            {copied ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
            )}
            <span className="font-mono text-sm text-slate-300">{roomId.slice(0, 8)}...</span>
          </button>
          <div className="w-px h-6 bg-slate-700" />
          <button
            onClick={handleSaveVersion}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-white font-display font-medium rounded-lg shadow-lg shadow-amber-500/20 transition-all hover:shadow-amber-500/40 active:scale-[0.98]"
          >
            <Save className="w-4 h-4" />
            {isSaving ? '保存中...' : '保存版本'}
          </button>
          <ExportMenu abcContent={content || DEFAULT_ABC_SCORE} />
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside
          className={`bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col ${
            leftPanelCollapsed ? 'w-0 overflow-hidden' : 'w-64'
          }`}
        >
          <div className="p-4 border-b border-slate-800">
            <h2 className="font-display text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              协作者
            </h2>
            <div className="space-y-2">
              {users.map((user) => (
                <div
                  key={user.id}
                  className={`flex items-center gap-3 p-2 rounded-lg ${
                    user.id === userId ? 'bg-indigo-500/20 border border-indigo-500/30' : 'bg-slate-800/50 hover:bg-slate-800'
                  } transition-colors group`}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white font-mono text-sm font-medium"
                    style={{ backgroundColor: user.color }}
                  >
                    {user.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-white truncate">
                      {user.name}
                      {user.id === userId && (
                        <span className="ml-1 text-xs text-indigo-400">(你)</span>
                      )}
                    </p>
                    {user.cursor && (
                      <p className="font-mono text-xs text-slate-400">
                        行 {user.cursor.line + 1}, 列 {user.cursor.ch + 1}
                      </p>
                    )}
                  </div>
                  {user.cursor && (
                    <div
                      className="w-3 h-3 rounded-full animate-pulse"
                      style={{ backgroundColor: user.color }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 border-b border-slate-800">
            <h2 className="font-display text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              锁定状态
            </h2>
            {lockedSections.length > 0 ? (
              <div className="space-y-2">
                {lockedSections.map((section) => (
                  <div
                    key={section.id}
                    className="flex items-center gap-2 p-2 bg-rose-500/10 border border-rose-500/30 rounded-lg"
                  >
                    <Lock className="w-4 h-4 text-rose-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-slate-300 truncate">
                        行 {section.startLine + 1} - {section.endLine + 1}
                      </p>
                      <p className="font-mono text-xs text-slate-500 truncate">
                        {section.lockedByUserName}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2 text-slate-500">
                <Unlock className="w-4 h-4" />
                <span className="font-mono text-xs">暂无锁定区域</span>
              </div>
            )}
          </div>

          {showVersions && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-sm font-semibold text-slate-300 uppercase tracking-wider">
                  版本历史
                </h2>
                <button
                  onClick={() => setShowVersions(false)}
                  className="p-1 hover:bg-slate-800 rounded"
                >
                  <ChevronLeft className="w-4 h-4 text-slate-400" />
                </button>
              </div>
              <div className="space-y-3">
                {versions.map((v, index) => (
                  <div
                    key={v.id}
                    className={`p-3 rounded-lg border ${
                      index === 0
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
                    } transition-colors`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-sm font-medium text-white">
                        v{v.version}
                      </span>
                      {index === 0 && (
                        <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded">
                          当前
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-slate-300 mb-1">{v.message}</p>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{v.userName}</span>
                      <span>{formatTime(v.createdAt)}</span>
                    </div>
                    {index !== 0 && (
                      <button className="mt-2 w-full py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs font-mono text-slate-300 transition-colors flex items-center justify-center gap-1">
                        <RotateCcw className="w-3 h-3" />
                        回滚到此版本
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        <button
          onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
          className="w-6 bg-slate-900 border-r border-slate-800 flex items-center justify-center hover:bg-slate-800 transition-colors group shrink-0"
        >
          {leftPanelCollapsed ? (
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
          ) : (
            <ChevronLeft className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
          )}
        </button>

        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
              <div className="h-10 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4">
                <span className="font-mono text-xs text-slate-400">ABC 编辑器</span>
                <div className="flex items-center gap-2">
                  {validateABC(content).errors.length > 0 && (
                    <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 text-xs rounded font-mono">
                      {validateABC(content).errors.length} 个警告
                    </span>
                  )}
                  <span className="font-mono text-xs text-slate-500">
                    Ln {cursorPosition.line + 1}, Col {cursorPosition.ch + 1}
                  </span>
                </div>
              </div>
              <div ref={editorRef} className="flex-1 overflow-hidden" />
            </div>

            <div className="w-px bg-slate-800" />

            <div className="flex-1 flex flex-col bg-slate-50 min-w-0">
              <div className="h-10 bg-slate-100 border-b border-slate-200 flex items-center justify-between px-4">
                <span className="font-mono text-xs text-slate-600">乐谱预览</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAIPanel(!showAIPanel)}
                    className={`p-1 rounded transition-colors flex items-center gap-1 ${showAIPanel ? 'bg-purple-100 text-purple-600' : 'hover:bg-slate-200 text-slate-600'}`}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span className="text-xs font-mono">AI配器</span>
                  </button>
                  <button
                    onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.1))}
                    className="p-1 hover:bg-slate-200 rounded transition-colors"
                  >
                    <ZoomOut className="w-4 h-4 text-slate-600" />
                  </button>
                  <span className="font-mono text-xs text-slate-500 w-12 text-center">
                    {Math.round(zoomLevel * 100)}%
                  </span>
                  <button
                    onClick={() => setZoomLevel(Math.min(2, zoomLevel + 0.1))}
                    className="p-1 hover:bg-slate-200 rounded transition-colors"
                  >
                    <ZoomIn className="w-4 h-4 text-slate-600" />
                  </button>
                </div>
              </div>
              <div className="flex-1 flex min-h-0">
                <div
                  ref={previewRef}
                  className={`flex-1 overflow-auto p-6 ${showAIPanel ? '' : ''}`}
                  style={{ color: '#1e293b' }}
                />
                {showAIPanel && (
                  <div className="w-80 border-l border-slate-200 bg-slate-800 overflow-y-auto">
                    <AIPanel
                      abcContent={content || DEFAULT_ABC_SCORE}
                      selectedLine={selectedLine}
                      onInsertChord={handleInsertChord}
                      disabled={lockedSections.some(
                        s => selectedLine !== null && 
                        selectedLine >= s.startLine && 
                        selectedLine <= s.endLine && 
                        s.lockedBy !== userId
                      )}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="h-20 bg-slate-900 border-t border-slate-800 flex items-center px-6 gap-6 shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={handleStopButton}
                className={`p-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors group ${!isPlaybackController ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!isPlaybackController}
              >
                <Square className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
              </button>
              <button
                onClick={handlePlayPause}
                className={`p-3 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 rounded-xl shadow-lg shadow-indigo-500/30 transition-all hover:shadow-indigo-500/50 active:scale-[0.95] ${!isPlaybackController ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!isPlaybackController}
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6 text-white" />
                ) : (
                  <Play className="w-6 h-6 text-white ml-0.5" />
                )}
              </button>
            </div>

            <div className="flex-1 flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                <span>{formatTime(playbackState.currentTime * 1000).split(' ')[1]}</span>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(0, notes.length - 1)}
                value={playPosition}
                onChange={handleSeekInput}
                className={`flex-1 h-2 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500 ${!isPlaybackController ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!isPlaybackController}
              />
              <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                <span>{formatTime(playbackState.duration * 1000).split(' ')[1]}</span>
              </div>
              {controllerDisplay && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/20 rounded-full">
                  <div 
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: controllerUser?.color || '#f59e0b' }}
                  />
                  <span className="text-xs text-amber-400 font-medium">{controllerDisplay}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-slate-400" />
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0.25"
                    max="4"
                    step="0.25"
                    value={playbackSpeed}
                    onChange={handleSpeedChange}
                    className="w-24 h-2 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
                  />
                  <span className="font-mono text-xs text-slate-400 w-10">
                    {playbackSpeed.toFixed(2)}x
                  </span>
                </div>
              </div>
              <div className="w-px h-8 bg-slate-700" />
              <button
                onClick={() => {}}
                className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Settings className="w-5 h-5 text-slate-400" />
              </button>
            </div>
          </div>
        </main>
      </div>

      {saveMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 bg-emerald-500/90 text-white rounded-lg shadow-lg animate-fade-in font-mono text-sm">
          {saveMessage}
        </div>
      )}
    </div>
  );
}
