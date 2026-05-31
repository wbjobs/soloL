class QuantumVisualizationApp {
    constructor() {
        this.ws = null;
        this.blochSphere = null;
        this.currentState = null;
        this.capturedState1 = null;
        this.capturedState2 = null;
        this.nQubits = 1;
        this.selectedQubit = 0;
        this.circuitData = { nQubits: 1, maxSteps: 8, gates: [] };
        this.heatmapMesh = null;
        this.latexContent = '';

        this.init();
    }

    init() {
        this.initBlochSphere();
        this.initWebSocket();
        this.initEventListeners();
        this.initCircuitEditor();
        this.loadHistory();
        this.loadSavedStates();
    }

    initBlochSphere() {
        this.blochSphere = new BlochSphere('bloch-canvas-container', {
            autoRotate: true,
            showGrid: true,
            showLabels: true,
            pointSize: 5
        });

        this.blochSphere.setOnSphereClick((x, y, z) => {
            this.handleSphereClick(x, y, z);
        });
    }

    initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.hostname}:8000/ws`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.updateConnectionStatus(true);
                if (this.localStateBackup) {
                    this.sendToServer({ action: 'sync_state' });
                } else {
                    this.sendToServer({ action: 'set_qubits', data: { n_qubits: this.nQubits } });
                }
            };

            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                this.handleServerMessage(message);
            };

            this.ws.onclose = () => {
                this.updateConnectionStatus(false);
                setTimeout(() => this.reconnectWebSocket(), 3000);
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus(false);
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.updateConnectionStatus(false);
        }
    }

    reconnectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }
        this.localStateBackup = this.currentState;
        this.initWebSocket();
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');

        if (connected) {
            indicator.className = 'status-indicator connected';
            text.textContent = '已连接';
        } else {
            indicator.className = 'status-indicator disconnected';
            text.textContent = '未连接';
        }
    }

    sendToServer(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('WebSocket not connected, message not sent:', message);
        }
    }

    handleServerMessage(message) {
        switch (message.action) {
            case 'state_update':
                this.handleStateUpdate(message);
                break;
            case 'state_sync':
                this.handleStateSync(message);
                break;
            case 'entanglement_result':
                this.handleEntanglementResult(message);
                break;
            case 'interpolation_step':
                this.handleInterpolationStep(message);
                break;
            case 'interpolation_complete':
                this.handleInterpolationComplete(message);
                break;
            case 'error':
                this.showError(message.message);
                break;
            case 'pong':
                break;
            default:
                console.log('Unknown message type:', message.action);
        }
    }

    handleStateSync(data) {
        this.currentState = data;
        this.nQubits = data.n_qubits;
        this.localStateBackup = null;

        const blochData = data.bloch_spheres[this.selectedQubit];
        if (blochData) {
            this.blochSphere.updateStatePoint(blochData.x, blochData.y, blochData.z);
            this.updateCoordinates(blochData.x, blochData.y, blochData.z);
            this.updateQuaternionInfo(blochData.quaternion);
        }

        this.updateStateDisplay(data);
        this.updateDensityMatrix(data);
        if (data.entanglement_result) {
            this.updateEntanglementDisplay(data.entanglement_result);
        }
        this.updateStateInfo(data);
    }

    handleStateUpdate(data) {
        this.currentState = data;
        this.nQubits = data.n_qubits;

        const blochData = data.bloch_spheres[this.selectedQubit];
        if (blochData) {
            this.blochSphere.updateStatePoint(blochData.x, blochData.y, blochData.z);
            this.updateCoordinates(blochData.x, blochData.y, blochData.z);
            this.updateQuaternionInfo(blochData.quaternion);
        }

        this.updateStateDisplay(data);
        this.updateDensityMatrix(data);
        this.updateEntanglementDisplay(data.entanglement_result || data.entanglement);
        this.updateStateInfo(data);
    }

    handleEntanglementResult(data) {
        this.updateEntanglementDisplay(data);
    }

    handleInterpolationStep(data) {
        this.blochSphere.updateStatePoint(data.x, data.y, data.z, false);
        this.updateCoordinates(data.x, data.y, data.z);
        this.updateQuaternionInfo(data.quaternion);

        const status = document.getElementById('interp-status');
        status.textContent = `插值进度: ${data.step + 1} / ${data.total}`;
    }

    handleInterpolationComplete(data) {
        const status = document.getElementById('interp-status');
        status.textContent = `插值完成! 共 ${data.total_steps} 步`;
        status.className = 'status-text success';
    }

    handleSphereClick(x, y, z) {
        const theta = Math.acos(z);
        const phi = Math.atan2(y, x);

        this.sendToServer({
            action: 'create_state',
            data: {
                n_qubits: 1,
                state_vector: [
                    [Math.cos(theta / 2), 0],
                    [Math.sin(theta / 2) * Math.cos(phi), Math.sin(theta / 2) * Math.sin(phi)]
                ]
            }
        });

        this.showModal(
            'Bloch球坐标',
            `<p><strong>球面坐标:</strong></p>
             <p>θ = ${theta.toFixed(4)} rad (${(theta * 180 / Math.PI).toFixed(1)}°)</p>
             <p>φ = ${phi.toFixed(4)} rad (${(phi * 180 / Math.PI).toFixed(1)}°)</p>
             <p><strong>笛卡尔坐标:</strong></p>
             <p>X = ${x.toFixed(4)}</p>
             <p>Y = ${y.toFixed(4)}</p>
             <p>Z = ${z.toFixed(4)}</p>`
        );
    }

    updateCoordinates(x, y, z) {
        document.getElementById('coord-x').textContent = x.toFixed(3);
        document.getElementById('coord-y').textContent = y.toFixed(3);
        document.getElementById('coord-z').textContent = z.toFixed(3);
    }

    updateQuaternionInfo(quaternion) {
        if (!quaternion) return;
        document.getElementById('quat-w').textContent = quaternion[0].toFixed(3);
        document.getElementById('quat-x').textContent = quaternion[1].toFixed(3);
        document.getElementById('quat-y').textContent = quaternion[2].toFixed(3);
        document.getElementById('quat-z').textContent = quaternion[3].toFixed(3);
    }

    updateStateDisplay(data) {
        const container = document.getElementById('state-vector');
        container.innerHTML = '';

        data.state_vector.forEach((amp, index) => {
            const bits = index.toString(2).padStart(data.n_qubits, '0');
            const real = amp[0];
            const imag = amp[1];
            const prob = real * real + imag * imag;

            const item = document.createElement('div');
            item.className = 'state-vector-item';

            let ampStr = '';
            if (Math.abs(real) > 1e-6) {
                ampStr += `${real.toFixed(4)}`;
            }
            if (Math.abs(imag) > 1e-6) {
                if (imag > 0 && ampStr) ampStr += ' + ';
                if (imag < 0) ampStr += ' - ';
                ampStr += `${Math.abs(imag).toFixed(4)}j`;
            }
            if (!ampStr) ampStr = '0';

            item.innerHTML = `
                <span class="state-ket">|${bits}⟩</span>
                <span class="state-amplitude">${ampStr}</span>
                <div class="probability-bar">
                    <div class="probability-fill" style="width: ${prob * 100}%"></div>
                </div>
                <span class="probability-value">${(prob * 100).toFixed(1)}%</span>
            `;

            container.appendChild(item);
        });
    }

    updateDensityMatrix(data) {
        const dm = data.density_matrix || (data.entanglement_result && data.entanglement_result.density_matrix) || (data.entanglement && data.entanglement.density_matrix);
        if (!dm) return;

        const container = document.getElementById('density-matrix');
        const size = dm.real.length;

        let html = '<div class="matrix-grid" style="grid-template-columns: repeat(' + size + ', 1fr);">';

        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const real = dm.real[i][j];
                const imag = dm.imag[i][j];
                let cellContent = '';

                if (Math.abs(real) > 1e-6) {
                    cellContent += `<span class="real">${real.toFixed(3)}</span>`;
                }
                if (Math.abs(imag) > 1e-6) {
                    if (imag > 0 && cellContent) cellContent += ' + ';
                    if (imag < 0) cellContent += ' - ';
                    cellContent += `<span class="imag">${Math.abs(imag).toFixed(3)}j</span>`;
                }
                if (!cellContent) cellContent = '0';

                html += `<div class="matrix-cell">${cellContent}</div>`;
            }
        }

        html += '</div>';
        container.innerHTML = html;

        const reducedContainer = document.getElementById('reduced-density-matrices');
        reducedContainer.innerHTML = '';

        if ((data.entanglement_result && data.entanglement_result.reduced_density_matrices) ||
            (data.entanglement && data.entanglement.reduced_density_matrices)) {
            const rdms = (data.entanglement_result && data.entanglement_result.reduced_density_matrices) ||
                         data.entanglement.reduced_density_matrices;
            rdms.forEach(rdm => {
                const rdmSize = rdm.real.length;
                let rdmHtml = `<div class="reduced-matrix">
                    <h4>Qubit ${rdm.qubit} 的约化密度矩阵</h4>
                    <p style="font-size: 0.85rem; color: #9ca3af; margin-bottom: 0.5rem;">
                        冯诺依曼熵: ${rdm.entropy.toFixed(4)}
                    </p>
                    <div class="matrix-grid" style="grid-template-columns: repeat(${rdmSize}, 1fr);">`;

                for (let i = 0; i < rdmSize; i++) {
                    for (let j = 0; j < rdmSize; j++) {
                        const real = rdm.real[i][j];
                        const imag = rdm.imag[i][j];
                        let cellContent = '';

                        if (Math.abs(real) > 1e-6) {
                            cellContent += `<span class="real">${real.toFixed(3)}</span>`;
                        }
                        if (Math.abs(imag) > 1e-6) {
                            if (imag > 0 && cellContent) cellContent += ' + ';
                            if (imag < 0) cellContent += ' - ';
                            cellContent += `<span class="imag">${Math.abs(imag).toFixed(3)}j</span>`;
                        }
                        if (!cellContent) cellContent = '0';

                        rdmHtml += `<div class="matrix-cell">${cellContent}</div>`;
                    }
                }

                rdmHtml += '</div></div>';
                reducedContainer.innerHTML += rdmHtml;
            });
        }
    }

    updateEntanglementDisplay(entanglement) {
        if (!entanglement) return;

        const statusElement = document.getElementById('entanglement-status');
        const detailsElement = document.getElementById('entanglement-details');

        if (entanglement.is_entangled) {
            statusElement.textContent = '纠缠态';
            statusElement.className = 'status-badge entangled';
        } else {
            statusElement.textContent = '非纠缠';
            statusElement.className = 'status-badge not-entangled';
        }

        let html = '';

        if (entanglement.message) {
            html += `<div class="detail-card"><p>${entanglement.message}</p></div>`;
        }

        if (entanglement.ppt_criterion) {
            const ppt = entanglement.ppt_criterion;
            if (ppt.min_eigenvalue !== undefined) {
                html += `<div class="detail-card">
                    <h4>PPT准则 (部分转置)</h4>
                    <div class="detail-value">
                        <span class="label">最小本征值:</span>
                        <span class="value">${ppt.min_eigenvalue.toExponential(4)}</span>
                    </div>
                    <div class="detail-value">
                        <span class="label">Negativity:</span>
                        <span class="value">${ppt.negativity.toFixed(4)}</span>
                    </div>
                    <div class="detail-value">
                        <span class="label">Log-Negativity:</span>
                        <span class="value">${ppt.log_negativity.toFixed(4)}</span>
                    </div>
                    <div class="detail-value">
                        <span class="label">是否纠缠:</span>
                        <span class="value">${ppt.is_entangled ? '是' : '否'}</span>
                    </div>
                </div>`;
            }
            if (ppt.global) {
                html += `<div class="detail-card">
                    <h4>全局PPT准则</h4>
                    <div class="detail-value">
                        <span class="label">最小本征值:</span>
                        <span class="value">${ppt.global.min_eigenvalue.toExponential(4)}</span>
                    </div>
                    <div class="detail-value">
                        <span class="label">是否纠缠:</span>
                        <span class="value">${ppt.global.is_entangled ? '是' : '否'}</span>
                    </div>
                </div>`;
            }
        }

        if (entanglement.concurrence) {
            const conc = entanglement.concurrence;
            html += `<div class="detail-card">
                <h4>Concurrence (并发度)</h4>
                <div class="detail-value">
                    <span class="label">Concurrence:</span>
                    <span class="value">${conc.concurrence.toFixed(4)}</span>
                </div>
                <div class="detail-value">
                    <span class="label">形成纠缠:</span>
                    <span class="value">${conc.entanglement_of_formation.toFixed(4)}</span>
                </div>
                <div class="detail-value">
                    <span class="label">是否纠缠:</span>
                    <span class="value">${conc.is_entangled ? '是' : '否'}</span>
                </div>
            </div>`;
        }

        if (entanglement.mutual_information !== undefined) {
            html += `<div class="detail-card">
                <h4>互信息</h4>
                <div class="detail-value">
                    <span class="label">互信息:</span>
                    <span class="value">${entanglement.mutual_information.toFixed(4)}</span>
                </div>
            </div>`;
        }

        if (entanglement.von_neumann_entropy !== undefined) {
            html += `<div class="detail-card">
                <h4>冯诺依曼熵</h4>
                <div class="detail-value">
                    <span class="label">熵:</span>
                    <span class="value">${entanglement.von_neumann_entropy.toFixed(4)}</span>
                </div>
            </div>`;
        }

        if (entanglement.pairwise_entanglement) {
            html += `<div class="detail-card">
                <h4>成对纠缠检测</h4>`;

            entanglement.pairwise_entanglement.forEach(pair => {
                html += `<div style="margin-bottom: 1rem; padding: 0.5rem; background: rgba(0,0,0,0.2); border-radius: 4px;">
                    <p><strong>Qubit ${pair.qubits[0]} 和 Qubit ${pair.qubits[1]}</strong></p>
                    <div class="detail-value">
                        <span class="label">是否纠缠:</span>
                        <span class="value">${pair.is_entangled ? '是' : '否'}</span>
                    </div>
                    <div class="detail-value">
                        <span class="label">Concurrence:</span>
                        <span class="value">${pair.concurrence.concurrence.toFixed(4)}</span>
                    </div>
                </div>`;
            });

            html += `</div>`;
        }

        detailsElement.innerHTML = html;
    }

    updateStateInfo(data) {
        document.getElementById('info-qubits').textContent = data.n_qubits;
        document.getElementById('info-dimension').textContent = data.state_vector.length;

        let purity = 0;
        if (data.density_matrix) {
            const dm = data.density_matrix;
            for (let i = 0; i < dm.real.length; i++) {
                for (let j = 0; j < dm.real.length; j++) {
                    const r1 = dm.real[i][j];
                    const i1 = dm.imag[i][j];
                    const r2 = dm.real[j][i];
                    const i2 = dm.imag[j][i];
                    purity += r1 * r2 - i1 * i2;
                }
            }
        } else {
            data.state_vector.forEach(amp => {
                const prob = amp[0] * amp[0] + amp[1] * amp[1];
                purity += prob * prob;
            });
        }
        document.getElementById('info-purity').textContent = purity.toFixed(3);

        const entData = data.entanglement_result || data.entanglement;
        const entropy = entData && entData.von_neumann_entropy
            ? entData.von_neumann_entropy.toFixed(3)
            : '0.000';
        document.getElementById('info-entropy').textContent = entropy;
    }

    initEventListeners() {
        document.getElementById('qubit-count').addEventListener('change', (e) => {
            this.nQubits = parseInt(e.target.value);
            this.updateQubitSelects();
            this.sendToServer({ action: 'set_qubits', data: { n_qubits: this.nQubits } });
        });

        document.getElementById('qubit-select').addEventListener('change', (e) => {
            this.selectedQubit = parseInt(e.target.value);
            if (this.currentState && this.currentState.bloch_spheres) {
                const blochData = this.currentState.bloch_spheres[this.selectedQubit];
                if (blochData) {
                    this.blochSphere.updateStatePoint(blochData.x, blochData.y, blochData.z);
                    this.updateCoordinates(blochData.x, blochData.y, blochData.z);
                    this.updateQuaternionInfo(blochData.quaternion);
                }
            }
        });

        document.querySelectorAll('.gate-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const gate = btn.dataset.gate;
                this.applyGate(gate, this.selectedQubit);
            });
        });

        document.getElementById('apply-cnot').addEventListener('click', () => {
            const control = parseInt(document.getElementById('cnot-control').value);
            const target = parseInt(document.getElementById('cnot-target').value);

            if (control === target) {
                this.showError('控制比特和目标比特不能相同');
                return;
            }

            this.sendToServer({
                action: 'apply_gate',
                data: {
                    gate_type: 'CNOT',
                    target_qubit: target,
                    control_qubit: control
                }
            });
        });

        document.getElementById('reset-btn').addEventListener('click', () => {
            this.sendToServer({ action: 'reset' });
            this.blochSphere.clearInterpolation();
        });

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                this.loadPreset(preset);
            });
        });

        document.getElementById('interp-steps').addEventListener('input', (e) => {
            document.getElementById('interp-steps-value').textContent = e.target.value;
        });

        document.getElementById('capture-state1').addEventListener('click', () => {
            if (this.currentState) {
                this.capturedState1 = this.currentState;
                document.getElementById('interp-status').textContent = '状态1已捕获';
                document.getElementById('interp-status').className = 'status-text success';
            }
        });

        document.getElementById('capture-state2').addEventListener('click', () => {
            if (this.currentState) {
                this.capturedState2 = this.currentState;
                document.getElementById('interp-status').textContent = '状态2已捕获';
                document.getElementById('interp-status').className = 'status-text success';
            }
        });

        document.getElementById('start-interp').addEventListener('click', () => {
            this.startInterpolation();
        });

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });

        document.getElementById('auto-rotate').addEventListener('change', (e) => {
            this.blochSphere.setAutoRotate(e.target.checked);
        });

        document.getElementById('show-grid').addEventListener('change', (e) => {
            this.blochSphere.setShowGrid(e.target.checked);
        });

        document.getElementById('show-labels').addEventListener('change', (e) => {
            this.blochSphere.setShowLabels(e.target.checked);
        });

        document.getElementById('point-size').addEventListener('input', (e) => {
            this.blochSphere.setPointSize(parseInt(e.target.value));
        });

        document.getElementById('detect-entanglement').addEventListener('click', () => {
            this.sendToServer({ action: 'detect_entanglement' });
            this.switchTab('entanglement');
        });

        document.getElementById('refresh-history').addEventListener('click', () => {
            this.loadHistory();
        });

        document.getElementById('clear-history').addEventListener('click', () => {
            if (confirm('确定要清空所有历史记录吗？')) {
                this.clearHistory();
            }
        });

        document.getElementById('save-state-btn').addEventListener('click', () => {
            this.saveCurrentState();
        });

        document.getElementById('modal-close').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('modal').addEventListener('click', (e) => {
            if (e.target.id === 'modal') {
                this.closeModal();
            }
        });

        document.getElementById('run-circuit').addEventListener('click', () => {
            this.runCircuit();
        });

        document.getElementById('clear-circuit').addEventListener('click', () => {
            this.clearCircuit();
        });

        document.getElementById('compute-heatmap').addEventListener('click', () => {
            this.computeHeatmap();
        });

        document.getElementById('export-latex').addEventListener('click', () => {
            this.exportLatex();
        });

        document.getElementById('copy-latex').addEventListener('click', () => {
            this.copyLatex();
        });
    }

    updateQubitSelects() {
        const qubitSelect = document.getElementById('qubit-select');
        const cnotControl = document.getElementById('cnot-control');
        const cnotTarget = document.getElementById('cnot-target');

        [qubitSelect, cnotControl, cnotTarget].forEach(select => {
            select.innerHTML = '';
            for (let i = 0; i < this.nQubits; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = `Qubit ${i}`;
                select.appendChild(option);
            }
        });

        if (this.nQubits > 1) {
            cnotTarget.value = 1;
        }

        this.selectedQubit = 0;

        this.circuitData.nQubits = this.nQubits;
        this.circuitData.gates = [];
        this.renderCircuitGrid();
    }

    applyGate(gateType, target) {
        this.sendToServer({
            action: 'apply_gate',
            data: {
                gate_type: gateType,
                target_qubit: target
            }
        });
    }

    loadPreset(preset) {
        if (preset.startsWith('bell-')) {
            const bellType = preset.replace('bell-', '');
            this.sendToServer({ action: 'get_bell', data: { type: bellType } });
        } else if (preset.startsWith('ghz-')) {
            const nQubits = parseInt(preset.replace('ghz-', ''));
            this.sendToServer({ action: 'get_ghz', data: { n_qubits: nQubits } });
        }
    }

    startInterpolation() {
        if (!this.capturedState1 || !this.capturedState2) {
            this.showError('请先捕获状态1和状态2');
            return;
        }

        if (this.capturedState1.n_qubits !== this.capturedState2.n_qubits) {
            this.showError('两个状态的量子比特数必须相同');
            return;
        }

        const steps = parseInt(document.getElementById('interp-steps').value);

        this.sendToServer({
            action: 'interpolate',
            data: {
                state1: {
                    n_qubits: this.capturedState1.n_qubits,
                    state_vector: this.capturedState1.state_vector
                },
                state2: {
                    n_qubits: this.capturedState2.n_qubits,
                    state_vector: this.capturedState2.state_vector
                },
                steps: steps,
                qubit_index: this.selectedQubit
            }
        });

        document.getElementById('interp-status').textContent = '正在插值...';
        document.getElementById('interp-status').className = 'status-text';
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tabName}-tab`);
        });
    }

    async loadHistory() {
        try {
            const response = await fetch('http://localhost:8000/api/history');
            const data = await response.json();
            this.renderHistory(data.history);
            this.renderStatistics(data.statistics);
        } catch (error) {
            console.error('Failed to load history:', error);
        }
    }

    renderStatistics(stats) {
        const container = document.getElementById('history-stats');
        if (!container || !stats) return;
        
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">总计算次数</span>
                    <span class="stat-value">${stats.total_calculations || 0}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">保存状态数</span>
                    <span class="stat-value">${stats.saved_states_count || 0}</span>
                </div>
            </div>
        `;
    }

    renderHistory(records) {
        const container = document.getElementById('history-list');
        container.innerHTML = '';

        if (!records || records.length === 0) {
            container.innerHTML = '<p style="color: #6b7280; text-align: center; padding: 1rem;">暂无历史记录</p>';
            return;
        }

        records.forEach(record => {
            const item = document.createElement('div');
            item.className = 'history-item';

            const typeNames = {
                'state_creation': '态创建',
                'gate_application': '门应用',
                'entanglement_detection': '纠缠检测',
                'interpolation': '四元数插值',
                'bloch_creation': 'Bloch球创建',
                'bell_state': 'Bell态',
                'ghz_state': 'GHZ态'
            };

            const typeName = typeNames[record.operation_type] || record.operation_type;
            const time = new Date(record.timestamp).toLocaleString('zh-CN');

            item.innerHTML = `
                <div class="history-type">${typeName}</div>
                <div class="history-qubits">${record.n_qubits} 量子比特</div>
                <div class="history-time">${time}</div>
            `;

            item.addEventListener('click', () => {
                this.loadHistoryRecord(record);
            });

            container.appendChild(item);
        });
    }

    loadHistoryRecord(record) {
        this.sendToServer({
            action: 'create_state',
            data: {
                n_qubits: record.n_qubits,
                state_vector: record.state_vector
            }
        });
    }

    async clearHistory() {
        try {
            await fetch('http://localhost:8000/api/history', { method: 'DELETE' });
            this.loadHistory();
        } catch (error) {
            console.error('Failed to clear history:', error);
        }
    }

    async loadSavedStates() {
        try {
            const response = await fetch('http://localhost:8000/api/saved-states');
            const data = await response.json();
            this.renderSavedStates(data.states);
        } catch (error) {
            console.error('Failed to load saved states:', error);
        }
    }

    renderSavedStates(states) {
        const container = document.getElementById('saved-states-list');
        container.innerHTML = '';

        if (!states || states.length === 0) {
            container.innerHTML = '<p style="color: #6b7280; text-align: center; padding: 1rem;">暂无保存的状态</p>';
            return;
        }

        states.forEach(state => {
            const item = document.createElement('div');
            item.className = 'saved-state-item';
            item.innerHTML = `
                <span>${state.name} (${state.n_qubits} qubit)</span>
                <button data-id="${state.id}">加载</button>
            `;

            item.querySelector('button').addEventListener('click', () => {
                this.sendToServer({
                    action: 'create_state',
                    data: {
                        n_qubits: state.n_qubits,
                        state_vector: state.state_vector
                    }
                });
            });

            container.appendChild(item);
        });
    }

    async saveCurrentState() {
        const nameInput = document.getElementById('save-name');
        const name = nameInput.value.trim();

        if (!name) {
            this.showError('请输入状态名称');
            return;
        }

        if (!this.currentState) {
            this.showError('没有可保存的状态');
            return;
        }

        try {
            const params = new URLSearchParams({ name });
            await fetch(`http://localhost:8000/api/saved-states?${params}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    n_qubits: this.currentState.n_qubits,
                    state_vector: this.currentState.state_vector
                })
            });

            nameInput.value = '';
            this.loadSavedStates();
        } catch (error) {
            console.error('Failed to save state:', error);
        }
    }

    showError(message) {
        document.getElementById('interp-status').textContent = message;
        document.getElementById('interp-status').className = 'status-text error';
        setTimeout(() => {
            document.getElementById('interp-status').textContent = '';
            document.getElementById('interp-status').className = 'status-text';
        }, 3000);
    }

    showModal(title, content) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = content;
        document.getElementById('modal').classList.remove('hidden');
    }

    closeModal() {
        document.getElementById('modal').classList.add('hidden');
    }

    initCircuitEditor() {
        this.circuitData = { nQubits: this.nQubits, maxSteps: 8, gates: [] };
        this.renderCircuitGrid();

        document.querySelectorAll('.circuit-gate-draggable').forEach(el => {
            el.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('gate', el.dataset.gate);
                e.dataTransfer.effectAllowed = 'copy';
            });
        });
    }

    renderCircuitGrid() {
        const grid = document.getElementById('circuit-grid');
        grid.innerHTML = '';

        for (let q = 0; q < this.circuitData.nQubits; q++) {
            const row = document.createElement('div');
            row.className = 'circuit-row';

            const label = document.createElement('span');
            label.className = 'circuit-qubit-label';
            label.textContent = `q${q}`;
            row.appendChild(label);

            for (let s = 0; s < this.circuitData.maxSteps; s++) {
                const slot = document.createElement('div');
                slot.className = 'circuit-slot';
                slot.dataset.qubit = q;
                slot.dataset.step = s;

                const existingGate = this.circuitData.gates.find(
                    g => g.step === s && (g.target === q || (g.gate === 'CNOT' && g.control === q))
                );

                if (existingGate) {
                    if (existingGate.gate === 'CNOT') {
                        if (existingGate.control === q) {
                            slot.textContent = '\u2022';
                            slot.classList.add('occupied', 'cnot-control');
                        } else if (existingGate.target === q) {
                            slot.textContent = '\u2295';
                            slot.classList.add('occupied', 'cnot-target');
                        }
                    } else {
                        slot.textContent = existingGate.gate;
                        slot.classList.add('occupied');
                    }
                } else {
                    slot.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        slot.classList.add('drag-over');
                    });
                    slot.addEventListener('dragleave', () => {
                        slot.classList.remove('drag-over');
                    });
                    slot.addEventListener('drop', (e) => {
                        e.preventDefault();
                        slot.classList.remove('drag-over');
                        const gateType = e.dataTransfer.getData('gate');
                        this.addGateToCircuit(gateType, q, s);
                    });
                    slot.addEventListener('click', () => {
                        this.showGatePicker(q, s, slot);
                    });
                }

                row.appendChild(slot);
                if (s < this.circuitData.maxSteps - 1) {
                    const wire = document.createElement('div');
                    wire.className = 'circuit-wire';
                    row.appendChild(wire);
                }
            }

            grid.appendChild(row);
        }
    }

    showGatePicker(qubit, step, slot) {
        const gates = ['H', 'X', 'Y', 'Z'];
        if (this.circuitData.nQubits > 1) gates.push('CNOT');

        const picker = document.createElement('div');
        picker.style.cssText = 'position:absolute;background:#1e1e2e;border:1px solid rgba(139,92,246,0.5);border-radius:6px;padding:4px;display:flex;gap:4px;z-index:100;';

        gates.forEach(g => {
            const btn = document.createElement('span');
            btn.textContent = g;
            btn.style.cssText = 'padding:4px 8px;cursor:pointer;color:#a78bfa;font-size:0.8rem;border-radius:3px;';
            btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(139,92,246,0.3)');
            btn.addEventListener('mouseleave', () => btn.style.background = 'transparent');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.addGateToCircuit(g, qubit, step);
                picker.remove();
            });
            picker.appendChild(btn);
        });

        slot.style.position = 'relative';
        slot.appendChild(picker);

        setTimeout(() => {
            document.addEventListener('click', function rm() {
                picker.remove();
                document.removeEventListener('click', rm);
            });
        }, 10);
    }

    addGateToCircuit(gateType, qubit, step) {
        const existing = this.circuitData.gates.findIndex(
            g => g.step === step && (g.target === qubit || (g.gate === 'CNOT' && g.control === qubit))
        );
        if (existing >= 0) {
            this.circuitData.gates.splice(existing, 1);
        }

        if (gateType === 'CNOT') {
            const control = qubit === 0 ? 1 : qubit - 1;
            this.circuitData.gates.push({
                gate: 'CNOT', target: qubit, control: control, step: step
            });
        } else {
            this.circuitData.gates.push({
                gate: gateType, target: qubit, step: step
            });
        }

        this.renderCircuitGrid();
    }

    async runCircuit() {
        if (this.circuitData.gates.length === 0) {
            this.showError('请先添加量子门到电路中');
            return;
        }

        const sortedGates = [...this.circuitData.gates].sort((a, b) => a.step - b.step);
        const gateSequence = sortedGates.map(g => {
            const gateObj = { gate_type: g.gate, target_qubit: g.target };
            if (g.gate === 'CNOT') {
                gateObj.control_qubit = g.control;
            }
            return gateObj;
        });

        try {
            const response = await fetch('http://localhost:8000/api/gate-sequence', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    n_qubits: this.circuitData.nQubits,
                    gates: gateSequence,
                    label: 'circuit_editor'
                })
            });

            const data = await response.json();
            this.handleStateUpdate(data);
        } catch (error) {
            console.error('Failed to run circuit:', error);
            this.showError('运行电路失败');
        }
    }

    clearCircuit() {
        this.circuitData.gates = [];
        this.circuitData.nQubits = this.nQubits;
        this.renderCircuitGrid();
    }

    async computeHeatmap() {
        const resolution = parseInt(document.getElementById('heatmap-resolution').value);
        const statusEl = document.getElementById('heatmap-status');
        statusEl.textContent = '正在计算热力图...';
        statusEl.className = 'status-text';

        try {
            const response = await fetch(`http://localhost:8000/api/entropy-heatmap?n_qubits=${this.nQubits}&resolution=${resolution}`, {
                method: 'POST'
            });
            const data = await response.json();

            this.renderHeatmapOnSphere(data.heatmap);
            this.renderHeatmapLegend();

            statusEl.textContent = `热力图计算完成 (${data.heatmap.length} 个量子比特)`;
            statusEl.className = 'status-text success';
        } catch (error) {
            console.error('Failed to compute heatmap:', error);
            statusEl.textContent = '热力图计算失败';
            statusEl.className = 'status-text error';
        }
    }

    renderHeatmapOnSphere(heatmapData) {
        if (this.heatmapMesh) {
            this.blochSphere.scene.remove(this.heatmapMesh);
            this.heatmapMesh = null;
        }

        const qubitData = heatmapData[this.selectedQubit] || heatmapData[0];
        if (!qubitData) return;

        const points = qubitData.points;
        const maxEntropy = Math.max(...points.map(p => p.entropy), 0.001);
        const radius = this.blochSphere.options.radius * 1.005;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(points.length * 3);
        const colors = new Float32Array(points.length * 3);

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            positions[i * 3] = p.x * radius;
            positions[i * 3 + 1] = p.y * radius;
            positions[i * 3 + 2] = p.z * radius;

            const t = p.entropy / maxEntropy;
            if (t < 0.33) {
                colors[i * 3] = 0.23 * (1 - t / 0.33) + 0.06 * (t / 0.33);
                colors[i * 3 + 1] = 0.51 * (1 - t / 0.33) + 0.73 * (t / 0.33);
                colors[i * 3 + 2] = 0.96 * (1 - t / 0.33) + 0.35 * (t / 0.33);
            } else if (t < 0.66) {
                const lt = (t - 0.33) / 0.33;
                colors[i * 3] = 0.06 * (1 - lt) + 0.96 * lt;
                colors[i * 3 + 1] = 0.73 * (1 - lt) + 0.62 * lt;
                colors[i * 3 + 2] = 0.35 * (1 - lt) + 0.04 * lt;
            } else {
                const lt = (t - 0.66) / 0.34;
                colors[i * 3] = 0.96 * (1 - lt) + 0.94 * lt;
                colors[i * 3 + 1] = 0.62 * (1 - lt) + 0.27 * lt;
                colors[i * 3 + 2] = 0.04 * (1 - lt) + 0.27 * lt;
            }
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.08,
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            sizeAttenuation: true
        });

        this.heatmapMesh = new THREE.Points(geometry, material);
        this.blochSphere.scene.add(this.heatmapMesh);
    }

    renderHeatmapLegend() {
        const container = document.getElementById('heatmap-legend');
        container.innerHTML = `
            <div class="heatmap-legend-bar"></div>
            <div class="heatmap-legend-labels">
                <span>0 (分离态)</span>
                <span>1 (最大纠缠)</span>
            </div>
        `;
    }

    async exportLatex() {
        if (!this.currentState) {
            this.showError('请先创建或选择一个量子态');
            return;
        }

        const entData = this.currentState.entanglement_result || this.currentState.entanglement;
        if (!entData) {
            this.sendToServer({ action: 'detect_entanglement' });
            await new Promise(r => setTimeout(r, 500));
        }

        const entResult = this.currentState.entanglement_result || this.currentState.entanglement || {};
        const precision = parseInt(document.getElementById('latex-precision').value);

        try {
            const response = await fetch('http://localhost:8000/api/export-latex', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entanglement_result: entResult,
                    precision: precision
                })
            });

            const data = await response.json();
            this.latexContent = data.latex;

            const output = document.getElementById('latex-output');
            output.textContent = this.latexContent;
        } catch (error) {
            console.error('Failed to export LaTeX:', error);
            this.showError('LaTeX导出失败');
        }
    }

    copyLatex() {
        if (!this.latexContent) {
            this.showError('请先生成LaTeX代码');
            return;
        }

        navigator.clipboard.writeText(this.latexContent).then(() => {
            const btn = document.getElementById('copy-latex');
            const orig = btn.textContent;
            btn.textContent = '已复制!';
            setTimeout(() => btn.textContent = orig, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new QuantumVisualizationApp();
});
