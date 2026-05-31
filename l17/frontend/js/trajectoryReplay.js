class TrajectoryReplay {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = canvas.width;
        this.height = canvas.height;
        
        this.replaySpeed = options.replaySpeed || 1;
        this.trailLength = options.trailLength || 50;
        this.pointRadius = options.pointRadius || 4;
        this.lineWidth = options.lineWidth || 2;
        
        this.dataPoints = [];
        this.aois = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.animationId = null;
        this.startTime = null;
        this.lastFrameTime = 0;
        
        this.colorPalette = [
            '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
            '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6'
        ];
        
        this.onProgress = null;
        this.onComplete = null;
        this.onAOIEnter = null;
    }

    loadSequence(dataPoints, aois, options = {}) {
        this.dataPoints = dataPoints || [];
        this.aois = aois || [];
        this.currentIndex = 0;
        this.startTime = null;
        
        if (options.startTime) {
            const idx = this.dataPoints.findIndex(p => p.timestamp >= options.startTime);
            if (idx >= 0) this.currentIndex = idx;
        }
        
        if (options.endTime) {
            const idx = this.dataPoints.findIndex(p => p.timestamp > options.endTime);
            if (idx >= 0) {
                this.dataPoints = this.dataPoints.slice(0, idx);
            }
        }
    }

    play() {
        if (this.dataPoints.length === 0) return;
        
        this.isPlaying = true;
        this.startTime = this.dataPoints[this.currentIndex].timestamp;
        this.lastFrameTime = performance.now();
        this.animate();
    }

    pause() {
        this.isPlaying = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    stop() {
        this.isPlaying = false;
        this.currentIndex = 0;
        this.startTime = null;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.drawFrame();
    }

    seekTo(progress) {
        const index = Math.floor(progress * this.dataPoints.length);
        this.currentIndex = Math.min(index, this.dataPoints.length - 1);
        this.drawFrame();
    }

    setSpeed(speed) {
        this.replaySpeed = speed;
    }

    animate() {
        if (!this.isPlaying) return;
        
        const now = performance.now();
        const deltaMs = (now - this.lastFrameTime) * this.replaySpeed;
        this.lastFrameTime = now;
        
        if (this.currentIndex < this.dataPoints.length - 1) {
            const currentTimestamp = this.dataPoints[this.currentIndex].timestamp;
            const nextTimestamp = currentTimestamp + deltaMs;
            
            while (this.currentIndex < this.dataPoints.length - 1 &&
                   this.dataPoints[this.currentIndex + 1].timestamp <= nextTimestamp) {
                this.currentIndex++;
                
                this.checkAOITransition(this.currentIndex);
            }
            
            this.drawFrame();
            
            if (this.onProgress) {
                this.onProgress(this.currentIndex / this.dataPoints.length);
            }
            
            this.animationId = requestAnimationFrame(() => this.animate());
        } else {
            this.isPlaying = false;
            this.drawFrame();
            if (this.onComplete) {
                this.onComplete();
            }
        }
    }

    checkAOITransition(index) {
        if (this.aois.length === 0 || index === 0) return;
        
        const point = this.dataPoints[index];
        const prevPoint = this.dataPoints[index - 1];
        
        for (const aoi of this.aois) {
            const wasInside = this.isPointInAOI(prevPoint, aoi);
            const isInside = this.isPointInAOI(point, aoi);
            
            if (!wasInside && isInside && this.onAOIEnter) {
                this.onAOIEnter({
                    aoiId: aoi.id,
                    aoiName: aoi.name,
                    timestamp: point.timestamp,
                    point
                });
            }
        }
    }

    isPointInAOI(point, aoi) {
        const { x, y } = point;
        const { type, x: aoiX, y: aoiY, width, height, radius } = aoi;
        
        switch (type) {
            case 'rectangle':
                return x >= aoiX && x <= aoiX + width && y >= aoiY && y <= aoiY + height;
            case 'circle':
                return Math.sqrt((x - aoiX) ** 2 + (y - aoiY) ** 2) <= radius;
            default:
                return false;
        }
    }

    drawFrame() {
        const ctx = this.ctx;
        const scaleX = this.canvas.offsetWidth / this.width;
        const scaleY = this.canvas.offsetHeight / this.height;
        
        ctx.clearRect(0, 0, this.width, this.height);
        
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(0, 0, this.width, this.height);
        
        this.drawGrid(ctx);
        this.drawAOIs(ctx, scaleX, scaleY);
        this.drawTrail(ctx, scaleX, scaleY);
        this.drawCurrentPoint(ctx, scaleX, scaleY);
        this.drawProgress(ctx);
    }

    drawGrid(ctx) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
        ctx.lineWidth = 1;
        
        const gridSize = 50;
        for (let x = 0; x <= this.width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.height);
            ctx.stroke();
        }
        for (let y = 0; y <= this.height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.width, y);
            ctx.stroke();
        }
    }

    drawAOIs(ctx, scaleX, scaleY) {
        this.aois.forEach((aoi, idx) => {
            const color = aoi.color || this.colorPalette[idx % this.colorPalette.length];
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            
            if (aoi.type === 'rectangle') {
                ctx.strokeRect(aoi.x / scaleX, aoi.y / scaleY, aoi.width / scaleX, aoi.height / scaleY);
                ctx.fillStyle = this.hexToRgba(color, 0.1);
                ctx.fillRect(aoi.x / scaleX, aoi.y / scaleY, aoi.width / scaleX, aoi.height / scaleY);
            } else if (aoi.type === 'circle') {
                ctx.beginPath();
                ctx.arc(aoi.x / scaleX, aoi.y / scaleY, aoi.radius / Math.max(scaleX, scaleY), 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = this.hexToRgba(color, 0.1);
                ctx.fill();
            }
            
            ctx.setLineDash([]);
            
            ctx.font = 'bold 14px "Segoe UI", sans-serif';
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            if (aoi.type === 'rectangle') {
                ctx.fillText(aoi.name, aoi.x / scaleX + aoi.width / scaleX / 2, aoi.y / scaleY - 8);
            } else if (aoi.type === 'circle') {
                ctx.fillText(aoi.name, aoi.x / scaleX, aoi.y / scaleY - aoi.radius / Math.max(scaleX, scaleY) - 8);
            }
        });
    }

    drawTrail(ctx, scaleX, scaleY) {
        const startIdx = Math.max(0, this.currentIndex - this.trailLength);
        const endIdx = this.currentIndex;
        
        if (endIdx <= startIdx) return;
        
        for (let i = startIdx + 1; i <= endIdx; i++) {
            const progress = (i - startIdx) / (endIdx - startIdx);
            const prev = this.dataPoints[i - 1];
            const curr = this.dataPoints[i];
            
            ctx.beginPath();
            ctx.moveTo(prev.x / scaleX, prev.y / scaleY);
            ctx.lineTo(curr.x / scaleX, curr.y / scaleY);
            ctx.strokeStyle = `rgba(59, 130, 246, ${progress * 0.8})`;
            ctx.lineWidth = this.lineWidth * progress;
            ctx.stroke();
        }
    }

    drawCurrentPoint(ctx, scaleX, scaleY) {
        if (this.currentIndex >= this.dataPoints.length) return;
        
        const point = this.dataPoints[this.currentIndex];
        const x = point.x / scaleX;
        const y = point.y / scaleY;
        
        ctx.beginPath();
        ctx.arc(x, y, this.pointRadius * 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(x, y, this.pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#3b82f6';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        
        if (point.pupilDiameter) {
            ctx.font = '10px "Segoe UI", sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.textAlign = 'center';
            ctx.fillText(`${point.pupilDiameter.toFixed(1)}mm`, x, y - 12);
        }
    }

    drawProgress(ctx) {
        const barHeight = 4;
        const barY = this.height - barHeight - 5;
        const progress = this.dataPoints.length > 0
            ? this.currentIndex / (this.dataPoints.length - 1)
            : 0;
        
        ctx.fillStyle = 'rgba(51, 65, 85, 0.5)';
        ctx.fillRect(0, barY, this.width, barHeight);
        
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(0, barY, this.width * progress, barHeight);
    }

    hexToRgba(hex, alpha) {
        if (!hex || hex.charAt(0) !== '#') return `rgba(59, 130, 246, ${alpha})`;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = rect.width;
        this.height = rect.height;
    }

    destroy() {
        this.pause();
        this.dataPoints = [];
        this.aois = [];
    }
}
