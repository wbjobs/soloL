class ThreeDRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.mesh = null;
        this.wireframe = null;
        this.currentVertices = null;
        this.currentFaces = null;
        this.currentColors = null;
        
        this.init();
    }
    
    init() {
        const container = this.canvas.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a202c);
        
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        this.camera.position.set(0, 0, 3);
        
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);
        
        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        directionalLight2.position.set(-1, -0.5, -1);
        this.scene.add(directionalLight2);
        
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 1.5;
        this.controls.maxDistance = 10;
        this.controls.target.set(0, 0, 0);
        
        this.addGrid();
        
        window.addEventListener('resize', () => this.onResize());
        
        this.animate();
    }
    
    addGrid() {
        const gridHelper = new THREE.GridHelper(5, 20, 0x4a5568, 0x2d3748);
        gridHelper.position.y = -1.5;
        this.scene.add(gridHelper);
    }
    
    updateMesh(vertices, faces, colors = null) {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
        
        if (this.wireframe) {
            this.scene.remove(this.wireframe);
            this.wireframe.geometry.dispose();
            this.wireframe.material.dispose();
        }
        
        this.currentVertices = vertices;
        this.currentFaces = faces;
        this.currentColors = colors;
        
        const geometry = new THREE.BufferGeometry();
        
        const positions = new Float32Array(vertices.length * 3);
        for (let i = 0; i < vertices.length; i++) {
            positions[i * 3] = vertices[i][0];
            positions[i * 3 + 1] = vertices[i][1];
            positions[i * 3 + 2] = vertices[i][2];
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const indices = new Uint32Array(faces.length * 3);
        for (let i = 0; i < faces.length; i++) {
            indices[i * 3] = faces[i][0];
            indices[i * 3 + 1] = faces[i][1];
            indices[i * 3 + 2] = faces[i][2];
        }
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        
        if (colors) {
            const colorArray = new Float32Array(colors.length * 3);
            for (let i = 0; i < colors.length; i++) {
                colorArray[i * 3] = colors[i][0] / 255;
                colorArray[i * 3 + 1] = colors[i][1] / 255;
                colorArray[i * 3 + 2] = colors[i][2] / 255;
            }
            geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
        }
        
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshPhongMaterial({
            vertexColors: colors ? true : false,
            color: colors ? 0xffffff : 0xe2b8a3,
            shininess: 50,
            side: THREE.DoubleSide
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);
        
        const wireframeMaterial = new THREE.LineBasicMaterial({
            color: 0x667eea,
            transparent: true,
            opacity: 0.1
        });
        this.wireframe = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            wireframeMaterial
        );
        this.scene.add(this.wireframe);
        
        this.fitCameraToMesh();
    }
    
    updateVertices(vertices) {
        if (!this.mesh) return;
        
        this.currentVertices = vertices;
        
        const positions = this.mesh.geometry.attributes.position;
        for (let i = 0; i < vertices.length; i++) {
            positions.setXYZ(i, vertices[i][0], vertices[i][1], vertices[i][2]);
        }
        positions.needsUpdate = true;
        
        this.mesh.geometry.computeVertexNormals();
        
        if (this.wireframe) {
            this.wireframe.geometry.dispose();
            this.wireframe.geometry = new THREE.EdgesGeometry(this.mesh.geometry);
        }
    }
    
    fitCameraToMesh() {
        if (!this.mesh) return;
        
        const box = new THREE.Box3().setFromObject(this.mesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / Math.sin(fov / 2));
        
        this.camera.position.set(center.x, center.y, center.z + cameraZ * 0.8);
        this.controls.target.copy(center);
        this.controls.update();
    }
    
    setView(view) {
        if (!this.mesh) return;
        
        const box = new THREE.Box3().setFromObject(this.mesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        
        let position;
        switch (view) {
            case 'front':
                position = new THREE.Vector3(center.x, center.y, center.z + maxDim * 1.5);
                break;
            case 'side':
                position = new THREE.Vector3(center.x + maxDim * 1.5, center.y, center.z);
                break;
            case 'top':
                position = new THREE.Vector3(center.x, center.y + maxDim * 1.5, center.z);
                break;
            case 'reset':
                position = new THREE.Vector3(0, 0, 3);
                this.controls.target.set(0, 0, 0);
                this.camera.position.copy(position);
                this.controls.update();
                return;
            default:
                return;
        }
        
        this.camera.position.copy(position);
        this.controls.target.copy(center);
        this.controls.update();
    }
    
    getRotationInfo() {
        if (!this.controls) return { elev: 0, azim: 0, zoom: 1 };
        
        const target = this.controls.target;
        const position = this.camera.position;
        
        const dx = position.x - target.x;
        const dy = position.y - target.y;
        const dz = position.z - target.z;
        
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const elev = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;
        const azim = Math.atan2(dx, dz) * 180 / Math.PI;
        
        return {
            elev: elev.toFixed(1),
            azim: azim.toFixed(1),
            zoom: (3 / distance).toFixed(2)
        };
    }
    
    clearMesh() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
        }
        if (this.wireframe) {
            this.scene.remove(this.wireframe);
            this.wireframe.geometry.dispose();
            this.wireframe.material.dispose();
            this.wireframe = null;
        }
        this.currentVertices = null;
        this.currentFaces = null;
        this.currentColors = null;
    }
    
    exportMesh(filename = 'face_mesh.obj') {
        if (!this.currentVertices || !this.currentFaces) return null;
        
        let content = '# 3D Face Mesh\n';
        content += '# Generated by 3D Face Reconstruction System\n\n';
        
        for (const v of this.currentVertices) {
            content += `v ${v[0]} ${v[1]} ${v[2]}\n`;
        }
        
        if (this.currentColors) {
            content += '\n';
            for (const c of this.currentColors) {
                content += `vc ${c[0]/255} ${c[1]/255} ${c[2]/255}\n`;
            }
        }
        
        content += '\n';
        for (const f of this.currentFaces) {
            content += `f ${f[0]+1} ${f[1]+1} ${f[2]+1}\n`;
        }
        
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
        
        return content;
    }
    
    captureImage() {
        this.renderer.render(this.scene, this.camera);
        return this.canvas.toDataURL('image/png');
    }
    
    onResize() {
        const container = this.canvas.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        
        if (this.onRotationChange) {
            this.onRotationChange(this.getRotationInfo());
        }
    }
}
