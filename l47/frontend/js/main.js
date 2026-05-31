class FaceReconstructionApp {
    constructor() {
        this.renderer = new ThreeDRenderer('threeCanvas');
        this.currentParams = null;
        this.currentMesh = null;
        this.currentImage = null;
        this.expressionPresets = null;
        this.exprDim = 50;
        this.currentExpression = null;
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.checkBackendStatus();
        this.loadExpressionPresets();
        this.setupRendererCallbacks();
        
        setInterval(() => this.checkBackendStatus(), 5000);
    }
    
    setupEventListeners() {
        const uploadArea = document.getElementById('uploadArea');
        const imageInput = document.getElementById('imageInput');
        const videoUploadArea = document.getElementById('videoUploadArea');
        const videoInput = document.getElementById('videoInput');
        
        uploadArea.addEventListener('click', () => imageInput.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleImageFile(files[0]);
            }
        });
        imageInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleImageFile(e.target.files[0]);
            }
        });
        
        videoUploadArea.addEventListener('click', () => videoInput.click());
        videoUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            videoUploadArea.classList.add('dragover');
        });
        videoUploadArea.addEventListener('dragleave', () => {
            videoUploadArea.classList.remove('dragover');
        });
        videoUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            videoUploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleVideoFile(files[0]);
            }
        });
        videoInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleVideoFile(e.target.files[0]);
            }
        });
        
        document.getElementById('reconstructBtn').addEventListener('click', () => {
            this.reconstructFace();
        });
        
        document.getElementById('transferBtn').addEventListener('click', () => {
            this.transferExpressionFromVideo();
        });
        
        document.getElementById('interpolateBtn').addEventListener('click', () => {
            this.generateInterpolation();
        });
        
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const exprType = btn.dataset.expr;
                this.applyExpressionPreset(exprType);
            });
        });
        
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                this.renderer.setView(view);
            });
        });
        
        document.getElementById('elevSlider').addEventListener('input', (e) => {
            document.getElementById('elevValue').textContent = e.target.value + '°';
        });
        
        document.getElementById('azimSlider').addEventListener('input', (e) => {
            document.getElementById('azimValue').textContent = e.target.value + '°';
        });
        
        document.getElementById('renderRotatedBtn').addEventListener('click', () => {
            this.renderRotatedView();
        });
        
        document.getElementById('exportMeshBtn').addEventListener('click', () => {
            this.exportMesh();
        });
        
        document.getElementById('exportParamsBtn').addEventListener('click', () => {
            this.exportParams();
        });
        
        document.getElementById('exportImageBtn').addEventListener('click', () => {
            this.exportImage();
        });
    }
    
    setupRendererCallbacks() {
        this.renderer.onRotationChange = (info) => {
            document.getElementById('rotationInfo').textContent = 
                `旋转: (${info.elev}°, ${info.azim}°)`;
            document.getElementById('zoomInfo').textContent = 
                `缩放: ${info.zoom}x`;
        };
    }
    
    async checkBackendStatus() {
        try {
            const response = await fetch('/api/health');
            const data = await response.json();
            
            const backendStatus = document.getElementById('backendStatus');
            const deviceStatus = document.getElementById('deviceStatus');
            const modelStatus = document.getElementById('modelStatus');
            
            backendStatus.textContent = '在线';
            backendStatus.className = 'status-value online';
            deviceStatus.textContent = data.device;
            modelStatus.textContent = data.models_loaded ? '已加载' : '未加载';
        } catch (e) {
            const backendStatus = document.getElementById('backendStatus');
            backendStatus.textContent = '离线';
            backendStatus.className = 'status-value offline';
        }
    }
    
    async loadExpressionPresets() {
        try {
            const response = await fetch('/api/get_presets');
            const data = await response.json();
            
            if (data.success) {
                this.expressionPresets = data.presets;
                this.exprDim = data.expr_dim;
                this.createExpressionSliders();
            }
        } catch (e) {
            console.error('Failed to load expression presets:', e);
            this.expressionPresets = {
                'neutral': Array(50).fill(0),
                'smile': Array(50).fill(0)
            };
            this.expressionPresets['smile'][0] = 2;
            this.expressionPresets['smile'][1] = 1.5;
            this.createExpressionSliders();
        }
    }
    
    createExpressionSliders() {
        const container = document.getElementById('expressionSliders');
        container.innerHTML = '';
        
        const numSliders = Math.min(20, this.exprDim);
        
        for (let i = 0; i < numSliders; i++) {
            const sliderDiv = document.createElement('div');
            sliderDiv.className = 'slider-item';
            
            sliderDiv.innerHTML = `
                <label>表情维度 ${i + 1}: <span class="slider-value" id="exprVal_${i}">0.00</span></label>
                <input type="range" id="exprSlider_${i}" min="-3" max="3" step="0.01" value="0">
            `;
            
            container.appendChild(sliderDiv);
            
            const slider = sliderDiv.querySelector(`#exprSlider_${i}`);
            const valueSpan = sliderDiv.querySelector(`#exprVal_${i}`);
            
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                valueSpan.textContent = value.toFixed(2);
                this.updateExpressionFromSliders();
            });
        }
        
        this.currentExpression = Array(this.exprDim).fill(0);
    }
    
    updateExpressionFromSliders() {
        if (!this.currentExpression) return;
        
        for (let i = 0; i < Math.min(20, this.exprDim); i++) {
            const slider = document.getElementById(`exprSlider_${i}`);
            if (slider) {
                this.currentExpression[i] = parseFloat(slider.value);
            }
        }
        
        this.applyExpression(this.currentExpression);
    }
    
    handleImageFile(file) {
        if (!file.type.startsWith('image/')) {
            this.showNotification('请上传图片文件', 'error');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            this.currentImage = e.target.result;
            const previewImg = document.getElementById('previewImg');
            previewImg.src = this.currentImage;
            document.getElementById('uploadPreview').style.display = 'block';
            document.getElementById('reconstructBtn').disabled = false;
        };
        reader.readAsDataURL(file);
    }
    
    handleVideoFile(file) {
        if (!file.type.startsWith('video/')) {
            this.showNotification('请上传视频文件', 'error');
            return;
        }
        
        this.currentVideoFile = file;
        document.getElementById('transferBtn').disabled = false;
        this.showNotification('视频已就绪，可以开始表情迁移', 'success');
    }
    
    async reconstructFace() {
        if (!this.currentImage) {
            this.showNotification('请先上传图片', 'error');
            return;
        }
        
        this.showLoading('正在重建3D人脸...');
        
        try {
            const base64Data = this.currentImage.split(',')[1];
            
            const response = await fetch('/api/reconstruct', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    image_base64: base64Data
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.currentParams = data.params;
                this.currentMesh = data.mesh;
                
                document.getElementById('originalImage').src = 'data:image/png;base64,' + data.original_image;
                document.getElementById('originalImage').style.display = 'block';
                document.getElementById('originalPlaceholder').style.display = 'none';
                
                document.getElementById('renderedImage').src = 'data:image/png;base64,' + data.rendered_image;
                document.getElementById('renderedImage').style.display = 'block';
                document.getElementById('renderedPlaceholder').style.display = 'none';
                
                document.getElementById('landmarksImage').src = 'data:image/png;base64,' + data.landmarks_image;
                document.getElementById('landmarksImage').style.display = 'block';
                document.getElementById('landmarksPlaceholder').style.display = 'none';
                
                this.renderer.updateMesh(
                    data.mesh.vertices,
                    data.mesh.faces,
                    data.mesh.colors
                );
                
                document.getElementById('canvasPlaceholder').style.display = 'none';
                
                this.updateParamsDisplay(data.params);
                
                this.currentExpression = [...data.params.expr];
                this.updateSlidersFromExpression(this.currentExpression);
                
                document.getElementById('renderRotatedBtn').disabled = false;
                document.getElementById('exportMeshBtn').disabled = false;
                document.getElementById('exportParamsBtn').disabled = false;
                document.getElementById('exportImageBtn').disabled = false;
                
                this.showNotification('3D人脸重建完成！', 'success');
            } else {
                this.showNotification('重建失败: ' + data.error, 'error');
            }
        } catch (e) {
            console.error('Reconstruction error:', e);
            this.showNotification('重建失败: ' + e.message, 'error');
        }
        
        this.hideLoading();
    }
    
    async applyExpression(expression) {
        if (!this.currentParams) {
            this.showNotification('请先进行人脸重建', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/apply_expression', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    expression: expression
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                document.getElementById('renderedImage').src = 'data:image/png;base64,' + data.rendered_image;
                
                this.renderer.updateVertices(data.vertices);
                
                this.currentExpression = expression;
            }
        } catch (e) {
            console.error('Expression application error:', e);
        }
    }
    
    async applyExpressionPreset(presetName) {
        if (!this.expressionPresets || !this.expressionPresets[presetName]) {
            return;
        }
        
        const expression = this.expressionPresets[presetName];
        this.currentExpression = expression;
        this.updateSlidersFromExpression(expression);
        await this.applyExpression(expression);
        this.showNotification(`已应用表情: ${presetName}`, 'info');
    }
    
    updateSlidersFromExpression(expression) {
        for (let i = 0; i < Math.min(20, expression.length); i++) {
            const slider = document.getElementById(`exprSlider_${i}`);
            const valueSpan = document.getElementById(`exprVal_${i}`);
            if (slider && valueSpan) {
                const value = expression[i] || 0;
                slider.value = value;
                valueSpan.textContent = value.toFixed(2);
            }
        }
    }
    
    async transferExpressionFromVideo() {
        if (!this.currentVideoFile) {
            this.showNotification('请先上传视频', 'error');
            return;
        }
        
        if (!this.currentParams) {
            this.showNotification('请先进行人脸重建', 'error');
            return;
        }
        
        this.showLoading('正在提取表情并生成视频...');
        
        try {
            const formData = new FormData();
            formData.append('video', this.currentVideoFile);
            
            const response = await fetch('/api/transfer_expression_video', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                const videoBlob = this.b64toBlob(data.video, 'video/mp4');
                const videoUrl = URL.createObjectURL(videoBlob);
                
                const outputVideo = document.getElementById('outputVideo');
                outputVideo.src = videoUrl;
                document.getElementById('videoResult').style.display = 'block';
                
                this.showNotification(`表情迁移完成！共 ${data.num_frames} 帧`, 'success');
            } else {
                this.showNotification('表情迁移失败: ' + data.error, 'error');
            }
        } catch (e) {
            console.error('Expression transfer error:', e);
            this.showNotification('表情迁移失败: ' + e.message, 'error');
        }
        
        this.hideLoading();
    }
    
    async generateInterpolation() {
        if (!this.currentParams) {
            this.showNotification('请先进行人脸重建', 'error');
            return;
        }
        
        this.showLoading('正在生成插值动画...');
        
        try {
            const expr1 = this.expressionPresets?.['neutral'] || Array(this.exprDim).fill(0);
            const expr2 = this.expressionPresets?.['smile'] || Array(this.exprDim).fill(0);
            expr2[0] = 2;
            
            const response = await fetch('/api/interpolate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    expr1: expr1,
                    expr2: expr2,
                    num_frames: 30
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.animateExpressionSequence(data.expressions, 0);
                this.showNotification('插值动画生成中...', 'info');
            }
        } catch (e) {
            console.error('Interpolation error:', e);
            this.showNotification('生成插值失败: ' + e.message, 'error');
        }
        
        this.hideLoading();
    }
    
    async animateExpressionSequence(expressions, index) {
        if (index >= expressions.length) return;
        
        await this.applyExpression(expressions[index]);
        
        setTimeout(() => {
            this.animateExpressionSequence(expressions, index + 1);
        }, 100);
    }
    
    async renderRotatedView() {
        const elev = parseFloat(document.getElementById('elevSlider').value);
        const azim = parseFloat(document.getElementById('azimSlider').value);
        
        try {
            const response = await fetch('/api/render_rotated', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    elev: elev,
                    azim: azim
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                document.getElementById('renderedImage').src = 'data:image/png;base64,' + data.rendered_image;
                this.showNotification('已渲染当前视角', 'info');
            }
        } catch (e) {
            console.error('Render error:', e);
        }
    }
    
    updateParamsDisplay(params) {
        document.getElementById('shapeParam').textContent = 
            `[${params.shape.slice(0, 3).map(v => v.toFixed(2)).join(', ')}, ...]`;
        document.getElementById('exprParam').textContent = 
            `[${params.expr.slice(0, 3).map(v => v.toFixed(2)).join(', ')}, ...]`;
        document.getElementById('poseParam').textContent = 
            `[${params.pose.map(v => v.toFixed(2)).join(', ')}]`;
        document.getElementById('texParam').textContent = 
            `[${params.tex.slice(0, 3).map(v => v.toFixed(2)).join(', ')}, ...]`;
        document.getElementById('camParam').textContent = 
            `[${params.cam.map(v => v.toFixed(2)).join(', ')}]`;
    }
    
    exportMesh() {
        if (this.renderer.currentVertices && this.renderer.currentFaces) {
            this.renderer.exportMesh('face_mesh.obj');
            this.showNotification('网格已导出', 'success');
        }
    }
    
    exportParams() {
        if (this.currentParams) {
            const paramsJson = JSON.stringify(this.currentParams, null, 2);
            const blob = new Blob([paramsJson], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'flame_params.json';
            link.click();
            URL.revokeObjectURL(url);
            this.showNotification('参数已导出', 'success');
        }
    }
    
    exportImage() {
        const imageData = this.renderer.captureImage();
        const link = document.createElement('a');
        link.href = imageData;
        link.download = 'face_render.png';
        link.click();
        this.showNotification('图像已导出', 'success');
    }
    
    showLoading(text = '处理中...') {
        document.getElementById('loadingText').textContent = text;
        document.getElementById('loadingOverlay').style.display = 'flex';
    }
    
    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    }
    
    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type} show`;
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }
    
    b64toBlob(b64Data, contentType = '', sliceSize = 512) {
        const byteCharacters = atob(b64Data);
        const byteArrays = [];
        
        for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);
            
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }
        
        const blob = new Blob(byteArrays, { type: contentType });
        return blob;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new FaceReconstructionApp();
});
