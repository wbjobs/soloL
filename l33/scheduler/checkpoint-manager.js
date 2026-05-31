const fs = require('fs');
const path = require('path');

class CheckpointManager {
  constructor(storagePath) {
    this.storagePath = path.resolve(storagePath);
    this.checkpoints = new Map();
    this._ensureDirectory();
    this._loadExistingCheckpoints();
  }

  _ensureDirectory() {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  _loadExistingCheckpoints() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const jobDirs = fs.readdirSync(this.storagePath);
        for (const jobId of jobDirs) {
          const jobDir = path.join(this.storagePath, jobId);
          if (fs.statSync(jobDir).isDirectory()) {
            const checkpointFiles = fs.readdirSync(jobDir)
              .filter(f => f.endsWith('.json'));
            
            for (const file of checkpointFiles) {
              try {
                const data = JSON.parse(fs.readFileSync(path.join(jobDir, file), 'utf8'));
                const key = `${data.job_id}_${data.task_id}`;
                this.checkpoints.set(key, data);
              } catch (e) {
                console.warn(`Failed to load checkpoint ${file}:`, e.message);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load checkpoints:', e);
    }
  }

  _getJobDirectory(jobId) {
    const jobDir = path.join(this.storagePath, jobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }
    return jobDir;
  }

  saveCheckpoint(checkpointData) {
    const { job_id, task_id, frame_number, checkpoint_frame, node_id, samples_rendered } = checkpointData;
    const key = `${job_id}_${task_id}`;
    
    const checkpoint = {
      job_id,
      task_id,
      frame_number,
      checkpoint_frame: checkpoint_frame || frame_number,
      checkpoint_path: checkpointData.checkpoint_path || '',
      timestamp: Date.now(),
      node_id,
      samples_rendered: samples_rendered || 0
    };

    const jobDir = this._getJobDirectory(job_id);
    const checkpointFile = path.join(jobDir, `task_${task_id}_ckpt_${checkpoint.checkpoint_frame}.json`);
    
    fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));
    
    const oldCheckpoint = this.checkpoints.get(key);
    if (oldCheckpoint && oldCheckpoint.checkpoint_frame < checkpoint.checkpoint_frame) {
      const oldFile = path.join(jobDir, `task_${task_id}_ckpt_${oldCheckpoint.checkpoint_frame}.json`);
      if (fs.existsSync(oldFile)) {
        fs.unlinkSync(oldFile);
      }
    }
    
    this.checkpoints.set(key, checkpoint);
    
    return {
      ...checkpoint,
      storage_path: checkpointFile
    };
  }

  getLatestCheckpoint(jobId, taskId) {
    const key = `${jobId}_${taskId}`;
    return this.checkpoints.get(key) || null;
  }

  getTaskCheckpoints(jobId, taskId) {
    const jobDir = path.join(this.storagePath, jobId);
    if (!fs.existsSync(jobDir)) {
      return [];
    }

    return fs.readdirSync(jobDir)
      .filter(f => f.startsWith(`task_${taskId}_ckpt_`) && f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(jobDir, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.checkpoint_frame - a.checkpoint_frame);
  }

  getJobCheckpoints(jobId) {
    const results = [];
    for (const [key, checkpoint] of this.checkpoints) {
      if (checkpoint.job_id === jobId) {
        results.push(checkpoint);
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  deleteTaskCheckpoints(jobId, taskId) {
    const key = `${jobId}_${taskId}`;
    this.checkpoints.delete(key);
    
    const jobDir = path.join(this.storagePath, jobId);
    if (fs.existsSync(jobDir)) {
      const files = fs.readdirSync(jobDir)
        .filter(f => f.startsWith(`task_${taskId}_`));
      
      for (const file of files) {
        fs.unlinkSync(path.join(jobDir, file));
      }
    }
  }

  deleteJobCheckpoints(jobId) {
    const keysToDelete = [];
    for (const [key, checkpoint] of this.checkpoints) {
      if (checkpoint.job_id === jobId) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.checkpoints.delete(key));
    
    const jobDir = path.join(this.storagePath, jobId);
    if (fs.existsSync(jobDir)) {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  }

  cleanupOldCheckpoints(maxAgeDays = 7) {
    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const jobsToDelete = new Set();
    
    for (const [key, checkpoint] of this.checkpoints) {
      if (checkpoint.timestamp < cutoffTime) {
        jobsToDelete.add(checkpoint.job_id);
      }
    }
    
    for (const jobId of jobsToDelete) {
      this.deleteJobCheckpoints(jobId);
    }
    
    return jobsToDelete.size;
  }

  getCheckpointStats() {
    const stats = {
      total_checkpoints: this.checkpoints.size,
      jobs_with_checkpoints: new Set(),
      total_size_bytes: 0
    };
    
    for (const [key, checkpoint] of this.checkpoints) {
      stats.jobs_with_checkpoints.add(checkpoint.job_id);
    }
    
    stats.jobs_with_checkpoints = stats.jobs_with_checkpoints.size;
    
    try {
      const files = this._getAllFiles(this.storagePath);
      for (const file of files) {
        stats.total_size_bytes += fs.statSync(file).size;
      }
    } catch (e) {
      console.warn('Failed to calculate checkpoint size:', e);
    }
    
    return stats;
  }

  _getAllFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(this._getAllFiles(filePath));
      } else {
        results.push(filePath);
      }
    }
    return results;
  }
}

module.exports = CheckpointManager;
