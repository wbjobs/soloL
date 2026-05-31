class Trajectory {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = canvas.width;
        this.height = canvas.height;
        
        this.maxTrailLength = options.maxTrailLength || 50;
        this.lineWidth = options.lineWidth || 2;
        this.showGrid = options.showGrid !== false;
        this.showPoints = options.showPoints !== false;
        this.animationSpeed = options.animationSpeed || 1;
        
        this.points = [];
        this.displayIndex = 0;
        this.animationId = null;
        this.isAnimating = false;
        this.lastPointTime = 0;
    }

    addPoint(x, y, pupilDiameter = 3, timestamp = Date.now()) {
        this.points.push({ x, y, pupilDiameter, timestamp });
        
        while (this.points.length > this.maxTrailLength * 2) {
            this.points.shift();
        }
        
        this.displayIndex = this.points.length;
    }

    addPoints(points) {
        points.forEach(p => {
            this.points.push({
                x: p.x,
                y: p.y,
                pupilDiameter: p.pupilDiameter || 3,
                timestamp: p.timestamp || Date.now()
            });
        });
        
        while (this.points.length > this.maxTrailLength * 2) {
            this.points.splice(0, this.points.length - this.maxTrailLength * 2);
        }
        
        this.displayIndex = this.points.length;
    }

    clear() {
        this.points = [];
        this.displayIndex = 0;
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    draw() {
        const scaleX = this.canvas.offsetWidth / this.width;
        const scaleY = this.canvas.offsetHeight / this.height;
        
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        if (this.showGrid) {
            this.drawGrid();
        }
        
        const displayPoints = this.points.slice(-this.maxTrailLength);
        
        if (displayPoints.length < 2) return;
        
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        for (let i = 1; i < displayPoints.length; i++) {
            const prev = displayPoints[i - 1];
            const curr = displayPoints[i];
            
            const alpha = i / displayPoints.length;
            const hue = 200 + (alpha * 100);
            const saturation = 70 + (alpha * 30);
            const lightness = 50 + (alpha * 10);
            
            this.ctx.strokeStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
            
            this.ctx.beginPath();
            this.ctx.moveTo(prev.x / scaleX, prev.y / scaleY);
            this.ctx.lineTo(curr.x / scaleX, curr.y / scaleY);
            this.ctx.stroke();
        }
        
        if (this.showPoints) {
            displayPoints.forEach((point, i) => {
                const alpha = (i + 1) / displayPoints.length;
                const size = Math.max(2, point.pupilDiameter * 0.8);
                
                this.ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
                this.ctx.beginPath();
                this.ctx.arc(point.x / scaleX, point.y / scaleY, size / scaleX, 0, Math.PI * 2);
                this.ctx.fill();
                
                this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
                this.ctx.lineWidth = 1;
                this.ctx.stroke();
            });
        }
        
        if (displayPoints.length > 0) {
            const last = displayPoints[displayPoints.length - 1];
            this.drawFixationPoint(last.x / scaleX, last.y / scaleY);
        }
    }

    drawFixationPoint(x, y) {
        const pulse = (Date.now() % 2000) / 2000;
        const radius = 8 + Math.sin(pulse * Math.PI * 2) * 3;
        
        this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.stroke();
        
        this.ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
        this.ctx.beginPath();
        this.ctx.arc(x, y, 4, 0, Math.PI * 2);
        this.ctx.fill();
        
        this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(x - 15, y);
        this.ctx.lineTo(x + 15, y);
        this.ctx.moveTo(x, y - 15);
        this.ctx.lineTo(x, y + 15);
        this.ctx.stroke();
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

    setMaxTrailLength(length) {
        this.maxTrailLength = length;
    }

    setLineWidth(width) {
        this.lineWidth = width;
    }

    setShowGrid(show) {
        this.showGrid = show;
    }

    setShowPoints(show) {
        this.showPoints = show;
    }

    drawStaticData(points, aois = []) {
        const scaleX = this.canvas.offsetWidth / this.width;
        const scaleY = this.canvas.offsetHeight / this.height;
        
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        if (this.showGrid) {
            this.drawGrid();
        }
        
        aois.forEach(aoi => {
            this.drawAOI(aoi, scaleX, scaleY);
        });
        
        if (points.length < 2) return;
        
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            
            const progress = i / points.length;
            const hue = 200 + (progress * 100);
            
            this.ctx.strokeStyle = `hsla(${hue}, 70%, 50%, 0.6)`;
            
            this.ctx.beginPath();
            this.ctx.moveTo(prev.x / scaleX, prev.y / scaleY);
            this.ctx.lineTo(curr.x / scaleX, curr.y / scaleY);
            this.ctx.stroke();
        }
        
        points.forEach((point, i) => {
            const progress = (i + 1) / points.length;
            const size = Math.max(3, point.pupilDiameter || 3);
            
            this.ctx.fillStyle = `hsla(${200 + progress * 100}, 70%, 50%, 0.8)`;
            this.ctx.beginPath();
            this.ctx.arc(point.x / scaleX, point.y / scaleY, size / scaleX, 0, Math.PI * 2);
            this.ctx.fill();
            
            if (i % 10 === 0) {
                this.ctx.fillStyle = 'white';
                this.ctx.font = '10px sans-serif';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(i + 1, point.x / scaleX, point.y / scaleY - 10);
            }
        });
    }

    drawAOI(aoi, scaleX, scaleY) {
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
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = rect.width;
        this.height = rect.height;
    }
}
