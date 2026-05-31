class PupilChart {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = canvas.width;
        this.height = canvas.height;
        
        this.maxDataPoints = options.maxDataPoints || 200;
        this.backgroundColor = options.backgroundColor || 'transparent';
        this.lineColor = options.lineColor || '#60a5fa';
        this.fillColor = options.fillColor || 'rgba(96, 165, 250, 0.2)';
        this.gridColor = options.gridColor || 'rgba(148, 163, 184, 0.1)';
        
        this.data = [];
        this.animationId = null;
        
        this.stats = {
            current: null,
            average: null,
            min: null,
            max: null
        };
    }

    addPoint(pupilDiameter, timestamp = Date.now()) {
        this.data.push({ value: pupilDiameter, timestamp });
        
        while (this.data.length > this.maxDataPoints) {
            this.data.shift();
        }
        
        this.updateStats();
    }

    addPoints(points) {
        points.forEach(p => {
            this.data.push({
                value: p.pupilDiameter,
                timestamp: p.timestamp || Date.now()
            });
        });
        
        while (this.data.length > this.maxDataPoints) {
            this.data.splice(0, this.data.length - this.maxDataPoints);
        }
        
        this.updateStats();
    }

    updateStats() {
        if (this.data.length === 0) {
            this.stats = { current: null, average: null, min: null, max: null };
            return;
        }
        
        const values = this.data.map(d => d.value);
        this.stats.current = values[values.length - 1];
        this.stats.average = values.reduce((a, b) => a + b, 0) / values.length;
        this.stats.min = Math.min(...values);
        this.stats.max = Math.max(...values);
    }

    clear() {
        this.data = [];
        this.stats = { current: null, average: null, min: null, max: null };
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        const chartWidth = this.width - padding.left - padding.right;
        const chartHeight = this.height - padding.top - padding.bottom;
        
        this.drawGrid(padding, chartWidth, chartHeight);
        
        if (this.data.length < 2) return;
        
        const values = this.data.map(d => d.value);
        const minVal = Math.max(0, Math.min(...values) - 0.5);
        const maxVal = Math.max(...values) + 0.5;
        
        const xScale = (index) => padding.left + (index / (this.data.length - 1)) * chartWidth;
        const yScale = (value) => padding.top + chartHeight - ((value - minVal) / (maxVal - minVal)) * chartHeight;
        
        this.ctx.beginPath();
        this.ctx.moveTo(xScale(0), yScale(this.data[0].value));
        
        for (let i = 1; i < this.data.length; i++) {
            const x = xScale(i);
            const y = yScale(this.data[i].value);
            
            const prevX = xScale(i - 1);
            const prevY = yScale(this.data[i - 1].value);
            
            const cpX = (prevX + x) / 2;
            this.ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
        }
        
        const lastX = xScale(this.data.length - 1);
        const lastY = yScale(this.data[this.data.length - 1].value);
        this.ctx.lineTo(lastX, lastY);
        
        this.ctx.strokeStyle = this.lineColor;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        
        this.ctx.lineTo(lastX, padding.top + chartHeight);
        this.ctx.lineTo(padding.left, padding.top + chartHeight);
        this.ctx.closePath();
        this.ctx.fillStyle = this.fillColor;
        this.ctx.fill();
        
        this.drawAxes(padding, chartWidth, chartHeight, minVal, maxVal);
        
        this.ctx.fillStyle = '#ef4444';
        this.ctx.beginPath();
        this.ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
        this.ctx.fill();
        
        this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(padding.left, lastY);
        this.ctx.lineTo(padding.left + chartWidth, lastY);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    drawGrid(padding, chartWidth, chartHeight) {
        this.ctx.strokeStyle = this.gridColor;
        this.ctx.lineWidth = 1;
        
        const gridRows = 5;
        for (let i = 0; i <= gridRows; i++) {
            const y = padding.top + (i / gridRows) * chartHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(padding.left, y);
            this.ctx.lineTo(padding.left + chartWidth, y);
            this.ctx.stroke();
        }
        
        const gridCols = 10;
        for (let i = 0; i <= gridCols; i++) {
            const x = padding.left + (i / gridCols) * chartWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(x, padding.top);
            this.ctx.lineTo(x, padding.top + chartHeight);
            this.ctx.stroke();
        }
    }

    drawAxes(padding, chartWidth, chartHeight, minVal, maxVal) {
        this.ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
        this.ctx.lineWidth = 2;
        
        this.ctx.beginPath();
        this.ctx.moveTo(padding.left, padding.top);
        this.ctx.lineTo(padding.left, padding.top + chartHeight);
        this.ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        this.ctx.stroke();
        
        this.ctx.fillStyle = '#94a3b8';
        this.ctx.font = '11px sans-serif';
        this.ctx.textAlign = 'right';
        
        const gridRows = 5;
        for (let i = 0; i <= gridRows; i++) {
            const y = padding.top + (i / gridRows) * chartHeight;
            const value = maxVal - (i / gridRows) * (maxVal - minVal);
            this.ctx.fillText(value.toFixed(1), padding.left - 5, y + 4);
        }
        
        this.ctx.textAlign = 'center';
        this.ctx.fillText('瞳孔直径 (mm)', padding.left / 2, padding.top + chartHeight / 2);
        
        this.ctx.fillText('时间', padding.left + chartWidth / 2, padding.top + chartHeight + 20);
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

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = rect.width;
        this.height = rect.height;
    }

    getStats() {
        return { ...this.stats };
    }
}
