import { Router, type Request, type Response } from 'express';
import VersionRepository from '../db/repositories/VersionRepository.js';
import RoomRepository from '../db/repositories/RoomRepository.js';
import roomManager from '../services/RoomManager.js';
import type { ScoreVersion } from '../../shared/types.js';

const router = Router();

router.get('/room/:roomId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const versions: ScoreVersion[] = await VersionRepository.findByRoomId(roomId, limit);

    res.json({
      success: true,
      data: versions,
    });
  } catch (error) {
    console.error('Error getting versions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get versions',
    });
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const version = await VersionRepository.findById(id);

    if (!version) {
      res.status(404).json({
        success: false,
        error: 'Version not found',
      });
      return;
    }

    res.json({
      success: true,
      data: version,
    });
  } catch (error) {
    console.error('Error getting version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get version',
    });
  }
});

router.get('/room/:roomId/version/:version', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, version } = req.params;
    const versionNum = parseInt(version);

    if (isNaN(versionNum)) {
      res.status(400).json({
        success: false,
        error: 'Invalid version number',
      });
      return;
    }

    const scoreVersion = await VersionRepository.findByRoomIdAndVersion(roomId, versionNum);

    if (!scoreVersion) {
      res.status(404).json({
        success: false,
        error: 'Version not found',
      });
      return;
    }

    res.json({
      success: true,
      data: scoreVersion,
    });
  } catch (error) {
    console.error('Error getting version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get version',
    });
  }
});

router.post('/room/:roomId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId } = req.params;
    const { content, message, userId, userName } = req.body;

    if (!content || !userId || !userName) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: content, userId, userName',
      });
      return;
    }

    const room = await RoomRepository.findById(roomId);
    if (!room) {
      res.status(404).json({
        success: false,
        error: 'Room not found',
      });
      return;
    }

    const latestVersion = await VersionRepository.getLatestVersion(roomId);
    const newVersion = latestVersion + 1;

    const savedVersion: ScoreVersion = await VersionRepository.create(
      roomId,
      newVersion,
      content,
      message || `版本 ${newVersion}`,
      userId,
      userName
    );

    await RoomRepository.updateContent(roomId, content, newVersion);
    roomManager.updateContent(roomId, content, newVersion);

    res.status(201).json({
      success: true,
      data: savedVersion,
    });
  } catch (error) {
    console.error('Error saving version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save version',
    });
  }
});

router.post('/room/:roomId/rollback/:version', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, version } = req.params;
    const { userId, userName } = req.body;
    const targetVersion = parseInt(version);

    if (isNaN(targetVersion) || !userId || !userName) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: version, userId, userName',
      });
      return;
    }

    const rolledBack = await VersionRepository.rollbackToVersion(
      roomId,
      targetVersion,
      userId,
      userName
    );

    if (!rolledBack) {
      res.status(404).json({
        success: false,
        error: 'Target version not found',
      });
      return;
    }

    await RoomRepository.updateContent(roomId, rolledBack.content, rolledBack.version);
    roomManager.updateContent(roomId, rolledBack.content, rolledBack.version);

    res.json({
      success: true,
      data: rolledBack,
      message: `Rolled back to version ${targetVersion}`,
    });
  } catch (error) {
    console.error('Error rolling back version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to rollback version',
    });
  }
});

router.get('/room/:roomId/compare/:v1/:v2', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, v1, v2 } = req.params;
    const version1 = parseInt(v1);
    const version2 = parseInt(v2);

    if (isNaN(version1) || isNaN(version2)) {
      res.status(400).json({
        success: false,
        error: 'Invalid version numbers',
      });
      return;
    }

    const diff = await VersionRepository.compareVersions(roomId, version1, version2);

    if (!diff) {
      res.status(404).json({
        success: false,
        error: 'One or both versions not found',
      });
      return;
    }

    res.json({
      success: true,
      data: diff,
    });
  } catch (error) {
    console.error('Error comparing versions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to compare versions',
    });
  }
});

export default router;
