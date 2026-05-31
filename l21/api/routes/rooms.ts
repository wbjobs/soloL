import { Router, type Request, type Response } from 'express';
import roomManager from '../services/RoomManager.js';
import RoomRepository from '../db/repositories/RoomRepository.js';
import type { RoomState } from '../../shared/types.js';

const router = Router();

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const room = await roomManager.getRoom(id);
    
    if (!room) {
      res.status(404).json({
        success: false,
        error: 'Room not found',
      });
      return;
    }

    res.json({
      success: true,
      data: room,
    });
  } catch (error) {
    console.error('Error getting room:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get room',
    });
  }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, initialContent } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Room name is required',
      });
      return;
    }

    const room: RoomState = await RoomRepository.create(name, initialContent || '');
    
    res.status(201).json({
      success: true,
      data: room,
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create room',
    });
  }
});

router.get('/:id/users', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    
    const users = roomManager.getUsersInRoom(id);

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error('Error getting room users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get room users',
    });
  }
});

router.get('/:id/locks', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const lockedSections = await RoomRepository.findLockedSections(id);

    res.json({
      success: true,
      data: lockedSections,
    });
  } catch (error) {
    console.error('Error getting locked sections:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get locked sections',
    });
  }
});

router.post('/:id/locks', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { sectionId, startLine, endLine, userId, userName } = req.body;

    if (typeof startLine !== 'number' || typeof endLine !== 'number' || !userId || !userName) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: startLine, endLine, userId, userName',
      });
      return;
    }

    const lockedSection = await roomManager.lockSection(
      id,
      sectionId,
      startLine,
      endLine,
      userId,
      userName
    );

    if (!lockedSection) {
      res.status(409).json({
        success: false,
        error: 'Section is already locked by another user',
      });
      return;
    }

    res.json({
      success: true,
      data: lockedSection,
    });
  } catch (error) {
    console.error('Error locking section:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to lock section',
    });
  }
});

router.delete('/:id/locks/:sectionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, sectionId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      res.status(400).json({
        success: false,
        error: 'userId is required',
      });
      return;
    }

    const success = await roomManager.unlockSection(id, sectionId, userId);

    if (!success) {
      res.status(404).json({
        success: false,
        error: 'Section not found or you are not the owner',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Section unlocked',
    });
  } catch (error) {
    console.error('Error unlocking section:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unlock section',
    });
  }
});

export default router;
