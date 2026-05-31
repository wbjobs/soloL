import pool, { useDatabase } from '../pool.js';
import type { RoomState, LockedSection } from '../../../shared/types.js';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_ABC_SCORE } from '../../../shared/constants.js';

interface DBRoom {
  id: string;
  name: string;
  current_content: string;
  current_version: number;
  created_at: Date;
  updated_at: Date;
}

interface DBLockedSection {
  id: string;
  room_id: string;
  section_id: string;
  start_line: number;
  end_line: number;
  locked_by: string;
  locked_by_user_name: string;
  locked_at: Date;
  expires_at: Date;
}

const memoryRooms = new Map<string, {
  id: string;
  name: string;
  currentContent: string;
  currentVersion: number;
  createdAt: number;
  updatedAt: number;
}>();

const memoryLockedSections = new Map<string, LockedSection[]>();

function mapDbToRoomState(room: DBRoom, lockedSections: LockedSection[]): RoomState {
  return {
    id: room.id,
    name: room.name,
    users: [],
    currentContent: room.current_content,
    currentVersion: room.current_version,
    lockedSections,
  };
}

function mapDbToLockedSection(row: DBLockedSection): LockedSection {
  return {
    id: row.section_id,
    roomId: row.room_id,
    startLine: row.start_line,
    endLine: row.end_line,
    lockedBy: row.locked_by,
    lockedByUserName: row.locked_by_user_name,
    lockedAt: row.locked_at.getTime(),
    expiresAt: row.expires_at.getTime(),
  };
}

export const RoomRepository = {
  async findById(id: string): Promise<RoomState | null> {
    if (!useDatabase) {
      const room = memoryRooms.get(id);
      if (!room) {
        if (id === '00000000-0000-0000-0000-000000000001') {
          const demoRoom = {
            id,
            name: 'Demo Room',
            currentContent: DEFAULT_ABC_SCORE,
            currentVersion: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          memoryRooms.set(id, demoRoom);
          return {
            ...demoRoom,
            users: [],
            lockedSections: this.getMemoryLockedSections(id),
          };
        }
        return null;
      }
      return {
        id: room.id,
        name: room.name,
        users: [],
        currentContent: room.currentContent,
        currentVersion: room.currentVersion,
        lockedSections: this.getMemoryLockedSections(id),
      };
    }

    const result = await pool.query<DBRoom>(
      'SELECT * FROM rooms WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) return null;

    const room = result.rows[0];
    const lockedSections = await this.findLockedSections(id);

    return mapDbToRoomState(room, lockedSections);
  },

  async create(name: string, initialContent: string = DEFAULT_ABC_SCORE): Promise<RoomState> {
    const now = Date.now();

    if (!useDatabase) {
      const id = uuidv4();
      const room = {
        id,
        name,
        currentContent: initialContent,
        currentVersion: 1,
        createdAt: now,
        updatedAt: now,
      };
      memoryRooms.set(id, room);
      return {
        ...room,
        users: [],
        lockedSections: [],
      };
    }

    const result = await pool.query<DBRoom>(
      'INSERT INTO rooms (name, current_content, current_version, created_at, updated_at) VALUES ($1, $2, 1, NOW(), NOW()) RETURNING *',
      [name, initialContent]
    );

    return mapDbToRoomState(result.rows[0], []);
  },

  async updateContent(roomId: string, content: string, version: number): Promise<void> {
    if (!useDatabase) {
      const room = memoryRooms.get(roomId);
      if (room) {
        room.currentContent = content;
        room.currentVersion = version;
        room.updatedAt = Date.now();
      }
      return;
    }

    await pool.query(
      'UPDATE rooms SET current_content = $1, current_version = $2, updated_at = NOW() WHERE id = $3',
      [content, version, roomId]
    );
  },

  async incrementVersion(roomId: string): Promise<number> {
    if (!useDatabase) {
      const room = memoryRooms.get(roomId);
      if (room) {
        room.currentVersion += 1;
        room.updatedAt = Date.now();
        return room.currentVersion;
      }
      return 1;
    }

    const result = await pool.query<{ current_version: number }>(
      'UPDATE rooms SET current_version = current_version + 1, updated_at = NOW() WHERE id = $1 RETURNING current_version',
      [roomId]
    );
    return result.rows[0].current_version;
  },

  getMemoryLockedSections(roomId: string): LockedSection[] {
    const sections = memoryLockedSections.get(roomId) || [];
    const now = Date.now();
    return sections.filter((s) => s.expiresAt >= now);
  },

  async findLockedSections(roomId: string): Promise<LockedSection[]> {
    if (!useDatabase) {
      return this.getMemoryLockedSections(roomId);
    }

    const now = new Date();
    await pool.query(
      'DELETE FROM locked_sections WHERE room_id = $1 AND expires_at < $2',
      [roomId, now]
    );

    const result = await pool.query<DBLockedSection>(
      'SELECT * FROM locked_sections WHERE room_id = $1 AND expires_at >= $2',
      [roomId, now]
    );

    return result.rows.map(mapDbToLockedSection);
  },

  async lockSection(
    roomId: string,
    sectionId: string,
    startLine: number,
    endLine: number,
    userId: string,
    userName: string,
    ttlSeconds: number = 3
  ): Promise<LockedSection | null> {
    const lockedAt = Date.now();
    const expiresAt = lockedAt + ttlSeconds * 1000;

    const lockedSection: LockedSection = {
      id: sectionId,
      roomId,
      startLine,
      endLine,
      lockedBy: userId,
      lockedByUserName: userName,
      lockedAt,
      expiresAt,
    };

    if (!useDatabase) {
      const sections = this.getMemoryLockedSections(roomId);
      const existingIndex = sections.findIndex((s) => s.id === sectionId);
      if (existingIndex !== -1) {
        sections[existingIndex] = lockedSection;
      } else {
        sections.push(lockedSection);
      }
      memoryLockedSections.set(roomId, sections);
      return lockedSection;
    }

    try {
      await pool.query(
        `INSERT INTO locked_sections 
         (room_id, section_id, start_line, end_line, locked_by, locked_by_user_name, locked_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (room_id, section_id) 
         DO UPDATE SET 
           start_line = $3, 
           end_line = $4, 
           locked_by = $5, 
           locked_by_user_name = $6,
           locked_at = $7,
           expires_at = $8`,
        [roomId, sectionId, startLine, endLine, userId, userName, new Date(lockedAt), new Date(expiresAt)]
      );

      return lockedSection;
    } catch (error) {
      console.error('Failed to lock section:', error);
      return null;
    }
  },

  async unlockSection(roomId: string, sectionId: string): Promise<boolean> {
    if (!useDatabase) {
      const sections = this.getMemoryLockedSections(roomId);
      const filtered = sections.filter((s) => s.id !== sectionId);
      memoryLockedSections.set(roomId, filtered);
      return filtered.length < sections.length;
    }

    const result = await pool.query(
      'DELETE FROM locked_sections WHERE room_id = $1 AND section_id = $2',
      [roomId, sectionId]
    );
    return result.rowCount !== null && result.rowCount > 0;
  },

  async renewSectionLock(
    roomId: string,
    sectionId: string,
    userId: string,
    ttlSeconds: number = 3
  ): Promise<boolean> {
    const expiresAt = Date.now() + ttlSeconds * 1000;

    if (!useDatabase) {
      const sections = this.getMemoryLockedSections(roomId);
      const section = sections.find((s) => s.id === sectionId && s.lockedBy === userId);
      if (section) {
        section.expiresAt = expiresAt;
        return true;
      }
      return false;
    }

    const result = await pool.query(
      'UPDATE locked_sections SET expires_at = $1 WHERE room_id = $2 AND section_id = $3 AND locked_by = $4',
      [new Date(expiresAt), roomId, sectionId, userId]
    );

    return result.rowCount !== null && result.rowCount > 0;
  },

  async cleanupExpiredLocks(): Promise<number> {
    if (!useDatabase) {
      let count = 0;
      for (const [roomId, sections] of memoryLockedSections) {
        const now = Date.now();
        const filtered = sections.filter((s) => s.expiresAt >= now);
        count += sections.length - filtered.length;
        memoryLockedSections.set(roomId, filtered);
      }
      return count;
    }

    const result = await pool.query(
      'DELETE FROM locked_sections WHERE expires_at < NOW()'
    );
    return result.rowCount ?? 0;
  },
};

export default RoomRepository;
