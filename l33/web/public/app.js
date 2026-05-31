const socket = io();
let selectedFile = null;

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const settingsPanel = document.getElementById('settingsPanel');
const submitBtn = document.getElementById('submitBtn');
const jobsList = document.getElementById('jobsList');
const nodesList = document.getElementById('nodesList');
const budgetsList = document.getElementById('budgetsList');
const jobModal = document.getElementById('jobModal');
const modalJobName = document.getElementById('modalJobName');
const jobDetails = document.getElementById('jobDetails');
const framesGrid = document.getElementById('framesGrid');

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.endsWith('.blend')) {
        selectFile(files[0]);
    } else {
        alert('请上传 .blend 文件');
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        selectFile(e.target.files[0]);
    }
});

function selectFile(file) {
    selectedFile = file;
    dropZone.innerHTML = `
        <div class="drop-icon">✅</div>
        <p>${file.name}</p>
        <p class="sub-text">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
    `;
    settingsPanel.style.display = 'block';
    document.getElementById('jobName').value = file.name.replace('.blend', '');
}

const prioritySlider = document.getElementById('priority');
const priorityValue = document.getElementById('priorityValue');
prioritySlider.addEventListener('input', () => {
    priorityValue.textContent = prioritySlider.value;
});

submitBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    
    const maxFrames = parseInt(document.getElementById('maxFrames').value) || 0;
    const maxGpuHours = parseFloat(document.getElementById('maxGpuHours').value) || 0;
    const costPerGpuHour = parseFloat(document.getElementById('costPerGpuHour').value) || 0;
    
    const formData = new FormData();
    formData.append('blendFile', selectedFile);
    formData.append('settings', JSON.stringify({
        name: document.getElementById('jobName').value,
        priority: parseInt(document.getElementById('priority').value),
        start_frame: parseInt(document.getElementById('startFrame').value),
        end_frame: parseInt(document.getElementById('endFrame').value),
        resolution_x: parseInt(document.getElementById('resX').value),
        resolution_y: parseInt(document.getElementById('resY').value),
        engine: document.getElementById('engine').value,
        samples: parseInt(document.getElementById('samples').value),
        fps: parseInt(document.getElementById('fps').value),
        max_frames: maxFrames,
        max_gpu_hours: maxGpuHours,
        cost_per_gpu_hour: costPerGpuHour
    }));
    
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';
    
    try {
        const response = await fetch('/api/jobs', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const result = await response.json();
            let msg = '任务提交成功！';
            if (maxFrames > 0 || maxGpuHours > 0) {
                msg += `\n预算: ${maxFrames > 0 ? `最多${maxFrames}帧` : ''}${maxGpuHours > 0 ? ` ${maxGpuHours} GPU小时` : ''}`;
                if (costPerGpuHour > 0) {
                    msg += `\n费率: $${costPerGpuHour}/GPU小时`;
                }
            }
            alert(msg);
            resetUpload();
        } else {
            const error = await response.json();
            alert('提交失败: ' + error.error);
        }
    } catch (e) {
        alert('提交失败: ' + e.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '开始渲染';
    }
});

function resetUpload() {
    selectedFile = null;
    dropZone.innerHTML = `
        <div class="drop-icon">📁</div>
        <p>拖拽 .blend 文件到此处</p>
        <p class="sub-text">或点击选择文件</p>
    `;
    settingsPanel.style.display = 'none';
    fileInput.value = '';
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab + 'Tab').classList.add('active');
    });
});

document.querySelector('.close-btn').addEventListener('click', () => {
    jobModal.style.display = 'none';
});

jobModal.addEventListener('click', (e) => {
    if (e.target === jobModal) {
        jobModal.style.display = 'none';
    }
});

socket.on('statusUpdate', (data) => {
    updateStatusBar(data);
    updateJobsList(data.jobs);
    updateNodesList(data.nodes);
    updateBudgetsList(data.budgets);
});

socket.on('taskProgress', (data) => {
});

socket.on('jobComplete', async (job) => {
    await fetch(`/api/jobs/${job.id}/encode`, { method: 'POST' });
});

socket.on('budgetAlert', (data) => {
    showBudgetAlert(data);
});

function showBudgetAlert(budgetStatus) {
    const alert = document.createElement('div');
    alert.className = 'budget-alert';
    alert.innerHTML = `⚠️ 预算超限！任务 ${budgetStatus.job_id.substring(0, 8)}... 已暂停<br>已消费 $${budgetStatus.total_cost.toFixed(2)}`;
    document.body.appendChild(alert);
    
    setTimeout(() => {
        alert.remove();
    }, 10000);
}

function updateStatusBar(data) {
    document.getElementById('nodeCount').textContent = `节点: ${data.nodes.length}`;
    document.getElementById('queueCount').textContent = `队列: ${data.queueSize}`;
}

function updateJobsList(jobs) {
    if (jobs.length === 0) {
        jobsList.innerHTML = '<div class="empty-state">暂无渲染任务</div>';
        return;
    }
    
    jobsList.innerHTML = jobs.map(job => {
        const progress = job.total_tasks > 0 
            ? Math.round((job.completed_tasks / job.total_tasks) * 100) 
            : 0;
        
        const etaText = job.estimated_completion 
            ? formatETA(job.estimated_completion - Date.now())
            : '计算中...';
        
        return `
            <div class="job-card" data-job-id="${job.id}">
                <div class="job-header">
                    <span class="job-name">${job.name}</span>
                    <span class="job-status status-${job.status}">${getStatusText(job.status)}</span>
                </div>
                <div class="job-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress}%"></div>
                    </div>
                    <div class="progress-text">
                        <span>${job.completed_tasks}/${job.total_tasks} 帧</span>
                        <span>预计: ${etaText}</span>
                    </div>
                </div>
                <div class="job-meta">
                    <span class="job-priority">优先级 ${job.priority}</span>
                    <span>${job.settings.engine}</span>
                    <span>${job.settings.resolution_x}x${job.settings.resolution_y}</span>
                </div>
            </div>
        `;
    }).join('');
    
    document.querySelectorAll('.job-card').forEach(card => {
        card.addEventListener('click', () => showJobDetails(card.dataset.jobId));
    });
}

function updateNodesList(nodes) {
    if (nodes.length === 0) {
        nodesList.innerHTML = '<div class="empty-state">暂无连接节点</div>';
        return;
    }
    
    nodesList.innerHTML = nodes.map(node => {
        const gpuHtml = node.hardware.gpus.map(gpu => `
            <div class="gpu-item">
                <div class="gpu-name">${gpu.name}</div>
                <div class="gpu-memory">显存: ${(gpu.memory_total / 1024 / 1024 / 1024).toFixed(2)} GB</div>
            </div>
        `).join('');
        
        return `
            <div class="node-card ${node.status}">
                <div class="node-header">
                    <span class="node-name">${node.hardware.node_name}</span>
                    <span class="node-status ${node.status}"></span>
                </div>
                <div class="node-gpus">${gpuHtml || '<div class="gpu-item">未检测到GPU</div>'}</div>
                <div class="node-info">
                    <span>CPU: ${node.hardware.cpu_cores} 核</span>
                    <span>内存: ${(node.hardware.ram_total / 1024 / 1024 / 1024).toFixed(0)} GB</span>
                    <span>负载: ${node.load}%</span>
                </div>
            </div>
        `;
    }).join('');
}

function updateBudgetsList(budgets) {
    if (!budgets || budgets.length === 0) {
        budgetsList.innerHTML = '<div class="empty-state">暂无预算设置</div>';
        return;
    }
    
    budgetsList.innerHTML = budgets.map(b => {
        const framePercent = b.max_frames > 0 ? b.frame_progress : -1;
        const costPercent = b.max_gpu_hours_ms > 0 ? b.cost_progress : -1;
        
        const statusClass = b.over_budget ? 'over-budget' : (b.paused ? 'paused-budget' : 'active');
        const statusText = b.over_budget ? '超预算' : (b.paused ? '已暂停' : '正常');
        const cardClass = b.over_budget ? 'over-budget' : (b.paused ? 'paused' : '');
        
        const frameProgressClass = framePercent > 90 ? 'danger' : (framePercent > 70 ? 'warning' : 'ok');
        const costProgressClass = costPercent > 90 ? 'danger' : (costPercent > 70 ? 'warning' : 'ok');
        
        return `
            <div class="budget-card ${cardClass}">
                <div class="budget-header">
                    <span class="budget-job-name">${b.job_id.substring(0, 8)}...</span>
                    <span class="budget-status ${statusClass}">${statusText}</span>
                </div>
                <div class="budget-metrics">
                    <div class="budget-metric">
                        <div class="budget-metric-label">已完成帧数</div>
                        <div class="budget-metric-value">${b.completed_frames}${b.max_frames > 0 ? ` / ${b.max_frames}` : ''}</div>
                    </div>
                    <div class="budget-metric">
                        <div class="budget-metric-label">GPU 小时</div>
                        <div class="budget-metric-value">${b.gpu_hours_consumed.toFixed(3)}${b.gpu_hours_budget > 0 ? ` / ${b.gpu_hours_budget.toFixed(1)}` : ''}</div>
                    </div>
                    <div class="budget-metric">
                        <div class="budget-metric-label">总费用</div>
                        <div class="budget-metric-value cost">$${b.total_cost.toFixed(4)}</div>
                    </div>
                    <div class="budget-metric">
                        <div class="budget-metric-label">GPU 费率</div>
                        <div class="budget-metric-value">$${b.cost_per_gpu_hour.toFixed(2)}/h</div>
                    </div>
                </div>
                ${framePercent >= 0 ? `
                    <div class="budget-progress">
                        <div class="budget-progress-label">
                            <span>帧数进度</span>
                            <span>${framePercent}%</span>
                        </div>
                        <div class="budget-progress-bar">
                            <div class="budget-progress-fill ${frameProgressClass}" style="width: ${framePercent}%"></div>
                        </div>
                    </div>
                ` : ''}
                ${costPercent >= 0 ? `
                    <div class="budget-progress">
                        <div class="budget-progress-label">
                            <span>预算进度</span>
                            <span>${costPercent}%</span>
                        </div>
                        <div class="budget-progress-bar">
                            <div class="budget-progress-fill ${costProgressClass}" style="width: ${costPercent}%"></div>
                        </div>
                    </div>
                ` : ''}
                <div class="budget-actions">
                    ${b.paused || b.over_budget ? `
                        <button class="budget-btn resume" onclick="resumeBudget('${b.job_id}')">恢复渲染</button>
                    ` : `
                        <button class="budget-btn pause" onclick="pauseBudget('${b.job_id}')">暂停渲染</button>
                    `}
                    <button class="budget-btn report" onclick="downloadReport('${b.job_id}')">下载费用报告</button>
                </div>
            </div>
        `;
    }).join('');
}

async function pauseBudget(jobId) {
    await fetch(`/api/jobs/${jobId}/budget/pause`, { method: 'POST' });
}

async function resumeBudget(jobId) {
    await fetch(`/api/jobs/${jobId}/budget/resume`, { method: 'POST' });
}

async function downloadReport(jobId) {
    window.open(`/api/jobs/${jobId}/cost-report/download`, '_blank');
}

async function showJobDetails(jobId) {
    try {
        const response = await fetch(`/api/jobs/${jobId}`);
        const data = await response.json();
        
        modalJobName.textContent = data.job.name;
        
        const totalTime = data.job.completed_at && data.job.started_at
            ? formatDuration(data.job.completed_at - data.job.started_at)
            : data.job.started_at
                ? '进行中'
                : '未开始';
        
        let budgetHtml = '';
        try {
            const budgetRes = await fetch(`/api/jobs/${jobId}/budget`);
            if (budgetRes.ok) {
                const budget = await budgetRes.json();
                budgetHtml = `
                    <div class="detail-row">
                        <span class="detail-label">GPU 费用</span>
                        <span class="budget-metric-value cost">$${budget.total_cost.toFixed(4)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">GPU 小时</span>
                        <span>${budget.gpu_hours_consumed.toFixed(3)} h</span>
                    </div>
                    ${budget.over_budget ? `
                        <div class="detail-row" style="color: #f87171;">
                            <span>⚠️ 超预算</span>
                            <span>
                                <button class="budget-btn resume" onclick="resumeBudget('${jobId}')">恢复</button>
                                <button class="budget-btn report" onclick="downloadReport('${jobId}')">费用报告</button>
                            </span>
                        </div>
                    ` : ''}
                `;
            }
        } catch (e) {}
        
        jobDetails.innerHTML = `
            <div class="detail-row">
                <span class="detail-label">状态</span>
                <span>${getStatusText(data.job.status)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">总帧数</span>
                <span>${data.job.total_tasks} 帧</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">已完成</span>
                <span>${data.job.completed_tasks} 帧</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">失败</span>
                <span>${data.job.failed_tasks} 帧</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">渲染引擎</span>
                <span>${data.job.settings.engine}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">分辨率</span>
                <span>${data.job.settings.resolution_x}x${data.job.settings.resolution_y}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">总耗时</span>
                <span>${totalTime}</span>
            </div>
            ${budgetHtml}
            ${data.job.status === 'completed' ? `
                <a href="/output/${jobId}.mp4" class="download-btn" download>下载 MP4</a>
            ` : ''}
        `;
        
        framesGrid.innerHTML = data.tasks.map(task => `
            <div class="frame-item frame-${task.status}" title="帧 ${task.frame_number}: ${task.status}">
                ${task.frame_number}
            </div>
        `).join('');
        
        jobModal.style.display = 'flex';
    } catch (e) {
        console.error('Failed to load job details:', e);
    }
}

function getStatusText(status) {
    const texts = {
        'pending': '等待中',
        'running': '渲染中',
        'completed': '已完成',
        'failed': '失败'
    };
    return texts[status] || status;
}

function formatETA(ms) {
    if (ms <= 0) return '即将完成';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}小时${minutes % 60}分钟`;
    } else if (minutes > 0) {
        return `${minutes}分钟`;
    } else {
        return `${seconds}秒`;
    }
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}小时${minutes % 60}分${seconds % 60}秒`;
    } else if (minutes > 0) {
        return `${minutes}分${seconds % 60}秒`;
    } else {
        return `${seconds}秒`;
    }
}

async function loadInitialData() {
    try {
        const [jobsRes, nodesRes] = await Promise.all([
            fetch('/api/jobs'),
            fetch('/api/nodes')
        ]);
        
        const jobs = await jobsRes.json();
        const nodes = await nodesRes.json();
        
        updateStatusBar({ nodes, queueSize: 0 });
        updateJobsList(jobs);
        updateNodesList(nodes);
    } catch (e) {
        console.error('Failed to load initial data:', e);
    }
}

loadInitialData();
