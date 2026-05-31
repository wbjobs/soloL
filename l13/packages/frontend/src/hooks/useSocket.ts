import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useRoomStore } from '../stores/room-store';
import { useProofreadStore } from '../stores/proofread-store';
import { otClient } from '../ot/ot-client';
import type { CursorPosition, OTOperation, Participant, WebRTCSignalData } from '../types';

export function useSocket(roomId: string | undefined, userId: string, userName: string) {
  const socketRef = useRef<Socket | null>(null);
  const {
    setRoomId,
    addParticipant,
    removeParticipant,
    updateParticipantOnline,
    setCursor,
    removeCursor,
    setConnected,
    setParticipants,
  } = useRoomStore();
  const setBlocks = useProofreadStore((s) => s.setBlocks);

  const connect = useCallback(() => {
    if (!roomId) return;

    const socket = io('/', {
      path: '/socket.io',
      query: { roomId, userId, userName },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setRoomId(roomId);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('room_state', (data: { blocks: any[]; participants: Participant[]; revision: number }) => {
      setBlocks(data.blocks);
      setParticipants(data.participants);
      otClient.setInitialState(data.blocks, data.revision);
    });

    socket.on('participant_join', (participant: Participant) => {
      addParticipant(participant);
    });

    socket.on('participant_leave', (leftUserId: string) => {
      removeParticipant(leftUserId);
    });

    socket.on('participant_online', (data: { userId: string; isOnline: boolean }) => {
      updateParticipantOnline(data.userId, data.isOnline);
    });

    socket.on('cursor', (cursor: CursorPosition) => {
      if (cursor.userId !== userId) {
        setCursor(cursor.userId, cursor);
      }
    });

    socket.on('cursor_leave', (leftUserId: string) => {
      removeCursor(leftUserId);
    });

    socket.on('edit', (op: OTOperation) => {
      if (op.userId !== userId) {
        otClient.receiveRemoteOp(op);
      }
    });

    socket.on('ack', (revision: number) => {
      otClient.handleAck(revision);
    });

    socket.on('webrtc_signal', (data: WebRTCSignalData) => {
      window.dispatchEvent(
        new CustomEvent('webrtc_signal', { detail: data }),
      );
    });

    otClient.connect(socket);
  }, [roomId, userId, userName, setConnected, setRoomId, setBlocks, setParticipants, addParticipant, removeParticipant, updateParticipantOnline, setCursor, removeCursor]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    otClient.disconnect();
    setConnected(false);
    setRoomId(null);
  }, [setConnected, setRoomId]);

  const sendCursor = useCallback(
    (cursor: Omit<CursorPosition, 'userId' | 'userName' | 'userColor'>) => {
      if (socketRef.current) {
        socketRef.current.emit('cursor', cursor);
      }
    },
    [],
  );

  const sendEdit = useCallback((op: OTOperation) => {
    if (socketRef.current) {
      socketRef.current.emit('edit', op);
    }
  }, []);

  const sendWebRTCSignal = useCallback((data: WebRTCSignalData) => {
    if (socketRef.current) {
      socketRef.current.emit('webrtc_signal', data);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    socket: socketRef.current,
    sendCursor,
    sendEdit,
    sendWebRTCSignal,
    disconnect,
  };
}
