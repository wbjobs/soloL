import type { User, RoomState, LockedSection } from '../../shared/types.js';
import RoomRepository from '../db/repositories/RoomRepository.js';
import { v4 as uuidv4 } from 'uuid';
import { HEARTBEAT_TIMEOUT } from '../../shared/constants.js';

const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8B500', '#00CED1', '#FF7F50', '#9370DB', '#3CB371',
];

interface ActiveRoom {
  state: RoomState;
  userColors: Map<string, string>;
  lastActivity: number;
  lastHeartbeat: Map<string, number>;
}

type StateChangeListener = (roomId: string, state: RoomState) => void;
type LocksReleasedListener = (roomId: string, userId: string, releasedSectionIds: string[]) => void;

export class RoomManager {
  private rooms: Map<string, ActiveRoom> = new Map();
  private listeners: Set<StateChangeListener> = new Set();
  private locksReleasedListeners: Set<LocksReleasedListener> = new Set();
  private cleanupInterval: NodeJS.Timeout;
  private lockCleanupInterval: NodeJS.Timeout;
  private heartbeatCheckInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupInactiveRooms(), 60000);
    this.lockCleanupInterval = setInterval(() => this.cleanupExpiredLocks(), 1000);
    this.heartbeatCheckInterval = setInterval(() => this.checkHeartbeatTimeouts(), 5000);
  }

  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onLocksReleased(listener: LocksReleasedListener): () => void {
    this.locksReleasedListeners.add(listener);
    return () => this.locksReleasedListeners.delete(listener);
  }

  private notify(roomId: string, state: RoomState): void {
    this.listeners.forEach(listener => listener(roomId, state));
  }

  private notifyLocksReleased(roomId: string, userId: string, releasedSectionIds: string[]): void {
    this.locksReleasedListeners.forEach(listener => listener(roomId, userId, releasedSectionIds));
  }

  async getOrCreateRoom(roomId: string, roomName?: string): Promise<RoomState> {
    const existing = this.rooms.get(roomId);
    if (existing) {
      existing.lastActivity = Date.now();
      return { ...existing.state };
    }

    let room = await RoomRepository.findById(roomId);
    if (!room) {
      room = await RoomRepository.create(roomName || 'New Room', '');
    }

    const activeRoom: ActiveRoom = {
      state: room,
      userColors: new Map(),
      lastActivity: Date.now(),
      lastHeartbeat: new Map(),
    };

    this.rooms.set(roomId, activeRoom);
    return { ...room };
  }

  async getRoom(roomId: string): Promise<RoomState | null> {
    const existing = this.rooms.get(roomId);
    if (existing) {
      return { ...existing.state };
    }

    const room = await RoomRepository.findById(roomId);
    if (!room) return null;

    this.rooms.set(roomId, {
      state: room,
      userColors: new Map(),
      lastActivity: Date.now(),
      lastHeartbeat: new Map(),
    });

    return { ...room };
  }

  async addUser(roomId: string, userId: string, userName: string): Promise<User> {
    const activeRoom = this.rooms.get(roomId);
    if (!activeRoom) {
      await this.getOrCreateRoom(roomId);
      return this.addUser(roomId, userId, userName);
    }

    const existingUser = activeRoom.state.users.find(u => u.id === userId);
    if (existingUser) {
      activeRoom.lastActivity = Date.now();
      activeRoom.lastHeartbeat.set(userId, Date.now());
      this.notify(roomId, { ...activeRoom.state });
      return { ...existingUser };
    }

    let color = activeRoom.userColors.get(userId);
    if (!color) {
      const usedColors = activeRoom.state.users.map(u => u.color);
      const availableColors = USER_COLORS.filter(c => !usedColors.includes(c));
      color = availableColors.length > 0
        ? availableColors[Math.floor(Math.random() * availableColors.length)]
        : USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
      activeRoom.userColors.set(userId, color);
    }

    const user: User = {
      id: userId,
      name: userName,
      color,
      connectedAt: Date.now(),
    };

    activeRoom.state.users.push(user);
    activeRoom.lastActivity = Date.now();
    activeRoom.lastHeartbeat.set(userId, Date.now());

    this.notify(roomId, { ...activeRoom.state });

    return { ...user };
  }

  removeUser(roomId: string, userId: string): User | null {
    const activeRoom = this.rooms.get(roomId);
    if (!activeRoom) return null;

    const userIndex = activeRoom.state.users.findIndex(u => u.id === userId);
    if (userIndex === -1) return null;

    const [removedUser] = activeRoom.state.users.splice(userIndex, 1);
    activeRoom.lastActivity = Date.now();
    activeRoom.lastHeartbeat.delete(userId);

    const releasedSections = activeRoom.state.lockedSections.filter(
      section => section.lockedBy === userId
    );
    const releasedSectionIds = releasedSections.map(s => s.id);

    activeRoom.state.lockedSections = activeRoom.state.lockedSections.filter(
      section => section.lockedBy !== userId
    );

    this.notify(roomId, { ...activeRoom.state });

    if (releasedSectionIds.length > 0) {
      this.notifyLocksReleased(roomId, userId, releasedSectionIds);
    }

    return { ...removedUser };
  }

  heartbeat(roomId: string, userId: string): boolean {
    const activeRoom = this.rooms.get(roomId);
    if (!activeRoom) return false;

    const user = activeRoom.state.users.find(u => u.id === userId);
    if (!user) return false;

    activeRoom.lastHeartbeat.set(userId, Date.now());
    return true;
  }

  updateUserCursor(
    roomId: string,
    userId: string,
    cursor: { line: number; ch: number },
    selection?: { anchor: { line: number; ch: number }; head: { line: number; ch: number } }
  ): boolean {
    const activeRoom = this.rooms.get(roomId);
    if (!activeRoom) return false;

    const user = activeRoom.state.users.find(u => u.id === userId);
    if (!user) return false;

    user.cursor = cursor;
    user.selection = selection;
    activeRoom.lastActivity = Date.now();

    return true;
  }

  updateContent(roomId: string, content: string, version: number): boolean {
    const activeRoom = this.rooms.get(roomId);
    if (!activeRoom) return false;

    activeRoom.state.currentContent = content;
    activeRoom.state.currentVersion = version;
    activeRoom.lastActivity = Date.now();

    this.notify(roomId, { ...activeRoom.state });

    return true;
  }

  async lockSection(
    roomId: string,
    sectionId: string | undefined,
    startLine: number,
    endLine: number,
    userId: string,
    userName: string
  ): Promise<LockedSection | null> {
    const activeRoom = this.rooms.get(roomId);
    if (!activeRoom) return null;

    const user = activeRoom.state.users.find(u => u.id === userId);
    if (!user) return null;

    const actualSectionId = sectionId || uuidv4();

    const existing = activeRoom.state.lockedSections.find(s => s.id === actualSectionId);
    if (existing && existing.lockedBy !== userId) {
      return null;
    }

    const lockedSection = await RoomRepository.lockSection(
      roomId,
      actualSectionId,
      startLine,
      endLine,
      userId,
      userName
    );

    if (lockedSection) {
      const index = activeRoom.state.lockedSections.findIndex(s => s.id === actualSectionId);
      if (index >= 0) {
        activeRoom.state.lockedSections[index] = lockedSection;
      } else {
        activeRoom.state.lockedSections.push(lockedSection);
      }
      activeRoom.lastActivity = Date.now();
      this.notify(roomId, { ...activeRoom.state });
    }

    return lockedSection;
  }

  async unlockSection(roomId: string, sectionId: string, userId: string): Promise<boolean> {
    const activeRoom = this.rooms.get(roomId);
    if (!activeRoom) return false;

    const section = activeRoom.state.lockedSections.find(s => s.id === sectionId);
    if (!section || section.lockedBy !== userId) return false;

    const success = await RoomRepository.unlockSection(roomId, sectionId);
    if (success) {
      activeRoom.state.lockedSections = activeRoom.state.lockedSections.filter(
        s => s.id !== sectionId
      );
      activeRoom.lastActivity = Date.now();
      this.notify(roomId, { ...activeRoom.state });
    }

    return success;
  }

  async renewSectionLock(roomId: string, sectionId: string, userId: string): Promise<boolean> {
    const activeRoom = this.rooms.get(roomId);
    if (!activeRoom) return false;

    const section = activeRoom.state.lockedSections.find(s => s.id === sectionId);
    if (!section || section.lockedBy !== userId) return false;

    const renewed = await RoomRepository.renewSectionLock(roomId, sectionId, userId);
    if (renewed) {
      section.expiresAt = Date.now() + 3000;
      activeRoom.lastActivity = Date.now();
    }

    return renewed;
  }

  private async cleanupExpiredLocks(): Promise<void> {
    const now = Date.now();
    for (const [roomId, activeRoom] of this.rooms) {
      const expiredCount = activeRoom.state.lockedSections.filter(
        s => s.expiresAt < now
      ).length;

      if (expiredCount > 0) {
        activeRoom.state.lockedSections = activeRoom.state.lockedSections.filter(
          s => s.expiresAt >= now
        );
        this.notify(roomId, { ...activeRoom.state });
      }
    }

    try {
      await RoomRepository.cleanupExpiredLocks();
    } catch (error) {
      console.warn('Failed to cleanup expired locks in database:', error instanceof Error ? error.message : error);
    }
  }

  private checkHeartbeatTimeouts(): void {
    const now = Date.now();
    for (const [roomId, activeRoom] of this.rooms) {
      const expiredUserIds: string[] = [];

      for (const [userId, lastBeat] of activeRoom.lastHeartbeat) {
        if (now - lastBeat > HEARTBEAT_TIMEOUT) {
          expiredUserIds.push(userId);
        }
      }

      for (const userId of expiredUserIds) {
        const userIndex = activeRoom.state.users.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
          activeRoom.state.users.splice(userIndex, 1);
        }
        activeRoom.lastHeartbeat.delete(userId);

        const releasedSections = activeRoom.state.lockedSections.filter(
          section => section.lockedBy === userId
        );
        const releasedSectionIds = releasedSections.map(s => s.id);

        if (releasedSectionIds.length > 0) {
          activeRoom.state.lockedSections = activeRoom.state.lockedSections.filter(
            section => section.lockedBy !== userId
          );

          try {
            for (const sectionId of releasedSectionIds) {
              RoomRepository.unlockSection(roomId, sectionId).catch(() => {});
            }
          } catch (error) {
            console.warn('Failed to unlock sections in database:', error instanceof Error ? error.message : error);
          }

          this.notifyLocksReleased(roomId, userId, releasedSectionIds);
        }

        console.log(`[Heartbeat] User ${userId} timed out in room ${roomId}, released ${releasedSectionIds.length} locks`);
      }

      if (expiredUserIds.length > 0) {
        this.notify(roomId, { ...activeRoom.state });
      }
    }
  }

  private cleanupInactiveRooms(): void {
    const timeout = 30 * 60 * 1000;
    const now = Date.now();

    for (const [roomId, activeRoom] of this.rooms) {
      if (activeRoom.state.users.length === 0 && now - activeRoom.lastActivity > timeout) {
        this.rooms.delete(roomId);
      }
    }
  }

  getUsersInRoom(roomId: string): User[] {
    const activeRoom = this.rooms.get(roomId);
    return activeRoom ? [...activeRoom.state.users] : [];
  }

  getRoomState(roomId: string): RoomState | null {
    const activeRoom = this.rooms.get(roomId);
    return activeRoom ? { ...activeRoom.state } : null;
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    clearInterval(this.lockCleanupInterval);
    clearInterval(this.heartbeatCheckInterval);
    this.rooms.clear();
    this.listeners.clear();
    this.locksReleasedListeners.clear();
  }
}

export const roomManager = new RoomManager();

export default roomManager;
