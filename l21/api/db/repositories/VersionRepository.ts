import pool, { useDatabase } from '../pool.js';
import type { ScoreVersion } from '../../../shared/types.js';
import { diff_match_patch, Diff } from 'diff-match-patch';
import { v4 as uuidv4 } from 'uuid';

interface DBVersion {
  id: string;
  room_id: string;
  version: number;
  content: string;
  message: string;
  user_id: string;
  user_name: string;
  created_at: Date;
}

const memoryVersions = new Map<string, ScoreVersion[]>();

export interface VersionDiff {
  version1: number;
  version2: number;
  diffs: Diff[];
  html: string;
}

function mapDbToScoreVersion(row: DBVersion): ScoreVersion {
  return {
    id: row.id,
    roomId: row.room_id,
    version: row.version,
    content: row.content,
    message: row.message,
    userId: row.user_id,
    userName: row.user_name,
    createdAt: row.created_at.getTime(),
  };
}

export const VersionRepository = {
  async findByRoomId(roomId: string, limit: number = 50): Promise<ScoreVersion[]> {
    if (!useDatabase) {
      const versions = memoryVersions.get(roomId) || [];
      return versions.slice(0, limit);
    }

    const result = await pool.query<DBVersion>(
      'SELECT * FROM versions WHERE room_id = $1 ORDER BY version DESC LIMIT $2',
      [roomId, limit]
    );

    return result.rows.map(mapDbToScoreVersion);
  },

  async findById(id: string): Promise<ScoreVersion | null> {
    if (!useDatabase) {
      for (const versions of memoryVersions.values()) {
        const found = versions.find((v) => v.id === id);
        if (found) return found;
      }
      return null;
    }

    const result = await pool.query<DBVersion>(
      'SELECT * FROM versions WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) return null;

    return mapDbToScoreVersion(result.rows[0]);
  },

  async findByRoomIdAndVersion(roomId: string, version: number): Promise<ScoreVersion | null> {
    if (!useDatabase) {
      const versions = memoryVersions.get(roomId) || [];
      return versions.find((v) => v.version === version) || null;
    }

    const result = await pool.query<DBVersion>(
      'SELECT * FROM versions WHERE room_id = $1 AND version = $2',
      [roomId, version]
    );

    if (result.rows.length === 0) return null;

    return mapDbToScoreVersion(result.rows[0]);
  },

  async create(
    roomId: string,
    version: number,
    content: string,
    message: string,
    userId: string,
    userName: string
  ): Promise<ScoreVersion> {
    const now = Date.now();
    const newVersion: ScoreVersion = {
      id: uuidv4(),
      roomId,
      version,
      content,
      message,
      userId,
      userName,
      createdAt: now,
    };

    if (!useDatabase) {
      const versions = memoryVersions.get(roomId) || [];
      versions.unshift(newVersion);
      memoryVersions.set(roomId, versions);
      return newVersion;
    }

    const result = await pool.query<DBVersion>(
      `INSERT INTO versions 
       (room_id, version, content, message, user_id, user_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [roomId, version, content, message, userId, userName]
    );

    return mapDbToScoreVersion(result.rows[0]);
  },

  async getLatestVersion(roomId: string): Promise<number> {
    if (!useDatabase) {
      const versions = memoryVersions.get(roomId) || [];
      return versions.length > 0 ? versions[0].version : 0;
    }

    const result = await pool.query<{ max_version: number }>(
      'SELECT COALESCE(MAX(version), 0) as max_version FROM versions WHERE room_id = $1',
      [roomId]
    );
    return result.rows[0].max_version;
  },

  async compareVersions(
    roomId: string,
    version1: number,
    version2: number
  ): Promise<VersionDiff | null> {
    const v1 = await this.findByRoomIdAndVersion(roomId, version1);
    const v2 = await this.findByRoomIdAndVersion(roomId, version2);

    if (!v1 || !v2) return null;

    const dmp = new diff_match_patch();
    const diffs = dmp.diff_main(v1.content, v2.content);
    dmp.diff_cleanupSemantic(diffs);

    const html = dmp.diff_prettyHtml(diffs);

    return {
      version1,
      version2,
      diffs,
      html,
    };
  },

  async rollbackToVersion(
    roomId: string,
    targetVersion: number,
    userId: string,
    userName: string
  ): Promise<ScoreVersion | null> {
    const target = await this.findByRoomIdAndVersion(roomId, targetVersion);
    if (!target) return null;

    const latestVersion = await this.getLatestVersion(roomId);
    const newVersion = latestVersion + 1;

    const rollbackMessage = `回滚到版本 ${targetVersion}: ${target.message}`;

    return this.create(
      roomId,
      newVersion,
      target.content,
      rollbackMessage,
      userId,
      userName
    );
  },
};

export default VersionRepository;
