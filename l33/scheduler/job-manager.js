const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

class JobManager {
  constructor() {
    this.jobs = new Map();
    this.tasks = new Map();
  }

  createJob(blenderFile, settings) {
    const jobId = uuidv4();
    const jobDir = path.join(config.paths.renders, jobId);
    const framesDir = path.join(jobDir, 'frames');
    
    fs.mkdirSync(framesDir, { recursive: true });
    
    const job = {
      id: jobId,
      name: settings.name || path.basename(blenderFile, '.blend'),
      blenderFile,
      settings: {
        resolution_x: settings.resolution_x || config.blender.defaultResolution.x,
        resolution_y: settings.resolution_y || config.blender.defaultResolution.y,
        engine: settings.engine || config.blender.defaultEngine,
        samples: settings.samples || 128,
        file_format: 'PNG',
        fps: settings.fps || 24,
        start_frame: settings.start_frame || 1,
        end_frame: settings.end_frame || 250
      },
      priority: settings.priority || 5,
      status: 'pending',
      created_at: Date.now(),
      started_at: null,
      completed_at: null,
      total_tasks: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      frames_dir: framesDir,
      output_file: null,
      estimated_completion: null
    };
    
    this.jobs.set(jobId, job);
    this._createTasks(job);
    
    return job;
  }

  _createTasks(job) {
    const startFrame = job.settings.start_frame;
    const endFrame = job.settings.end_frame;
    let taskId = 0;
    
    for (let frame = startFrame; frame <= endFrame; frame++) {
      const task = {
        job_id: job.id,
        task_id: taskId++,
        frame_number: frame,
        scene_file: job.blenderFile,
        settings: job.settings,
        priority: job.priority,
        output_path: path.join(job.frames_dir, `frame_${frame.toString().padStart(4, '0')}.png`),
        status: 'pending',
        assigned_node: null,
        started_at: null,
        completed_at: null,
        retry_count: 0
      };
      
      this.tasks.set(`${job.id}_${task.task_id}`, task);
      job.total_tasks++;
    }
  }

  getPendingTasks() {
    return Array.from(this.tasks.values()).filter(t => t.status === 'pending');
  }

  assignTask(taskId, nodeId) {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'pending') {
      task.status = 'assigned';
      task.assigned_node = nodeId;
      task.started_at = Date.now();
      
      const job = this.jobs.get(task.job_id);
      if (job && job.status === 'pending') {
        job.status = 'running';
        job.started_at = Date.now();
      }
      
      return task;
    }
    return null;
  }

  updateTaskProgress(taskId, progress) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.progress = progress;
      return true;
    }
    return false;
  }

  completeTask(taskId, outputFile, renderTime) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.completed_at = Date.now();
      task.render_time_ms = renderTime;
      task.output_file = outputFile;
      
      const job = this.jobs.get(task.job_id);
      if (job) {
        job.completed_tasks++;
        this._updateJobEstimates(job);
        
        if (job.completed_tasks === job.total_tasks) {
          job.status = 'completed';
          job.completed_at = Date.now();
        }
      }
      
      return true;
    }
    return false;
  }

  failTask(taskId, errorMessage) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'failed';
      task.error_message = errorMessage;
      task.retry_count++;
      
      const job = this.jobs.get(task.job_id);
      if (job) {
        job.failed_tasks++;
      }
      
      if (task.retry_count < config.task.maxRetries) {
        task.status = 'pending';
        task.assigned_node = null;
        task.started_at = null;
        return { shouldRetry: true };
      }
      
      return { shouldRetry: false };
    }
    return { shouldRetry: false };
  }

  _updateJobEstimates(job) {
    const completedTasks = Array.from(this.tasks.values())
      .filter(t => t.job_id === job.id && t.status === 'completed');
    
    if (completedTasks.length > 0) {
      const avgRenderTime = completedTasks.reduce((sum, t) => sum + t.render_time_ms, 0) / completedTasks.length;
      const remainingTasks = job.total_tasks - job.completed_tasks;
      job.estimated_completion = Date.now() + (avgRenderTime * remainingTasks);
    }
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  getJobTasks(jobId) {
    return Array.from(this.tasks.values()).filter(t => t.job_id === jobId);
  }

  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }
}

module.exports = JobManager;
