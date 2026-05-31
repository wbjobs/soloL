const fs = require('fs');
const path = require('path');

class BudgetController {
  constructor(outputDir) {
    this.outputDir = outputDir;
    this.budgets = new Map();
    this.usage = new Map();
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  setBudget(jobId, config) {
    const budget = {
      job_id: jobId,
      max_frames: config.max_frames || 0,
      max_gpu_hours_ms: config.max_gpu_hours || 0,
      cost_per_gpu_hour: config.cost_per_gpu_hour || 0,
      paused: false,
      created_at: Date.now(),
      over_budget: false
    };

    this.budgets.set(jobId, budget);
    this.usage.set(jobId, {
      completed_frames: 0,
      consumed_gpu_hours_ms: 0,
      total_cost: 0,
      frame_costs: [],
      started_at: Date.now()
    });

    return budget;
  }

  getBudget(jobId) {
    return this.budgets.get(jobId) || null;
  }

  getBudgetStatus(jobId) {
    const budget = this.budgets.get(jobId);
    const usage = this.usage.get(jobId);
    
    if (!budget || !usage) return null;

    return {
      job_id: jobId,
      max_frames: budget.max_frames,
      completed_frames: usage.completed_frames,
      max_gpu_hours_ms: budget.max_gpu_hours_ms,
      consumed_gpu_hours_ms: usage.consumed_gpu_hours_ms,
      cost_per_gpu_hour: budget.cost_per_gpu_hour,
      total_cost: usage.total_cost,
      over_budget: budget.over_budget,
      paused: budget.paused,
      gpu_hours_consumed: this._msToHours(usage.consumed_gpu_hours_ms),
      gpu_hours_budget: this._msToHours(budget.max_gpu_hours_ms),
      frame_progress: budget.max_frames > 0 
        ? Math.round((usage.completed_frames / budget.max_frames) * 100) 
        : 0,
      cost_progress: budget.max_gpu_hours_ms > 0 
        ? Math.round((usage.consumed_gpu_hours_ms / budget.max_gpu_hours_ms) * 100) 
        : 0
    };
  }

  recordFrameComplete(jobId, renderTimeMs, gpuInfo) {
    const budget = this.budgets.get(jobId);
    const usage = this.usage.get(jobId);
    
    if (!budget || !usage) return { allowed: true };

    usage.completed_frames++;

    const gpuHoursMs = renderTimeMs;
    usage.consumed_gpu_hours_ms += gpuHoursMs;

    const gpuHours = this._msToHours(gpuHoursMs);
    const frameCost = gpuHours * budget.cost_per_gpu_hour;
    usage.total_cost += frameCost;

    usage.frame_costs.push({
      frame: usage.completed_frames,
      render_time_ms: renderTimeMs,
      gpu_hours: gpuHours,
      cost: frameCost,
      gpu_name: gpuInfo || 'Unknown',
      timestamp: Date.now()
    });

    const overBudget = this._checkOverBudget(jobId);
    
    if (overBudget && !budget.over_budget) {
      budget.over_budget = true;
      budget.paused = true;
      console.log(`Job ${jobId} is over budget! Cost: $${usage.total_cost.toFixed(2)}, Frames: ${usage.completed_frames}`);
      return { allowed: false, over_budget: true, reason: 'Over budget' };
    }

    return { allowed: !budget.paused, over_budget: budget.over_budget };
  }

  _checkOverBudget(jobId) {
    const budget = this.budgets.get(jobId);
    const usage = this.usage.get(jobId);
    
    if (!budget || !usage) return false;

    if (budget.max_frames > 0 && usage.completed_frames >= budget.max_frames) {
      return true;
    }

    if (budget.max_gpu_hours_ms > 0 && usage.consumed_gpu_hours_ms >= budget.max_gpu_hours_ms) {
      return true;
    }

    return false;
  }

  isJobAllowed(jobId) {
    const budget = this.budgets.get(jobId);
    if (!budget) return true;
    return !budget.paused && !budget.over_budget;
  }

  pauseJob(jobId) {
    const budget = this.budgets.get(jobId);
    if (budget) {
      budget.paused = true;
      return true;
    }
    return false;
  }

  resumeJob(jobId) {
    const budget = this.budgets.get(jobId);
    if (budget) {
      budget.paused = false;
      budget.over_budget = false;
      return true;
    }
    return false;
  }

  updateBudget(jobId, updates) {
    const budget = this.budgets.get(jobId);
    if (!budget) return null;
    
    if (updates.max_frames !== undefined) budget.max_frames = updates.max_frames;
    if (updates.max_gpu_hours !== undefined) budget.max_gpu_hours_ms = updates.max_gpu_hours;
    if (updates.cost_per_gpu_hour !== undefined) budget.cost_per_gpu_hour = updates.cost_per_gpu_hour;
    
    if (budget.paused && !budget.over_budget) {
      budget.paused = false;
    }
    
    return budget;
  }

  generateCostReport(jobId) {
    const budget = this.budgets.get(jobId);
    const usage = this.usage.get(jobId);
    
    if (!budget || !usage) return null;

    const reportDir = path.join(this.outputDir, jobId);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(reportDir, `cost_report_${timestamp}.csv`);

    const lines = [];
    lines.push('Frame,Render Time (ms),GPU Hours,Cost (USD),GPU Name,Timestamp');
    
    for (const fc of usage.frame_costs) {
      lines.push(`${fc.frame},${fc.render_time_ms},${fc.gpu_hours.toFixed(6)},${fc.cost.toFixed(4)},${fc.gpu_name},${new Date(fc.timestamp).toISOString()}`);
    }
    
    lines.push('');
    lines.push('Summary');
    lines.push(`Total Frames,${usage.completed_frames}`);
    lines.push(`Max Frames Budget,${budget.max_frames || 'Unlimited'}`);
    lines.push(`Total GPU Hours,${this._msToHours(usage.consumed_gpu_hours_ms).toFixed(6)}`);
    lines.push(`Max GPU Hours Budget,${this._msToHours(budget.max_gpu_hours_ms).toFixed(6) || 'Unlimited'}`);
    lines.push(`Cost Per GPU Hour,$${budget.cost_per_gpu_hour.toFixed(2)}`);
    lines.push(`Total Cost,$${usage.total_cost.toFixed(4)}`);
    lines.push(`Over Budget,${budget.over_budget ? 'Yes' : 'No'}`);
    lines.push(`Status,${budget.paused ? 'Paused' : 'Active'}`);
    lines.push(`Report Generated,${new Date().toISOString()}`);

    fs.writeFileSync(reportFile, lines.join('\n'));

    return {
      file_path: reportFile,
      total_cost: usage.total_cost,
      total_frames: usage.completed_frames,
      total_gpu_hours: this._msToHours(usage.consumed_gpu_hours_ms),
      over_budget: budget.over_budget
    };
  }

  getAllBudgetStatuses() {
    const results = [];
    for (const jobId of this.budgets.keys()) {
      results.push(this.getBudgetStatus(jobId));
    }
    return results.filter(Boolean);
  }

  _msToHours(ms) {
    return ms / (1000 * 60 * 60);
  }
}

module.exports = BudgetController;
