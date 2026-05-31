class SankeyChart {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' 
            ? document.getElementById(container) 
            : container;
        
        this.width = options.width || this.container.offsetWidth || 900;
        this.height = options.height || 500;
        this.nodeWidth = options.nodeWidth || 20;
        this.nodePadding = options.nodePadding || 30;
        this.margin = options.margin || { top: 20, right: 120, bottom: 20, left: 120 };
        
        this.nodes = [];
        this.links = [];
        this.patterns = [];
        this.scanPath = [];
        
        this.colorPalette = [
            '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
            '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6'
        ];
        
        this.onSequenceClick = null;
        
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.canvas.style.width = '100%';
        this.canvas.style.cursor = 'pointer';
        this.ctx = this.canvas.getContext('2d');
        
        this.container.innerHTML = '';
        this.container.appendChild(this.canvas);
        
        this.hoveredLink = null;
        this.hoveredNode = null;
        this.nodePositions = [];
        this.linkPositions = [];
        
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.canvas.addEventListener('mouseleave', () => {
            this.hoveredLink = null;
            this.hoveredNode = null;
            this.draw();
        });
    }

    setData(sankeyData, patterns, scanPath) {
        this.nodes = sankeyData.nodes || [];
        this.links = sankeyData.links || [];
        this.patterns = patterns || [];
        this.scanPath = scanPath || [];
        
        this.calculateLayout();
        this.draw();
    }

    calculateLayout() {
        if (this.nodes.length === 0) return;
        
        const maxStep = Math.max(...this.nodes.map(n => n.step));
        const stepCount = maxStep + 1;
        
        const drawWidth = this.width - this.margin.left - this.margin.right;
        const drawHeight = this.height - this.margin.top - this.margin.bottom;
        const stepWidth = stepCount > 1 ? drawWidth / (stepCount - 1) : drawWidth;
        
        const nodesByStep = {};
        this.nodes.forEach(node => {
            if (!nodesByStep[node.step]) nodesByStep[node.step] = [];
            nodesByStep[node.step].push(node);
        });
        
        this.nodePositions = [];
        const nodeMap = new Map();
        
        Object.keys(nodesByStep).forEach(step => {
            const stepNodes = nodesByStep[step];
            const totalFlow = stepNodes.reduce((sum, n) => sum + n.totalFlow, 0);
            const totalPadding = (stepNodes.length - 1) * this.nodePadding;
            const availableHeight = drawHeight - totalPadding;
            
            let yOffset = this.margin.top;
            
            stepNodes.sort((a, b) => b.totalFlow - a.totalFlow);
            
            stepNodes.forEach((node, i) => {
                const nodeHeight = Math.max(10, (node.totalFlow / totalFlow) * availableHeight);
                const x = this.margin.left + parseInt(step) * stepWidth - this.nodeWidth / 2;
                const y = yOffset;
                
                const pos = {
                    id: node.id,
                    aoiId: node.oiId || node.aoiId,
                    name: node.name,
                    step: parseInt(step),
                    x,
                    y,
                    width: this.nodeWidth,
                    height: nodeHeight,
                    totalFlow: node.totalFlow,
                    color: this.colorPalette[parseInt(step) % this.colorPalette.length]
                };
                
                this.nodePositions.push(pos);
                nodeMap.set(node.id, pos);
                yOffset += nodeHeight + this.nodePadding;
            });
        });
        
        this.linkPositions = this.links.map(link => {
            const source = nodeMap.get(link.source);
            const target = nodeMap.get(link.target);
            
            if (!source || !target) return null;
            
            return {
                source: { ...source },
                target: { ...target },
                value: link.value,
                sourceAOI: link.sourceAOI,
                targetAOI: link.targetAOI,
                sourceName: link.sourceName,
                targetName: link.targetName
            };
        }).filter(Boolean);
    }

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);
        
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, this.width, this.height);
        
        this.drawLinks(ctx);
        this.drawNodes(ctx);
        this.drawLabels(ctx);
        this.drawLegend(ctx);
    }

    drawLinks(ctx) {
        this.linkPositions.forEach((link, index) => {
            const isHovered = this.hoveredLink === index;
            const sourceX = link.source.x + link.source.width;
            const sourceY = link.source.y + link.source.height / 2;
            const targetX = link.target.x;
            const targetY = link.target.y + link.target.height / 2;
            
            const cpOffset = Math.abs(targetX - sourceX) * 0.4;
            
            ctx.beginPath();
            ctx.moveTo(sourceX, sourceY - link.value * 0.5);
            ctx.bezierCurveTo(
                sourceX + cpOffset, sourceY - link.value * 0.5,
                targetX - cpOffset, targetY - link.value * 0.5,
                targetX, targetY - link.value * 0.5
            );
            ctx.lineTo(targetX, targetY + link.value * 0.5);
            ctx.bezierCurveTo(
                targetX - cpOffset, targetY + link.value * 0.5,
                sourceX + cpOffset, sourceY + link.value * 0.5,
                sourceX, sourceY + link.value * 0.5
            );
            ctx.closePath();
            
            const alpha = isHovered ? 0.6 : 0.25;
            const sourceColor = link.source.color;
            ctx.fillStyle = this.hexToRgba(sourceColor, alpha);
            ctx.fill();
            
            if (isHovered) {
                ctx.strokeStyle = sourceColor;
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        });
    }

    drawNodes(ctx) {
        this.nodePositions.forEach((node, index) => {
            const isHovered = this.hoveredNode === index;
            
            ctx.fillStyle = isHovered ? this.lightenColor(node.color, 0.3) : node.color;
            ctx.strokeStyle = isHovered ? '#fff' : 'rgba(255,255,255,0.3)';
            ctx.lineWidth = isHovered ? 2 : 1;
            
            const radius = 4;
            ctx.beginPath();
            ctx.moveTo(node.x + radius, node.y);
            ctx.lineTo(node.x + node.width - radius, node.y);
            ctx.arcTo(node.x + node.width, node.y, node.x + node.width, node.y + radius, radius);
            ctx.lineTo(node.x + node.width, node.y + node.height - radius);
            ctx.arcTo(node.x + node.width, node.y + node.height, node.x + node.width - radius, node.y + node.height, radius);
            ctx.lineTo(node.x + radius, node.y + node.height);
            ctx.arcTo(node.x, node.y + node.height, node.x, node.y + node.height - radius, radius);
            ctx.lineTo(node.x, node.y + radius);
            ctx.arcTo(node.x, node.y, node.x + radius, node.y, radius);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        });
    }

    drawLabels(ctx) {
        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        
        this.nodePositions.forEach(node => {
            const centerX = node.x + node.width / 2;
            const centerY = node.y + node.height / 2;
            
            if (node.height > 20) {
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.fillText(node.name, centerX, centerY - 6);
                ctx.font = '10px "Segoe UI", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.fillText(`${node.totalFlow}`, centerX, centerY + 8);
                ctx.font = '12px "Segoe UI", sans-serif';
            }
            
            ctx.textAlign = 'right';
            ctx.fillStyle = node.color;
            const stepLabel = `Step ${node.step + 1}`;
            if (node.y - 15 > this.margin.top) {
                ctx.fillText(stepLabel, node.x + node.width / 2, node.y - 8);
            }
        });
        
        ctx.textAlign = 'left';
        ctx.font = '11px "Segoe UI", sans-serif';
        this.nodePositions.forEach(node => {
            if (node.step === 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                ctx.fillText(node.name, node.x - 5, node.y + node.height / 2);
                ctx.textAlign = 'right';
            }
        });
    }

    drawLegend(ctx) {
        if (this.patterns.length === 0) return;
        
        const topPatterns = this.patterns.slice(0, 8);
        const legendX = this.width - this.margin.right + 15;
        let legendY = this.margin.top;
        
        ctx.font = 'bold 11px "Segoe UI", sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'left';
        ctx.fillText('频繁序列', legendX, legendY);
        legendY += 18;
        
        ctx.font = '10px "Segoe UI", sans-serif';
        topPatterns.forEach(pattern => {
            const seqStr = pattern.pattern.join(' → ');
            const supportStr = `${(pattern.supportRate * 100).toFixed(1)}%`;
            
            ctx.fillStyle = this.colorPalette[pattern.pattern.length % this.colorPalette.length];
            ctx.fillRect(legendX, legendY - 6, 8, 8);
            
            ctx.fillStyle = '#e4e4e7';
            ctx.fillText(seqStr, legendX + 14, legendY);
            
            ctx.fillStyle = '#64748b';
            ctx.fillText(supportStr, legendX + 14, legendY + 12);
            
            legendY += 28;
        });
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.width / rect.width;
        const scaleY = this.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        let foundNode = null;
        let foundLink = null;
        
        for (let i = 0; i < this.nodePositions.length; i++) {
            const node = this.nodePositions[i];
            if (x >= node.x && x <= node.x + node.width &&
                y >= node.y && y <= node.y + node.height) {
                foundNode = i;
                break;
            }
        }
        
        if (foundNode === null) {
            for (let i = 0; i < this.linkPositions.length; i++) {
                const link = this.linkPositions[i];
                const midX = (link.source.x + link.target.x) / 2;
                const midY = (link.source.y + link.target.y) / 2;
                const dist = Math.sqrt((x - midX) ** 2 + (y - midY) ** 2);
                if (dist < 30) {
                    foundLink = i;
                    break;
                }
            }
        }
        
        if (foundNode !== this.hoveredNode || foundLink !== this.hoveredLink) {
            this.hoveredNode = foundNode;
            this.hoveredLink = foundLink;
            this.draw();
            
            if (foundLink !== null) {
                this.canvas.title = `${this.linkPositions[foundLink].sourceName} → ${this.linkPositions[foundLink].targetName}: ${this.linkPositions[foundLink].value} 次`;
            } else if (foundNode !== null) {
                this.canvas.title = `${this.nodePositions[foundNode].name}: ${this.nodePositions[foundNode].totalFlow} 次`;
            } else {
                this.canvas.title = '';
            }
        }
    }

    handleClick(e) {
        if (this.hoveredLink !== null && this.onSequenceClick) {
            const link = this.linkPositions[this.hoveredLink];
            const relatedPatterns = this.patterns.filter(p => {
                for (let i = 0; i < p.pattern.length - 1; i++) {
                    if (p.pattern[i] === link.sourceAOI && p.pattern[i + 1] === link.targetAOI) {
                        return true;
                    }
                }
                return false;
            });
            
            this.onSequenceClick({
                type: 'link',
                link,
                patterns: relatedPatterns,
                scanPath: this.scanPath
            });
        } else if (this.hoveredNode !== null && this.onSequenceClick) {
            const node = this.nodePositions[this.hoveredNode];
            this.onSequenceClick({
                type: 'node',
                node,
                scanPath: this.scanPath
            });
        }
    }

    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    lightenColor(hex, amount) {
        const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + Math.round(255 * amount));
        const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + Math.round(255 * amount));
        const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + Math.round(255 * amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    resize() {
        const rect = this.container.getBoundingClientRect();
        this.width = rect.width || 900;
        this.height = rect.height || 500;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        
        if (this.nodes.length > 0) {
            this.calculateLayout();
            this.draw();
        }
    }

    clear() {
        this.nodes = [];
        this.links = [];
        this.patterns = [];
        this.scanPath = [];
        this.nodePositions = [];
        this.linkPositions = [];
        this.ctx.clearRect(0, 0, this.width, this.height);
    }
}
