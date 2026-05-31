class EyeTrackerApp {
    constructor() {
        this.settings = this.loadSettings();
        this.wsClient = null;
        this.heatmap = null;
        this.trajectory = null;
        this.pupilChart = null;
        this.aoiManager = null;
        this.sankeyChart = null;
        this.trajectoryReplay = null;
        
        this.displayMode = 'heatmap';
        this.realtimeData = [];
        this.analysisData = [];
        this.mineResult = null;
        this.stats = {
            total: 0,
            valid: 0,
            filtered: 0
        };
        
        this.anomalyToastTimeout = null;
        
        this.init();
    }

    loadSettings() {
        const defaults = {
            wsUrl: 'ws://localhost:8080',
            apiUrl: 'http://localhost:3001',
            screenWidth: 1920,
            screenHeight: 1080,
            pupilThreshold: 0.2,
            heatmapRadius: 50,
            trailWidth: 2,
            showGrid: true,
            heatmapDecay: 5,
            trailLength: 50
        };
        
        try {
            const saved = localStorage.getItem('eyetracker_settings');
            return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
        } catch {
            return defaults;
        }
    }

    saveSettings() {
        localStorage.setItem('eyetracker_settings', JSON.stringify(this.settings));
    }

    init() {
        this.initCanvasElements();
        this.initVisualizations();
        this.initEventListeners();
        this.connectWebSocket();
        this.applySettings();
        this.updateTimeInputs();
    }

    initCanvasElements() {
        this.mainCanvas = document.getElementById('main-canvas');
        this.analysisCanvas = document.getElementById('analysis-canvas');
        this.pupilCanvas = document.getElementById('pupil-chart');
    }

    initVisualizations() {
        this.heatmap = new Heatmap(this.mainCanvas, {
            radius: this.settings.heatmapRadius,
            decayTime: this.settings.heatmapDecay * 1000,
            showGrid: this.settings.showGrid
        });
        
        this.trajectory = new Trajectory(this.mainCanvas, {
            maxTrailLength: this.settings.trailLength,
            lineWidth: this.settings.trailWidth,
            showGrid: this.settings.showGrid
        });
        
        this.pupilChart = new PupilChart(this.pupilCanvas);
        
        this.aoiManager = new AOIManager(this.analysisCanvas, {
            apiUrl: this.settings.apiUrl
        });
        
        this.sankeyChart = new SankeyChart('sankey-container');
        this.sankeyChart.onSequenceClick = (data) => this.handleSequenceClick(data);
        
        const replayCanvas = document.getElementById('replay-canvas');
        this.trajectoryReplay = new TrajectoryReplay(replayCanvas);
        this.trajectoryReplay.onProgress = (progress) => {
            document.getElementById('replay-progress-bar').value = Math.round(progress * 100);
            document.getElementById('replay-time').textContent = Math.round(progress * 100) + '%';
        };
        this.trajectoryReplay.onComplete = () => {
            document.getElementById('btn-replay-play').textContent = '播放';
        };
    }

    initEventListeners() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchView(e.target.dataset.view));
        });
        
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setDisplayMode(e.target.id.replace('btn-', '')));
        });
        
        document.querySelectorAll('.aoi-tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.aoi-tool-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.aoiManager.setTool(e.target.dataset.tool);
            });
        });
        
        document.getElementById('heatmap-decay').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.settings.heatmapDecay = value;
            document.getElementById('decay-value').textContent = value + 's';
            this.heatmap.setDecayTime(value * 1000);
        });
        
        document.getElementById('trail-length').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.settings.trailLength = value;
            document.getElementById('trail-value').textContent = value;
            this.trajectory.setMaxTrailLength(value);
        });
        
        document.getElementById('btn-clear').addEventListener('click', () => {
            this.heatmap.clear();
            this.trajectory.clear();
            this.pupilChart.clear();
            this.realtimeData = [];
        });
        
        document.getElementById('btn-load-data').addEventListener('click', () => this.loadAnalysisData());
        document.getElementById('btn-quick-load').addEventListener('click', () => this.loadRecentData(5 * 60 * 1000));
        document.getElementById('btn-aoi-clear').addEventListener('click', () => {
            this.aoiManager.clearAOIs();
            this.updateAOIList();
        });
        document.getElementById('btn-analyze').addEventListener('click', () => this.runAnalysis());
        document.getElementById('btn-save-settings').addEventListener('click', () => this.saveAndApplySettings());
        
        this.aoiManager.on('aoiAdded', () => this.updateAOIList());
        this.aoiManager.on('aoiRemoved', () => this.updateAOIList());
        this.aoiManager.on('aoisCleared', () => this.updateAOIList());
        this.aoiManager.on('analysisComplete', (result) => this.displayAnalysisResults(result));
        
        document.getElementById('btn-mine-sequence').addEventListener('click', () => this.mineSequences());
        
        document.getElementById('btn-replay-play').addEventListener('click', () => {
            if (this.trajectoryReplay.isPlaying) {
                this.trajectoryReplay.pause();
                document.getElementById('btn-replay-play').textContent = '播放';
            } else {
                this.trajectoryReplay.play();
                document.getElementById('btn-replay-play').textContent = '播放中...';
            }
        });
        document.getElementById('btn-replay-pause').addEventListener('click', () => {
            this.trajectoryReplay.pause();
            document.getElementById('btn-replay-play').textContent = '播放';
        });
        document.getElementById('btn-replay-stop').addEventListener('click', () => {
            this.trajectoryReplay.stop();
            document.getElementById('btn-replay-play').textContent = '播放';
        });
        document.getElementById('replay-speed').addEventListener('change', (e) => {
            this.trajectoryReplay.setSpeed(parseFloat(e.target.value));
        });
        document.getElementById('replay-progress-bar').addEventListener('input', (e) => {
            this.trajectoryReplay.seekTo(parseInt(e.target.value) / 100);
        });
        document.getElementById('btn-replay-close').addEventListener('click', () => {
            this.trajectoryReplay.destroy();
            document.getElementById('replay-container').style.display = 'none';
        });
        
        window.addEventListener('resize', () => {
            this.heatmap.resize();
            this.trajectory.resize();
            this.pupilChart.resize();
            this.aoiManager.resize();
        });
        
        setInterval(() => this.updatePupilStats(), 500);
        setInterval(() => this.updateRealtimeDisplay(), 40);
    }

    connectWebSocket() {
        if (this.wsClient) {
            this.wsClient.disconnect();
        }
        
        this.wsClient = new WebSocketClient(this.settings.wsUrl);
        
        this.wsClient.on('connected', () => {
            this.updateConnectionStatus(true);
        });
        
        this.wsClient.on('disconnected', () => {
            this.updateConnectionStatus(false);
        });
        
        this.wsClient.on('aggregatedData', (data) => {
            this.handleAggregatedData(data);
        });
        
        this.wsClient.on('stats', (data) => {
            this.updateStats(data);
        });
        
        this.wsClient.on('welcome', (data) => {
            console.log('Connected to server:', data);
        });
        
        this.wsClient.on('anomaly', (data) => {
            this.handleAnomalyAlert(data);
        });
        
        this.wsClient.connect().catch(err => {
            console.error('WebSocket connection failed:', err);
        });
    }

    handleAggregatedData(data) {
        const point = data.aggregated;
        
        this.realtimeData.push(point);
        if (this.realtimeData.length > 1000) {
            this.realtimeData.shift();
        }
        
        this.stats.total += data.count;
        this.stats.valid += data.count;
        
        if (this.displayMode === 'heatmap' || this.displayMode === 'both') {
            this.heatmap.addPoint(point.x, point.y, point.timestamp);
        }
        
        if (this.displayMode === 'trajectory' || this.displayMode === 'both') {
            this.trajectory.addPoint(point.x, point.y, point.pupilDiameter, point.timestamp);
        }
        
        this.pupilChart.addPoint(point.pupilDiameter, point.timestamp);
        this.updateCursorIndicator(point);
    }

    updateStats(stats) {
        document.getElementById('stat-total').textContent = stats.rawPacketsReceived?.toLocaleString() || this.stats.total.toLocaleString();
        document.getElementById('stat-valid').textContent = stats.validDataPoints?.toLocaleString() || this.stats.valid.toLocaleString();
        document.getElementById('stat-filtered').textContent = stats.invalidDataPoints?.toLocaleString() || this.stats.filtered.toLocaleString();
        document.getElementById('stat-clients').textContent = stats.serverStatus?.connectedClients || 0;
        document.getElementById('data-rate').textContent = `${stats.packetsPerSecond || 0} 点/秒`;
        
        if (stats.uptimeMs) {
            const uptime = Math.floor(stats.uptimeMs / 1000);
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = uptime % 60;
            document.getElementById('uptime').textContent = 
                `运行时间: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connection-status');
        if (connected) {
            statusEl.classList.remove('disconnected');
            statusEl.classList.add('connected');
            statusEl.querySelector('.status-text').textContent = '已连接';
        } else {
            statusEl.classList.remove('connected');
            statusEl.classList.add('disconnected');
            statusEl.querySelector('.status-text').textContent = '未连接';
        }
    }

    updateCursorIndicator(point) {
        const indicator = document.getElementById('cursor-indicator');
        const container = document.querySelector('.main-canvas-container');
        const rect = container.getBoundingClientRect();
        const scaleX = rect.width / this.settings.screenWidth;
        const scaleY = rect.height / this.settings.screenHeight;
        
        indicator.style.left = (point.x * scaleX) + 'px';
        indicator.style.top = (point.y * scaleY) + 'px';
        indicator.classList.add('active');
    }

    switchView(view) {
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        
        document.querySelector(`.nav-btn[data-view="${view}"]`).classList.add('active');
        document.getElementById(`${view}-view`).classList.add('active');
        
        if (view === 'realtime') {
            this.heatmap.startAnimation();
            this.trajectory.startAnimation();
            this.pupilChart.startAnimation();
        } else {
            this.heatmap.stopAnimation();
            this.trajectory.stopAnimation();
            this.pupilChart.stopAnimation();
        }
        
        if (view === 'analysis') {
            setTimeout(() => this.aoiManager.resize(), 100);
        }
    }

    setDisplayMode(mode) {
        this.displayMode = mode;
        
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`btn-${mode}`).classList.add('active');
        
        this.heatmap.clear();
        this.trajectory.clear();
        
        if (mode === 'heatmap') {
            this.heatmap.startAnimation();
            this.trajectory.stopAnimation();
        } else if (mode === 'trajectory') {
            this.heatmap.stopAnimation();
            this.trajectory.startAnimation();
        } else {
            this.heatmap.startAnimation();
            this.trajectory.startAnimation();
        }
        
        this.realtimeData.forEach(point => {
            if (mode === 'heatmap' || mode === 'both') {
                this.heatmap.addPoint(point.x, point.y, point.timestamp);
            }
            if (mode === 'trajectory' || mode === 'both') {
                this.trajectory.addPoint(point.x, point.y, point.pupilDiameter, point.timestamp);
            }
        });
    }

    updateRealtimeDisplay() {
        if (this.displayMode === 'heatmap' || this.displayMode === 'both') {
            this.heatmap.draw();
        }
        if (this.displayMode === 'trajectory' || this.displayMode === 'both') {
            this.trajectory.draw();
        }
    }

    updatePupilStats() {
        const stats = this.pupilChart.getStats();
        document.getElementById('pupil-current').textContent = 
            stats.current ? stats.current.toFixed(2) + ' mm' : '--';
        document.getElementById('pupil-avg').textContent = 
            stats.average ? stats.average.toFixed(2) + ' mm' : '--';
        document.getElementById('pupil-min').textContent = 
            stats.min ? stats.min.toFixed(2) + ' mm' : '--';
        document.getElementById('pupil-max').textContent = 
            stats.max ? stats.max.toFixed(2) + ' mm' : '--';
    }

    updateTimeInputs() {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        
        document.getElementById('time-end').value = now.toISOString().slice(0, 16);
        document.getElementById('time-start').value = oneHourAgo.toISOString().slice(0, 16);
    }

    async loadAnalysisData() {
        const startStr = document.getElementById('time-start').value;
        const endStr = document.getElementById('time-end').value;
        
        if (!startStr || !endStr) {
            alert('请选择时间范围');
            return;
        }
        
        const startTime = new Date(startStr).getTime();
        const endTime = new Date(endStr).getTime();
        
        try {
            const response = await fetch(
                `${this.settings.apiUrl}/api/data/range?start=${startTime}&end=${endTime}`
            );
            const result = await response.json();
            
            if (result.success && result.data.length > 0) {
                this.analysisData = result.data;
                this.aoiManager.drawStaticData(result.data, this.aoiManager.getAOIs());
                alert(`加载成功：${result.data.length} 个数据点`);
            } else {
                alert('未找到数据');
            }
        } catch (err) {
            console.error('Load data error:', err);
            alert('加载数据失败：' + err.message);
        }
    }

    async loadRecentData(durationMs) {
        const endTime = Date.now();
        const startTime = endTime - durationMs;
        
        try {
            const response = await fetch(
                `${this.settings.apiUrl}/api/data/range?start=${startTime}&end=${endTime}`
            );
            const result = await response.json();
            
            if (result.success && result.data.length > 0) {
                this.analysisData = result.data;
                this.trajectory.drawStaticData(result.data, this.aoiManager.getAOIs());
                alert(`加载成功：${result.data.length} 个数据点`);
            } else {
                alert('未找到数据，请确保模拟器正在运行');
            }
        } catch (err) {
            console.error('Load recent data error:', err);
            alert('加载数据失败：' + err.message);
        }
    }

    updateAOIList() {
        const listEl = document.getElementById('aoi-list');
        const aois = this.aoiManager.getAOIs();
        
        if (aois.length === 0) {
            listEl.innerHTML = '<p class="empty-hint">在画布上绘制AOI区域</p>';
            return;
        }
        
        listEl.innerHTML = aois.map(aoi => `
            <div class="aoi-item" style="border-left-color: ${aoi.color}">
                <div class="aoi-color" style="background: ${aoi.color}"></div>
                <input type="text" class="aoi-name" value="${aoi.name}" 
                       onchange="app.updateAOIName('${aoi.id}', this.value)"
                       style="flex: 1; background: transparent; border: none; color: #e4e4e7; font-size: 0.875rem; padding: 0.25rem;">
                <button class="aoi-delete" onclick="app.deleteAOI('${aoi.id}')">删除</button>
            </div>
        `).join('');
    }

    updateAOIName(aoiId, name) {
        this.aoiManager.updateAOIName(aoiId, name);
    }

    deleteAOI(aoiId) {
        this.aoiManager.removeAOI(aoiId);
    }

    async runAnalysis() {
        const aois = this.aoiManager.getAOIs();
        if (aois.length === 0) {
            alert('请先创建至少一个AOI区域');
            return;
        }
        
        if (this.analysisData.length === 0) {
            alert('请先加载数据');
            return;
        }
        
        try {
            const result = await this.aoiManager.analyze(null, null, this.analysisData);
            this.displayAnalysisResults(result);
        } catch (err) {
            console.error('Analysis error:', err);
            alert('分析失败：' + err.message);
        }
    }

    displayAnalysisResults(result) {
        const resultsEl = document.getElementById('analysis-results');
        
        if (!result.aoiResults || Object.keys(result.aoiResults).length === 0) {
            resultsEl.innerHTML = '<p class="empty-hint">无分析结果</p>';
            return;
        }
        
        const aois = this.aoiManager.getAOIs();
        
        resultsEl.innerHTML = Object.values(result.aoiResults).map(aoiResult => {
            const aoi = aois.find(a => a.id === aoiResult.aoiId);
            const color = aoi ? aoi.color : '#3b82f6';
            
            return `
                <div class="aoi-result-card" style="border-left-color: ${color}">
                    <h4 style="color: ${color}">${aoiResult.aoiName}</h4>
                    <div class="aoi-result-stats">
                        <div class="aoi-result-stat">
                            首次进入时间
                            <strong>${aoiResult.firstEntryTime ? this.formatTime(aoiResult.firstEntryTime) : '--'}</strong>
                        </div>
                        <div class="aoi-result-stat">
                            总停留时长
                            <strong>${this.formatDuration(aoiResult.totalDuration)}</strong>
                        </div>
                        <div class="aoi-result-stat">
                            回访次数
                            <strong>${aoiResult.revisitCount}</strong>
                        </div>
                        <div class="aoi-result-stat">
                            注视次数
                            <strong>${aoiResult.totalFixations}</strong>
                        </div>
                        <div class="aoi-result-stat">
                            平均注视时长
                            <strong>${this.formatDuration(aoiResult.avgFixationDuration)}</strong>
                        </div>
                        <div class="aoi-result-stat">
                            停留占比
                            <strong>${aoiResult.dwellTimePercentage.toFixed(1)}%</strong>
                        </div>
                        <div class="aoi-result-stat">
                            内部点数
                            <strong>${aoiResult.pointsInsideCount}</strong>
                        </div>
                        <div class="aoi-result-stat">
                            平均瞳孔直径
                            <strong>${aoiResult.pupilDiameterAvg ? aoiResult.pupilDiameterAvg.toFixed(2) + ' mm' : '--'}</strong>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        if (result.scanPath && result.scanPath.length > 0) {
            document.getElementById('scanpath-container').style.display = 'block';
            document.getElementById('scanpath-list').innerHTML = result.scanPath.map((item, i) => `
                <span class="scanpath-item">
                    <span class="scanpath-index">${i + 1}</span>
                    <span>${item.aoiName}</span>
                    <span style="color: #64748b; font-size: 0.625rem;">${this.formatTime(item.timestamp)}</span>
                </span>
                ${i < result.scanPath.length - 1 ? '<span class="scanpath-arrow">→</span>' : ''}
            `).join('');
        }
        
        if (result.transitionMatrix) {
            document.getElementById('transition-container').style.display = 'block';
            this.displayTransitionMatrix(result.transitionMatrix, aois);
        }
    }

    displayTransitionMatrix(matrix, aois) {
        const aoiIds = aois.map(a => a.id);
        const allIds = [...aoiIds, 'other'];
        const aoiNames = { ...Object.fromEntries(aois.map(a => [a.id, a.name])), other: '其他' };
        
        let html = '<table class="transition-table"><thead><tr><th>从\\到</th>';
        allIds.forEach(id => {
            html += `<th>${aoiNames[id]}</th>`;
        });
        html += '</tr></thead><tbody>';
        
        allIds.forEach(fromId => {
            html += `<tr><th>${aoiNames[fromId]}</th>`;
            allIds.forEach(toId => {
                const count = matrix[fromId]?.[toId] || 0;
                const highlight = count > 0 ? 'highlight' : '';
                html += `<td class="${highlight}">${count}</td>`;
            });
            html += '</tr>';
        });
        
        html += '</tbody></table>';
        document.getElementById('transition-matrix').innerHTML = html;
    }

    async mineSequences() {
        const aois = this.aoiManager.getAOIs();
        if (aois.length === 0) {
            alert('请先创建至少一个AOI区域');
            return;
        }
        
        if (this.analysisData.length === 0) {
            alert('请先加载数据');
            return;
        }
        
        const minSupport = parseFloat(document.getElementById('min-support').value) || 0.05;
        const maxPatternLength = parseInt(document.getElementById('max-pattern-length').value) || 10;
        
        try {
            const response = await fetch(`${this.settings.apiUrl}/api/sequence/mine`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    aois,
                    data: this.analysisData,
                    minSupport,
                    maxPatternLength
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.mineResult = result;
                this.displaySequenceResults(result);
            } else {
                alert('序列挖掘失败：' + (result.error || '未知错误'));
            }
        } catch (err) {
            console.error('Sequence mining error:', err);
            alert('序列挖掘失败：' + err.message);
        }
    }

    displaySequenceResults(result) {
        document.getElementById('sequence-container').style.display = 'block';
        
        const { patterns, sankeyData, stats, scanPath } = result;
        
        document.getElementById('sequence-stats').innerHTML = 
            `总序列数: ${stats.totalSequences} | 频繁模式数: ${stats.patternCount} | 最小支持度: ${(stats.minSupportRate * 100).toFixed(1)}%`;
        
        this.sankeyChart.setData(sankeyData, patterns, scanPath);
        
        const aoiMap = {};
        this.aoiManager.getAOIs().forEach(a => { aoiMap[a.id] = a.name; });
        
        const patternList = document.getElementById('pattern-list');
        patternList.innerHTML = patterns.slice(0, 20).map((p, i) => {
            const seqHtml = p.pattern.map((id, j) => {
                const name = aoiMap[id] || id;
                return j < p.pattern.length - 1 
                    ? `${name}<span class="arrow"> → </span>` 
                    : name;
            }).join('');
            
            return `
                <div class="pattern-item" data-index="${i}">
                    <span class="pattern-sequence">${seqHtml}</span>
                    <span class="pattern-support">${(p.supportRate * 100).toFixed(1)}% (${p.support}次)</span>
                </div>
            `;
        }).join('');
        
        patternList.querySelectorAll('.pattern-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.index);
                this.startReplayForPattern(patterns[idx]);
            });
        });
    }

    handleSequenceClick(data) {
        if (data.type === 'link') {
            const { link } = data;
            this.startReplayForTransition(link.sourceAOI, link.targetAOI);
        } else if (data.type === 'node') {
            const { node } = data;
            this.startReplayForAOI(node.aoiId);
        }
    }

    startReplayForPattern(pattern) {
        if (!this.mineResult || !this.mineResult.scanPath) return;
        
        const scanPath = this.mineResult.scanPath;
        const patternAOIs = pattern.pattern;
        
        let startIdx = -1;
        let endIdx = -1;
        
        for (let i = 0; i <= scanPath.length - patternAOIs.length; i++) {
            let match = true;
            for (let j = 0; j < patternAOIs.length; j++) {
                if (scanPath[i + j].aoiId !== patternAOIs[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                startIdx = i;
                endIdx = i + patternAOIs.length - 1;
                break;
            }
        }
        
        if (startIdx >= 0 && endIdx >= 0) {
            const startTime = scanPath[startIdx].timestamp;
            const endTime = scanPath[endIdx].timestamp;
            this.openReplayPanel(startTime - 2000, endTime + 2000);
        }
    }

    startReplayForTransition(sourceAOI, targetAOI) {
        if (!this.mineResult || !this.mineResult.scanPath) return;
        
        const scanPath = this.mineResult.scanPath;
        for (let i = 0; i < scanPath.length - 1; i++) {
            if (scanPath[i].aoiId === sourceAOI && scanPath[i + 1].aoiId === targetAOI) {
                const startTime = scanPath[i].timestamp - 2000;
                const endTime = scanPath[i + 1].timestamp + 2000;
                this.openReplayPanel(startTime, endTime);
                return;
            }
        }
    }

    startReplayForAOI(aoiId) {
        if (!this.mineResult || !this.mineResult.scanPath) return;
        
        const scanPath = this.mineResult.scanPath;
        const entry = scanPath.find(s => s.aoiId === aoiId);
        if (entry) {
            this.openReplayPanel(entry.timestamp - 3000, entry.timestamp + 3000);
        }
    }

    openReplayPanel(startTime, endTime) {
        document.getElementById('replay-container').style.display = 'block';
        
        const aois = this.aoiManager.getAOIs();
        this.trajectoryReplay.loadSequence(this.analysisData, aois, { startTime, endTime });
        this.trajectoryReplay.resize();
        this.trajectoryReplay.drawFrame();
        
        document.getElementById('replay-progress-bar').value = 0;
        document.getElementById('replay-time').textContent = '0%';
    }

    handleAnomalyAlert(data) {
        if (data.type !== 'anomaly') return;
        
        const toast = document.getElementById('anomaly-toast');
        const detail = document.getElementById('anomaly-detail');
        
        const title = data.alertType === 'possible_fatigue' ? '可能疲劳' : '瞳孔异常收缩';
        const severityText = { low: '低', medium: '中', high: '高', critical: '极高' }[data.severity] || '中';
        
        toast.querySelector('.anomaly-toast-title').textContent = title;
        detail.textContent = `瞳孔直径: ${data.pupilDiameter?.toFixed(2)}mm | 偏差: ${data.zScore?.toFixed(1)}σ | 严重程度: ${severityText}`;
        
        toast.style.display = 'flex';
        
        if (data.severity === 'critical') {
            toast.style.background = 'rgba(220, 38, 38, 0.95)';
            toast.style.boxShadow = '0 8px 32px rgba(220, 38, 38, 0.5)';
        } else if (data.severity === 'high') {
            toast.style.background = 'rgba(239, 68, 68, 0.95)';
            toast.style.boxShadow = '0 8px 32px rgba(239, 68, 68, 0.4)';
        } else {
            toast.style.background = 'rgba(245, 158, 11, 0.95)';
            toast.style.boxShadow = '0 8px 32px rgba(245, 158, 11, 0.4)';
        }
        
        if (this.anomalyToastTimeout) {
            clearTimeout(this.anomalyToastTimeout);
        }
        
        this.anomalyToastTimeout = setTimeout(() => {
            toast.style.display = 'none';
        }, 8000);
    }

    formatTime(timestamp) {
        if (!timestamp) return '--';
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-CN', { hour12: false });
    }

    formatDuration(ms) {
        if (!ms || ms < 1000) return (ms || 0).toFixed(0) + ' ms';
        return (ms / 1000).toFixed(2) + ' s';
    }

    applySettings() {
        document.getElementById('ws-url').value = this.settings.wsUrl;
        document.getElementById('api-url').value = this.settings.apiUrl;
        document.getElementById('screen-width').value = this.settings.screenWidth;
        document.getElementById('screen-height').value = this.settings.screenHeight;
        document.getElementById('pupil-threshold').value = this.settings.pupilThreshold;
        document.getElementById('heatmap-radius').value = this.settings.heatmapRadius;
        document.getElementById('trail-width').value = this.settings.trailWidth;
        document.getElementById('show-grid').checked = this.settings.showGrid;
        document.getElementById('heatmap-decay').value = this.settings.heatmapDecay;
        document.getElementById('trail-length').value = this.settings.trailLength;
        document.getElementById('decay-value').textContent = this.settings.heatmapDecay + 's';
        document.getElementById('trail-value').textContent = this.settings.trailLength;
    }

    saveAndApplySettings() {
        this.settings.wsUrl = document.getElementById('ws-url').value;
        this.settings.apiUrl = document.getElementById('api-url').value;
        this.settings.screenWidth = parseInt(document.getElementById('screen-width').value);
        this.settings.screenHeight = parseInt(document.getElementById('screen-height').value);
        this.settings.pupilThreshold = parseFloat(document.getElementById('pupil-threshold').value);
        this.settings.heatmapRadius = parseInt(document.getElementById('heatmap-radius').value);
        this.settings.trailWidth = parseInt(document.getElementById('trail-width').value);
        this.settings.showGrid = document.getElementById('show-grid').checked;
        
        this.saveSettings();
        
        this.heatmap.setRadius(this.settings.heatmapRadius);
        this.heatmap.setShowGrid(this.settings.showGrid);
        this.trajectory.setLineWidth(this.settings.trailWidth);
        this.trajectory.setShowGrid(this.settings.showGrid);
        
        this.connectWebSocket();
        
        alert('设置已保存');
    }
}

const app = new EyeTrackerApp();

setTimeout(() => {
    app.heatmap.startAnimation();
    app.trajectory.startAnimation();
    app.pupilChart.startAnimation();
}, 100);
