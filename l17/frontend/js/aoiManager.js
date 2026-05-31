class AOIManager {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = canvas.width;
        this.height = canvas.height;
        this.apiUrl = options.apiUrl || 'http://localhost:3001';
        
        this.aois = [];
        this.currentTool = null;
        this.isDrawing = false;
        this.startPoint = null;
        this.tempPoints = [];
        this.aoiCounter = 0;
        
        this.aoiColors = [
            '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
            '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
        ];
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.cancelDrawing();
        });
    }

    getCanvasCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.width / rect.width;
        const scaleY = this.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    setTool(tool) {
        this.currentTool = tool;
        this.cancelDrawing();
        this.canvas.style.cursor = tool ? 'crosshair' : 'default';
    }

    onMouseDown(e) {
        if (!this.currentTool || e.button !== 0) return;
        
        const coords = this.getCanvasCoords(e);
        this.isDrawing = true;
        this.startPoint = coords;
        
        if (this.currentTool === 'polygon') {
            this.tempPoints.push(coords);
        }
    }

    onMouseMove(e) {
        if (!this.isDrawing && this.currentTool !== 'polygon') return;
        
        const coords = this.getCanvasCoords(e);
        
        if (this.currentTool === 'polygon' && this.tempPoints.length > 0) {
            this.drawPreview(coords);
        } else if (this.currentTool !== 'polygon') {
            this.drawPreview(coords);
        }
    }

    onMouseUp(e) {
        if (!this.isDrawing || !this.currentTool) return;
        
        const coords = this.getCanvasCoords(e);
        
        if (this.currentTool !== 'polygon') {
            this.finishDrawing(coords);
        }
    }

    onDoubleClick(e) {
        if (this.currentTool === 'polygon' && this.tempPoints.length >= 3) {
            this.finishPolygon();
        }
    }

    drawPreview(endPoint) {
        this.redraw();
        
        const scaleX = this.canvas.offsetWidth / this.width;
        const scaleY = this.canvas.offsetHeight / this.height;
        
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
        this.ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        
        if (this.currentTool === 'rectangle' && this.startPoint) {
            const x = Math.min(this.startPoint.x, endPoint.x) / scaleX;
            const y = Math.min(this.startPoint.y, endPoint.y) / scaleY;
            const width = Math.abs(endPoint.x - this.startPoint.x) / scaleX;
            const height = Math.abs(endPoint.y - this.startPoint.y) / scaleY;
            this.ctx.strokeRect(x, y, width, height);
            this.ctx.fillRect(x, y, width, height);
        } else if (this.currentTool === 'circle' && this.startPoint) {
            const dx = endPoint.x - this.startPoint.x;
            const dy = endPoint.y - this.startPoint.y;
            const radius = Math.sqrt(dx * dx + dy * dy) / scaleX;
            this.ctx.beginPath();
            this.ctx.arc(this.startPoint.x / scaleX, this.startPoint.y / scaleY, radius, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.fill();
        } else if (this.currentTool === 'polygon' && this.tempPoints.length > 0) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.tempPoints[0].x / scaleX, this.tempPoints[0].y / scaleY);
            for (let i = 1; i < this.tempPoints.length; i++) {
                this.ctx.lineTo(this.tempPoints[i].x / scaleX, this.tempPoints[i].y / scaleY);
            }
            this.ctx.lineTo(endPoint.x / scaleX, endPoint.y / scaleY);
            this.ctx.stroke();
            
            this.tempPoints.forEach((p, i) => {
                this.ctx.fillStyle = '#3b82f6';
                this.ctx.beginPath();
                this.ctx.arc(p.x / scaleX, p.y / scaleY, 4, 0, Math.PI * 2);
                this.ctx.fill();
            });
        }
        
        this.ctx.setLineDash([]);
        this.ctx.restore();
    }

    finishDrawing(endPoint) {
        if (!this.startPoint) return;
        
        const color = this.aoiColors[this.aoiCounter % this.aoiColors.length];
        this.aoiCounter++;
        
        let aoi = {
            id: `aoi_${Date.now()}`,
            name: `AOI ${this.aoiCounter}`,
            color,
            type: this.currentTool
        };
        
        if (this.currentTool === 'rectangle') {
            aoi.x = Math.min(this.startPoint.x, endPoint.x);
            aoi.y = Math.min(this.startPoint.y, endPoint.y);
            aoi.width = Math.abs(endPoint.x - this.startPoint.x);
            aoi.height = Math.abs(endPoint.y - this.startPoint.y);
        } else if (this.currentTool === 'circle') {
            const dx = endPoint.x - this.startPoint.x;
            const dy = endPoint.y - this.startPoint.y;
            aoi.x = this.startPoint.x;
            aoi.y = this.startPoint.y;
            aoi.radius = Math.sqrt(dx * dx + dy * dy);
        }
        
        this.aois.push(aoi);
        this.isDrawing = false;
        this.startPoint = null;
        this.tempPoints = [];
        
        this.redraw();
        this.emit('aoiAdded', aoi);
    }

    finishPolygon() {
        if (this.tempPoints.length < 3) return;
        
        const color = this.aoiColors[this.aoiCounter % this.aoiColors.length];
        this.aoiCounter++;
        
        const aoi = {
            id: `aoi_${Date.now()}`,
            name: `AOI ${this.aoiCounter}`,
            color,
            type: 'polygon',
            points: [...this.tempPoints]
        };
        
        this.aois.push(aoi);
        this.isDrawing = false;
        this.startPoint = null;
        this.tempPoints = [];
        
        this.redraw();
        this.emit('aoiAdded', aoi);
    }

    cancelDrawing() {
        this.isDrawing = false;
        this.startPoint = null;
        this.tempPoints = [];
        this.redraw();
    }

    removeAOI(aoiId) {
        this.aois = this.aois.filter(a => a.id !== aoiId);
        this.redraw();
        this.emit('aoiRemoved', aoiId);
    }

    clearAOIs() {
        this.aois = [];
        this.aoiCounter = 0;
        this.redraw();
        this.emit('aoisCleared');
    }

    updateAOIName(aoiId, name) {
        const aoi = this.aois.find(a => a.id === aoiId);
        if (aoi) {
            aoi.name = name;
            this.redraw();
        }
    }

    redraw() {
        const scaleX = this.canvas.offsetWidth / this.width;
        const scaleY = this.canvas.offsetHeight / this.height;
        
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        this.drawGrid();
        
        this.aois.forEach(aoi => {
            this.ctx.save();
            this.ctx.fillStyle = `${aoi.color}33`;
            this.ctx.strokeStyle = aoi.color;
            this.ctx.lineWidth = 2;
            
            switch (aoi.type) {
                case 'rectangle':
                    this.ctx.fillRect(
                        aoi.x / scaleX,
                        aoi.y / scaleY,
                        aoi.width / scaleX,
                        aoi.height / scaleY
                    );
                    this.ctx.strokeRect(
                        aoi.x / scaleX,
                        aoi.y / scaleY,
                        aoi.width / scaleX,
                        aoi.height / scaleY
                    );
                    break;
                case 'circle':
                    this.ctx.beginPath();
                    this.ctx.arc(
                        aoi.x / scaleX,
                        aoi.y / scaleY,
                        aoi.radius / scaleX,
                        0,
                        Math.PI * 2
                    );
                    this.ctx.fill();
                    this.ctx.stroke();
                    break;
                case 'polygon':
                    if (aoi.points && aoi.points.length > 0) {
                        this.ctx.beginPath();
                        this.ctx.moveTo(
                            aoi.points[0].x / scaleX,
                            aoi.points[0].y / scaleY
                        );
                        for (let i = 1; i < aoi.points.length; i++) {
                            this.ctx.lineTo(
                                aoi.points[i].x / scaleX,
                                aoi.points[i].y / scaleY
                            );
                        }
                        this.ctx.closePath();
                        this.ctx.fill();
                        this.ctx.stroke();
                    }
                    break;
            }
            
            this.ctx.fillStyle = aoi.color;
            this.ctx.font = 'bold 14px sans-serif';
            this.ctx.textAlign = 'left';
            this.ctx.fillText(
                aoi.name,
                (aoi.x || (aoi.points ? aoi.points[0].x : 0)) / scaleX + 5,
                (aoi.y || (aoi.points ? aoi.points[0].y : 0)) / scaleY + 20
            );
            
            this.ctx.restore();
        });
    }

    drawGrid() {
        this.ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
        this.ctx.lineWidth = 1;
        
        const gridSize = 50;
        
        for (let x = 0; x <= this.width; x += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();
        }
        
        for (let y = 0; y <= this.height; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
            this.ctx.stroke();
        }
        
        this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(0, 0, this.width, this.height);
    }

    async analyze(startTime, endTime, data = null) {
        try {
            const aoiData = this.aois.map(aoi => ({
                id: aoi.id,
                name: aoi.name,
                type: aoi.type,
                x: aoi.x,
                y: aoi.y,
                width: aoi.width,
                height: aoi.height,
                radius: aoi.radius,
                points: aoi.points
            }));

            let payload;
            if (data) {
                payload = { aois: aoiData, data };
            } else {
                payload = { aois: aoiData, start: startTime, end: endTime };
            }

            const response = await fetch(`${this.apiUrl}/api/aoi/analyze-range`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            this.emit('analysisComplete', result);
            return result;
        } catch (err) {
            console.error('Analysis error:', err);
            this.emit('analysisError', err);
            throw err;
        }
    }

    on(event, callback) {
        if (!this.listeners) this.listeners = {};
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    emit(event, data) {
        if (this.listeners && this.listeners[event]) {
            this.listeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error(e); }
            });
        }
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = rect.width;
        this.height = rect.height;
        this.redraw();
    }

    getAOIs() {
        return [...this.aois];
    }
}
