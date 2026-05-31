import { Router } from 'express';
import { Annotation, User } from '../../shared/types';

const router = Router();

router.post('/session/create', async (req, res) => {
  try {
    const { gridId, host } = req.body as { gridId: string; host: User };
    
    const { createSession, getUserColor } = await import('../services/collaborationService.js');
    
    const hostWithColor: User = {
      ...host,
      color: getUserColor(host.id),
      isOnline: true,
      lastActive: Date.now()
    };
    
    const sessionId = createSession(gridId, hostWithColor);
    
    res.json({ sessionId });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

router.post('/session/join', async (req, res) => {
  try {
    const { sessionId, user } = req.body as { sessionId: string; user: User };
    
    const { joinSession, getSessionUsers, getAnnotations, getUserColor } = await import('../services/collaborationService.js');
    
    const userWithColor: User = {
      ...user,
      color: getUserColor(user.id),
      isOnline: true,
      lastActive: Date.now()
    };
    
    const success = joinSession(sessionId, userWithColor);
    
    if (!success) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({
      success: true,
      user: userWithColor,
      users: getSessionUsers(sessionId),
      annotations: getAnnotations(sessionId)
    });
  } catch (error) {
    console.error('Error joining session:', error);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

router.get('/session/:sessionId/users', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const { getSessionUsers } = await import('../services/collaborationService.js');
    
    const users = getSessionUsers(sessionId);
    
    res.json({ users });
  } catch (error) {
    console.error('Error getting session users:', error);
    res.status(500).json({ error: 'Failed to get session users' });
  }
});

router.get('/session/:sessionId/annotations', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const { getAnnotations } = await import('../services/collaborationService.js');
    
    const annotations = getAnnotations(sessionId);
    
    res.json({ annotations });
  } catch (error) {
    console.error('Error getting annotations:', error);
    res.status(500).json({ error: 'Failed to get annotations' });
  }
});

router.post('/annotation', async (req, res) => {
  try {
    const { sessionId, annotation } = req.body as { 
      sessionId: string; 
      annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'> 
    };
    
    const { addAnnotation } = await import('../services/collaborationService.js');
    
    const result = addAnnotation(sessionId, annotation);
    
    if (!result) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error adding annotation:', error);
    res.status(500).json({ error: 'Failed to add annotation' });
  }
});

router.put('/annotation/:annotationId', async (req, res) => {
  try {
    const { sessionId, updates } = req.body as { sessionId: string; updates: Partial<Annotation> };
    const { annotationId } = req.params;
    
    const { updateAnnotation } = await import('../services/collaborationService.js');
    
    const result = updateAnnotation(sessionId, annotationId, updates);
    
    if (!result) {
      return res.status(404).json({ error: 'Annotation not found' });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error updating annotation:', error);
    res.status(500).json({ error: 'Failed to update annotation' });
  }
});

router.delete('/annotation/:annotationId', async (req, res) => {
  try {
    const { sessionId } = req.body as { sessionId: string };
    const { annotationId } = req.params;
    
    const { deleteAnnotation } = await import('../services/collaborationService.js');
    
    const success = deleteAnnotation(sessionId, annotationId);
    
    if (!success) {
      return res.status(404).json({ error: 'Annotation not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting annotation:', error);
    res.status(500).json({ error: 'Failed to delete annotation' });
  }
});

router.post('/annotation/:annotationId/lock', async (req, res) => {
  try {
    const { sessionId, userId } = req.body as { sessionId: string; userId: string };
    const { annotationId } = req.params;
    
    const { lockAnnotation } = await import('../services/collaborationService.js');
    
    const success = lockAnnotation(sessionId, annotationId, userId);
    
    res.json({ success });
  } catch (error) {
    console.error('Error locking annotation:', error);
    res.status(500).json({ error: 'Failed to lock annotation' });
  }
});

router.post('/annotation/:annotationId/unlock', async (req, res) => {
  try {
    const { sessionId, userId } = req.body as { sessionId: string; userId: string };
    const { annotationId } = req.params;
    
    const { unlockAnnotation } = await import('../services/collaborationService.js');
    
    const success = unlockAnnotation(sessionId, annotationId, userId);
    
    res.json({ success });
  } catch (error) {
    console.error('Error unlocking annotation:', error);
    res.status(500).json({ error: 'Failed to unlock annotation' });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    const { gridId } = req.query;
    
    const { listSessions } = await import('../services/collaborationService.js');
    
    const sessions = listSessions(gridId as string | undefined);
    
    res.json({ sessions });
  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

export default router;
