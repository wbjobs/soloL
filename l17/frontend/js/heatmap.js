class Heatmap {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { willReadFrequently: false });
        this.width = canvas.width;
        this.height = canvas.height;
        
        this.radius = options.radius || 50;
        this.decayTime = options.decayTime || 5000;
        this.maxPoints = options.maxPoints || 500;
        this.showGrid = options.showGrid !== false;
        
        this.points = [];
        this.gradient = this.createGradient();
        
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCanvas.width = canvas.width;
        this.offscreenCanvas.height = canvas.height;
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
        
        this.lastDeepCleanTime = Date.now();
        this.deepCleanInterval = 60000;
        this.frameCount = 0;
        
        this.animationId = null;
        this.lastUpdateTime = Date.now();
    }

    createGradient() {
        const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius);
        gradient.addColorStop(0, 'rgba(255, 0, 0, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 0, 0.8)');
        gradient.addColorStop(0.4, 'rgba(0, 255, 255, 0.6)');
        gradient.addColorStop(0.6, 'rgba(0, 0, 255, 0.4)');
        gradient.addColorStop(0.8, 'rgba(128, 0, 255, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        return gradient;
    }

    addPoint(x, y, timestamp = Date.now()) {
        this.points.push({ x, y, timestamp });
        
        while (this.points.length > this.maxPoints) {
            this.points.shift();
        }
    }

    addPoints(points) {
        points.forEach(p => {
            this.points.push({
                x: p.x,
                y: p.y,
                timestamp: p.timestamp || Date.now()
            });
        });
        
        while (this.points.length > this.maxPoints) {
            this.points.shift();
        }
    }

    clear() {
        this.points = [];
        
        if (this.offscreenCtx) {
            this.offscreenCtx.setTransform(1, 0, 0, 1, 0, 0);
            this.offscreenCtx.globalCompositeOperation = 'source-over';
            this.offscreenCtx.globalAlpha = 1;
            this.offscreenCtx.clearRect(0, 0, this.width, this.height);
        }
        
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        this.frameCount = 0;
        this.lastDeepCleanTime = Date.now();
    }

    performDeepClean() {
        console.log('[Heatmap] Performing deep clean to prevent memory leaks');
        
        if (this.offscreenCanvas) {
            const oldOffscreen = this.offscreenCanvas;
            this.offscreenCanvas = document.createElement('canvas');
            this.offscreenCanvas.width = this.width;
            this.offscreenCanvas.height = this.height;
            this.offscreenCtx = this.offscreenCanvas.getContext('2d');
            
            oldOffscreen.width = 0;
            oldOffscreen.height = 0;
        }
        
        this.gradient = this.createGradient();
    }

    draw() {
        const now = Date.now();
        this.frameCount++;
        
        if (now - this.lastDeepCleanTime > this.deepCleanInterval) {
            this.performDeepClean();
            this.lastDeepCleanTime = now;
        }
        
        const scaleX = this.canvas.offsetWidth / this.width;
        const scaleY = this.canvas.offsetHeight / this.height;
        
        this.points = this.points.filter(p => {
            const age = now - p.timestamp;
            return age < this.decayTime * 2;
        });
        
        if (this.points.length > this.maxPoints) {
            this.points = this.points.slice(-this.maxPoints);
        }
        
        this.offscreenCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.offscreenCtx.globalCompositeOperation = 'source-over';
        this.offscreenCtx.globalAlpha = 1;
        this.offscreenCtx.clearRect(0, 0, this.width, this.height);
        this.offscreenCtx.fillStyle = 'rgba(0, 0, 0, 0)';
        this.offscreenCtx.fillRect(0, 0, this.width, this.height);
        this.offscreenCtx.clearRect(0, 0, this.width, this.height);
        
        this.offscreenCtx.globalCompositeOperation = 'lighter';
        
        for (let i = 0; i < this.points.length; i++) {
            const point = this.points[i];
            const age = now - point.timestamp;
            const alpha = Math.max(0, 1 - age / this.decayTime);
            
            if (alpha <= 0) continue;
            
            const x = point.x / scaleX;
            const y = point.y / scaleY;
            
            this.offscreenCtx.save();
            this.offscreenCtx.translate(x, y);
            this.offscreenCtx.globalAlpha = alpha * 0.6;
            this.offscreenCtx.fillStyle = this.gradient;
            this.offscreenCtx.beginPath();
            this.offscreenCtx.arc(0, 0, this.radius / scaleX, 0, Math.PI * 2);
            this.offscreenCtx.fill();
            this.offscreenCtx.restore();
        }
        
        this.offscreenCtx.globalCompositeOperation = 'source-over';
        this.offscreenCtx.globalAlpha = 1;
        
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        this.ctx.drawImage(this.offscreenCanvas, 0, 0);
        
        if (this.showGrid) {
            this.drawGrid();
        }
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

    startAnimation() {
        const animate = () => {
            this.draw();
            this.animationId = requestAnimationFrame(animate);
        };
        animate();
    }

    stopAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    setRadius(radius) {
        this.radius = radius;
        this.gradient = this.createGradient();
    }

    setDecayTime(decayTime) {
        this.decayTime = decayTime;
    }

    setShowGrid(show) {
        this.showGrid = show;
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = rect.width;
        this.height = rect.height;
        
        if (this.offscreenCanvas) {
            this.offscreenCanvas.width = rect.width;
            this.offscreenCanvas.height = rect.height;
        }
        
        this.gradient = this.createGradient();
    }
}
