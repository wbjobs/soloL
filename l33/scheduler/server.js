const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');

const config = require('../config');
const PriorityQueue = require('./priority-queue');
const JobManager = require('./job-manager');
const NodeManager = require('./node-manager');
const VideoEncoder = require('./video-encoder');
const CheckpointManager = require('./checkpoint-manager');
const AssetDistributor = require('./asset-distributor');
const BudgetController = require('./budget-controller');

const PROTO_PATH = path.join(__dirname, '../proto/render.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const renderProto = grpc.loadPackageDefinition(packageDefinition).render;

class SchedulerServer {
  constructor() {
    this.jobManager = new JobManager();
    this.nodeManager = new NodeManager();
    this.taskQueue = new PriorityQueue();
    this.videoEncoder = new VideoEncoder(config.paths.output);
    this.checkpointManager = new CheckpointManager(config.paths.checkpoints);
    this.assetDistributor = new AssetDistributor(config.paths.uploads);
    this.budgetController = new BudgetController(config.paths.output);
    this.io = null;
    this.nodeTaskMap = new Map();
    
    this._setupHTTPServer();
    this._setupGRPCServer();
  }

  _setupHTTPServer() {
    const app = express();
    const server = http.createServer(app);
    this.io = new Server(server, {
      cors: { origin: "*" }
    });

    const storage = multer.diskStorage({
      destination: config.paths.uploads,
      filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
      }
    });
    const upload = multer({ storage });

    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../web/public')));
    app.use('/output', express.static(path.join(__dirname, '../output')));
    app.use('/checkpoints', express.static(path.join(__dirname, '../checkpoints')));

    app.post('/api/jobs', upload.single('blendFile'), (req, res) => {
      try {
        const settings = JSON.parse(req.body.settings || '{}');
        const job = this.jobManager.createJob(req.file.path, settings);
        
        const assets = this.assetDistributor.indexJobAssets(job.id, req.file.path);
        const assetIds = assets.map(a => a.asset_id);
        
        if (settings.max_frames || settings.max_gpu_hours || settings.cost_per_gpu_hour) {
          this.budgetController.setBudget(job.id, {
            max_frames: settings.max_frames || 0,
            max_gpu_hours: settings.max_gpu_hours ? settings.max_gpu_hours * 3600 * 1000 : 0,
            cost_per_gpu_hour: settings.cost_per_gpu_hour || 0
          });
        }
        
        const pendingTasks = this.jobManager.getPendingTasks();
        pendingTasks.forEach(task => {
          task.checkpoint_dir = path.join(config.paths.checkpoints, job.id);
          task.checkpoint_interval = config.checkpoint.intervalFrames;
          task.asset_ids = assetIds;
          this.taskQueue.enqueue(task);
        });
        
        this._broadcastUpdate();
        res.json({
          ...job,
          asset_count: assets.length,
          budget: this.budgetController.getBudgetStatus(job.id)
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/jobs', (req, res) => {
      res.json(this.jobManager.getAllJobs());
    });

    app.get('/api/jobs/:jobId', (req, res) => {
      const job = this.jobManager.getJob(req.params.jobId);
      if (job) {
        res.json({
          job,
          tasks: this.jobManager.getJobTasks(req.params.jobId),
          checkpoints: this.checkpointManager.getJobCheckpoints(req.params.jobId)
        });
      } else {
        res.status(404).json({ error: 'Job not found' });
      }
    });

    app.get('/api/nodes', (req, res) => {
      res.json(this.nodeManager.getAllNodes());
    });

    app.get('/api/queue', (req, res) => {
      res.json(this.taskQueue.getTasks());
    });

    app.get('/api/checkpoints/stats', (req, res) => {
      res.json(this.checkpointManager.getCheckpointStats());
    });

    app.get('/api/budgets', (req, res) => {
      res.json(this.budgetController.getAllBudgetStatuses());
    });

    app.get('/api/jobs/:jobId/budget', (req, res) => {
      const status = this.budgetController.getBudgetStatus(req.params.jobId);
      if (status) {
        res.json(status);
      } else {
        res.status(404).json({ error: 'No budget set for this job' });
      }
    });

    app.put('/api/jobs/:jobId/budget', (req, res) => {
      const budget = this.budgetController.updateBudget(req.params.jobId, req.body);
      if (budget) {
        this._broadcastUpdate();
        res.json(this.budgetController.getBudgetStatus(req.params.jobId));
      } else {
        res.status(404).json({ error: 'No budget found' });
      }
    });

    app.post('/api/jobs/:jobId/budget/pause', (req, res) => {
      this.budgetController.pauseJob(req.params.jobId);
      this._broadcastUpdate();
      res.json({ paused: true });
    });

    app.post('/api/jobs/:jobId/budget/resume', (req, res) => {
      this.budgetController.resumeJob(req.params.jobId);
      this._broadcastUpdate();
      res.json({ resumed: true });
    });

    app.get('/api/jobs/:jobId/cost-report', (req, res) => {
      const report = this.budgetController.generateCostReport(req.params.jobId);
      if (report) {
        res.json(report);
      } else {
        res.status(404).json({ error: 'No budget data' });
      }
    });

    app.get('/api/jobs/:jobId/cost-report/download', (req, res) => {
      const report = this.budgetController.generateCostReport(req.params.jobId);
      if (report && fs.existsSync(report.file_path)) {
        res.download(report.file_path, `cost_report_${req.params.jobId}.csv`);
      } else {
        res.status(404).json({ error: 'No cost report available' });
      }
    });

    app.get('/api/jobs/:jobId/assets', (req, res) => {
      const assets = this.assetDistributor.getAssetsByJob(req.params.jobId);
      res.json(assets);
    });

    app.get('/api/assets/:assetId/download', (req, res) => {
      const asset = this.assetDistributor.getAssetById(req.params.assetId);
      if (asset && fs.existsSync(asset.file_path)) {
        res.download(asset.file_path);
      } else {
        res.status(404).json({ error: 'Asset not found' });
      }
    });

    app.get('/api/cache-status', (req, res) => {
      res.json(this.assetDistributor.getAllNodeCacheStatus());
    });

    app.post('/api/jobs/:jobId/encode', async (req, res) => {
      try {
        const job = this.jobManager.getJob(req.params.jobId);
        if (!job) {
          return res.status(404).json({ error: 'Job not found' });
        }

        if (job.status !== 'completed') {
          return res.status(400).json({ error: 'Job not completed yet' });
        }

        const outputFilename = `${req.params.jobId}.mp4`;
        const result = await this.videoEncoder.encodeFramesToMP4(
          job.frames_dir,
          outputFilename,
          job.settings.fps || 24
        );

        job.output_file = outputFilename;
        this._broadcastUpdate();

        res.json(result);
      } catch (error) {
        console.error('Encode error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/jobs/:jobId/download', (req, res) => {
      const job = this.jobManager.getJob(req.params.jobId);
      if (!job || !job.output_file) {
        return res.status(404).json({ error: 'Output not available' });
      }

      const filePath = path.join(config.paths.output, job.output_file);
      res.download(filePath, `${job.name}.mp4`);
    });

    server.listen(config.scheduler.httpPort, () => {
      console.log(`HTTP/WebSocket server running on port ${config.scheduler.httpPort}`);
    });
  }

  _setupGRPCServer() {
    const server = new grpc.Server();

    server.addService(renderProto.RenderScheduler.service, {
      RegisterNode: this._registerNode.bind(this),
      ReconnectNode: this._reconnectNode.bind(this),
      Heartbeat: this._heartbeat.bind(this),
      GetTask: this._getTask.bind(this),
      ReportTaskProgress: this._reportTaskProgress.bind(this),
      ReportCheckpoint: this._reportCheckpoint.bind(this),
      ReportTaskComplete: this._reportTaskComplete.bind(this),
      ReportTaskFailed: this._reportTaskFailed.bind(this),
      RequestAssets: this._requestAssets.bind(this),
      ReportCacheStatus: this._reportCacheStatus.bind(this)
    });

    server.bindAsync(
      `${config.scheduler.host}:${config.scheduler.port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, port) => {
        if (err) {
          console.error('Failed to bind gRPC server:', err);
          return;
        }
        console.log(`gRPC server running on port ${port}`);
      }
    );
  }

  _registerNode(call, callback) {
    const { node_id, hardware, address } = call.request;
    const node = this.nodeManager.registerNode(node_id, hardware, address);
    console.log(`Node registered: ${node_id} (${hardware.node_name})`);
    
    this.nodeTaskMap.set(node_id, []);
    this._broadcastUpdate();
    
    callback(null, {
      success: true,
      message: 'Node registered successfully',
      heartbeat_interval_ms: config.node.heartbeatIntervalMs
    });
  }

  _reconnectNode(call, callback) {
    const { node_id, hardware, address, incomplete_tasks } = call.request;
    
    console.log(`Node reconnecting: ${node_id} (${hardware.node_name})`);
    
    let existingNode = this.nodeManager.getNode(node_id);
    if (existingNode) {
      existingNode.status = 'online';
      existingNode.last_heartbeat = Date.now();
      existingNode.hardware = hardware;
      existingNode.address = address;
      console.log(`Node ${node_id} reconnected successfully`);
    } else {
      this.nodeManager.registerNode(node_id, hardware, address);
      console.log(`Node ${node_id} registered as new node`);
    }

    const reassignedTasks = [];
    if (incomplete_tasks && incomplete_tasks.length > 0) {
      console.log(`Node ${node_id} reports ${incomplete_tasks.length} incomplete tasks`);
      
      for (const incomplete of incomplete_tasks) {
        const taskKey = `${incomplete.job_id}_${incomplete.task_id}`;
        const task = this.jobManager.getTask(taskKey);
        
        if (task && (task.status === 'assigned' || task.status === 'running')) {
          const checkpoint = this.checkpointManager.getLatestCheckpoint(
            incomplete.job_id, 
            incomplete.task_id
          );
          
          if (checkpoint) {
            task.resume_from = checkpoint;
            console.log(`  - Task ${incomplete.task_id}: resuming from checkpoint at frame ${checkpoint.checkpoint_frame}`);
          }
          
          reassignedTasks.push(task);
        }
      }
    }

    this.nodeTaskMap.set(node_id, []);
    this._broadcastUpdate();

    callback(null, {
      success: true,
      message: 'Reconnected successfully',
      heartbeat_interval_ms: config.node.heartbeatIntervalMs,
      reassigned_tasks: reassignedTasks.map(t => ({
        job_id: t.job_id,
        task_id: t.task_id,
        frame_number: t.frame_number,
        scene_file: t.scene_file,
        settings: t.settings,
        priority: t.priority,
        output_path: t.output_path,
        resume_from: t.resume_from || null,
        checkpoint_dir: t.checkpoint_dir,
        checkpoint_interval: config.checkpoint.intervalFrames
      })),
      should_retry_incomplete: true
    });
  }

  _heartbeat(call, callback) {
    const { node_id, current_load, running_tasks, available_ram, available_vram } = call.request;
    
    const node = this.nodeManager.getNode(node_id);
    if (!node) {
      callback(null, {
        alive: false,
        should_get_task: false,
        next_heartbeat_ms: config.node.heartbeatIntervalMs,
        cancel_tasks: []
      });
      return;
    }

    this.nodeManager.updateHeartbeat(node_id, current_load, running_tasks);
    
    if (running_tasks) {
      this.nodeTaskMap.set(node_id, running_tasks.map(t => `${t.job_id}_${t.task_id}`));
    }

    const cancelTasks = [];
    
    callback(null, {
      alive: true,
      should_get_task: !this.taskQueue.isEmpty() && node.status === 'online',
      next_heartbeat_ms: config.node.heartbeatIntervalMs,
      cancel_tasks: cancelTasks
    });
  }

  _handleNodeFailure(nodeId) {
    console.log(`Handling failure for node ${nodeId}`);
    
    const nodeTasks = this.nodeTaskMap.get(nodeId) || [];
    console.log(`Node ${nodeId} had ${nodeTasks.length} running tasks`);
    
    for (const taskKey of nodeTasks) {
      const task = this.jobManager.getTask(taskKey);
      if (task && (task.status === 'assigned' || task.status === 'running')) {
        console.log(`  - Requeueing task ${taskKey} (frame ${task.frame_number})`);
        
        const checkpoint = this.checkpointManager.getLatestCheckpoint(task.job_id, task.task_id);
        if (checkpoint) {
          task.resume_from = checkpoint;
          console.log(`    Will resume from checkpoint at ${checkpoint.checkpoint_frame}`);
        }
        
        task.status = 'pending';
        task.assigned_node = null;
        task.started_at = null;
        
        this.taskQueue.enqueue(task);
      }
    }

    this.nodeTaskMap.delete(nodeId);
    this._broadcastUpdate();
  }

  _getTask(call, callback) {
    const { node_id, hardware_capabilities } = call.request;
    
    const node = this.nodeManager.getNode(node_id);
    if (!node || node.status !== 'online') {
      callback(null, { has_task: false, message: 'Node not registered or offline' });
      return;
    }

    if (this.taskQueue.isEmpty()) {
      callback(null, { has_task: false, message: 'No tasks available' });
      return;
    }

    const peekTask = this.taskQueue.peek();
    if (peekTask && !this.budgetController.isJobAllowed(peekTask.job_id)) {
      this.budgetController.generateCostReport(peekTask.job_id);
      callback(null, { has_task: false, message: 'Job paused due to budget limit' });
      this.io.emit('budgetAlert', this.budgetController.getBudgetStatus(peekTask.job_id));
      return;
    }

    const task = this.taskQueue.dequeue();
    if (task) {
      if (!this.budgetController.isJobAllowed(task.job_id)) {
        this.taskQueue.enqueue(task);
        this.budgetController.generateCostReport(task.job_id);
        callback(null, { has_task: false, message: 'Job paused due to budget limit' });
        this.io.emit('budgetAlert', this.budgetController.getBudgetStatus(task.job_id));
        return;
      }

      const assignedTask = this.jobManager.assignTask(`${task.job_id}_${task.task_id}`, node_id);
      
      if (assignedTask) {
        console.log(`Assigned task ${task.task_id} (frame ${task.frame_number}) to node ${node_id}`);
        
        if (task.resume_from) {
          console.log(`  - Resuming from checkpoint at frame ${task.resume_from.checkpoint_frame}`);
        }
        
        const budgetStatus = this.budgetController.getBudgetStatus(task.job_id);
        
        this._broadcastUpdate();
        
        callback(null, {
          has_task: true,
          task: {
            job_id: task.job_id,
            task_id: task.task_id,
            frame_number: task.frame_number,
            scene_file: task.scene_file,
            settings: task.settings,
            priority: task.priority,
            output_path: task.output_path,
            resume_from: task.resume_from || null,
            checkpoint_dir: task.checkpoint_dir,
            checkpoint_interval: config.checkpoint.intervalFrames,
            budget: budgetStatus ? {
              max_frames: budgetStatus.max_frames,
              max_gpu_hours_ms: budgetStatus.max_gpu_hours_ms,
              cost_per_gpu_hour: budgetStatus.cost_per_gpu_hour,
              paused: budgetStatus.paused,
              budget_created_at: budgetStatus.job_id ? Date.now() : 0
            } : null,
            asset_ids: task.asset_ids || []
          },
          message: task.resume_from ? 'Task resumed from checkpoint' : 'Task assigned'
        });
        return;
      }
    }

    callback(null, { has_task: false, message: 'No tasks available' });
  }

  _reportTaskProgress(call, callback) {
    const { job_id, task_id, progress_percent, elapsed_ms, status_message } = call.request;
    this.jobManager.updateTaskProgress(`${job_id}_${task_id}`, progress_percent);
    
    this.io.emit('taskProgress', {
      job_id,
      task_id,
      progress: progress_percent,
      elapsed: elapsed_ms,
      message: status_message
    });
    
    callback(null, { received: true });
  }

  _reportCheckpoint(call, callback) {
    const { node_id, checkpoint } = call.request;
    
    console.log(`Checkpoint received: job=${checkpoint.job_id}, task=${checkpoint.task_id}, frame=${checkpoint.checkpoint_frame}`);
    
    const savedCheckpoint = this.checkpointManager.saveCheckpoint({
      ...checkpoint,
      node_id
    });
    
    const task = this.jobManager.getTask(`${checkpoint.job_id}_${checkpoint.task_id}`);
    if (task) {
      task.last_checkpoint = savedCheckpoint;
    }
    
    this.io.emit('checkpointUpdate', savedCheckpoint);
    
    callback(null, {
      received: true,
      storage_path: savedCheckpoint.storage_path
    });
  }

  _reportTaskComplete(call, callback) {
    const { node_id, job_id, task_id, frame_number, output_file, render_time_ms } = call.request;
    
    this.jobManager.completeTask(`${job_id}_${task_id}`, output_file, render_time_ms);
    this.checkpointManager.deleteTaskCheckpoints(job_id, task_id);
    
    console.log(`Task ${task_id} (frame ${frame_number}) completed in ${render_time_ms}ms`);
    
    const node = this.nodeManager.getNode(node_id);
    const gpuName = node && node.hardware && node.hardware.gpus && node.hardware.gpus[0] 
      ? node.hardware.gpus[0].name : 'Unknown GPU';
    const budgetResult = this.budgetController.recordFrameComplete(job_id, render_time_ms, gpuName);
    
    if (budgetResult.over_budget) {
      console.log(`Job ${job_id} over budget! Pausing.`);
      this.io.emit('budgetAlert', this.budgetController.getBudgetStatus(job_id));
    }
    
    const nodeTasks = this.nodeTaskMap.get(node_id) || [];
    this.nodeTaskMap.set(node_id, nodeTasks.filter(t => t !== `${job_id}_${task_id}`));
    
    this._broadcastUpdate();
    this._checkJobCompletion(job_id);
    
    callback(null, { success: true, message: 'Task completed' });
  }

  _reportTaskFailed(call, callback) {
    const { node_id, job_id, task_id, error_message, retry_count } = call.request;
    
    const result = this.jobManager.failTask(`${job_id}_${task_id}`, error_message);
    console.log(`Task ${task_id} failed: ${error_message}`);
    
    const lastCheckpoint = this.checkpointManager.getLatestCheckpoint(job_id, task_id);
    
    if (result.shouldRetry) {
      const task = this.jobManager.getTask(`${job_id}_${task_id}`);
      if (task) {
        if (lastCheckpoint) {
          task.resume_from = lastCheckpoint;
          console.log(`  Will retry from checkpoint at ${lastCheckpoint.checkpoint_frame}`);
        }
        this.taskQueue.enqueue(task);
      }
    }
    
    const nodeTasks = this.nodeTaskMap.get(node_id) || [];
    this.nodeTaskMap.set(node_id, nodeTasks.filter(t => t !== `${job_id}_${task_id}`));
    
    this._broadcastUpdate();
    
    callback(null, {
      should_retry: result.shouldRetry,
      message: lastCheckpoint 
        ? `Will retry from checkpoint at frame ${lastCheckpoint.checkpoint_frame}`
        : (result.shouldRetry ? 'Task will be retried' : 'Max retries exceeded'),
      last_checkpoint: lastCheckpoint
    });
  }

  _requestAssets(call, callback) {
    const { node_id, job_id, requested_asset_ids } = call.request;
    
    const availableAssets = this.assetDistributor.distributeAssetsToNode(node_id, requested_asset_ids);
    const downloadUrls = {};
    
    for (const asset of availableAssets) {
      downloadUrls[asset.asset_id] = `/api/assets/${asset.asset_id}/download`;
    }
    
    callback(null, {
      success: true,
      available_assets: availableAssets.map(a => ({
        asset_id: a.asset_id,
        file_path: a.file_path,
        asset_type: a.asset_type,
        file_size: a.file_size,
        checksum: a.checksum
      })),
      download_urls: downloadUrls,
      message: `${availableAssets.length} assets available`
    });
  }

  _reportCacheStatus(call, callback) {
    const { node_id, used_bytes, total_bytes, item_count, texture_count, mesh_count } = call.request;
    
    this.assetDistributor.updateNodeCacheStatus(node_id, {
      used_bytes: parseInt(used_bytes),
      total_bytes: parseInt(total_bytes),
      item_count,
      texture_count,
      mesh_count
    });
    
    callback(null, { received: true });
  }

  _broadcastUpdate() {
    this.io.emit('statusUpdate', {
      jobs: this.jobManager.getAllJobs(),
      nodes: this.nodeManager.getAllNodes(),
      queueSize: this.taskQueue.size(),
      checkpointStats: this.checkpointManager.getCheckpointStats(),
      budgets: this.budgetController.getAllBudgetStatuses(),
      cacheStatus: this.assetDistributor.getAllNodeCacheStatus()
    });
  }

  _checkJobCompletion(jobId) {
    const job = this.jobManager.getJob(jobId);
    if (job && job.status === 'completed') {
      console.log(`Job ${jobId} completed! All ${job.total_tasks} frames rendered.`);
      this.io.emit('jobComplete', job);
      
      setTimeout(async () => {
        try {
          const outputFilename = `${jobId}.mp4`;
          await this.videoEncoder.encodeFramesToMP4(
            job.frames_dir,
            outputFilename,
            job.settings.fps || 24
          );
          job.output_file = outputFilename;
          this._broadcastUpdate();
          console.log(`Job ${jobId} video encoded successfully`);
        } catch (e) {
          console.warn(`Auto-encode failed for job ${jobId}:`, e.message);
        }
      }, 2000);
    }
  }

  start() {
    console.log('Scheduler server starting...');
    console.log(`Checkpoint storage: ${config.paths.checkpoints}`);
    console.log(`Checkpoint interval: every ${config.checkpoint.intervalFrames} frames`);
    
    setInterval(() => {
      const offlineNodes = this.nodeManager.checkOfflineNodes();
      for (const nodeId of offlineNodes) {
        console.log(`Node ${nodeId} detected as offline`);
        this._handleNodeFailure(nodeId);
      }
      if (offlineNodes.length > 0) {
        this._broadcastUpdate();
      }
    }, config.node.heartbeatTimeoutMs);

    setInterval(() => {
      const deleted = this.checkpointManager.cleanupOldCheckpoints(config.checkpoint.maxAgeDays);
      if (deleted > 0) {
        console.log(`Cleaned up ${deleted} old checkpoint jobs`);
      }
    }, 24 * 60 * 60 * 1000);
  }
}

const scheduler = new SchedulerServer();
scheduler.start();
