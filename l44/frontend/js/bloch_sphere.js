class BlochSphere {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container ${containerId} not found`);
        }

        this.options = {
            radius: 1.5,
            autoRotate: true,
            showGrid: true,
            showLabels: true,
            pointSize: 0.05,
            backgroundColor: 0x0a0a1a,
            ...options
        };

        this.statePoints = [];
        this.interpolationPoints = [];
        this.currentQubitIndex = 0;

        this.init();
        this.setupEventListeners();
        this.animate();
    }

    init() {
        const rect = this.container.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.options.backgroundColor);

        this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 1000);
        this.camera.position.z = 4;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        const canvas = this.container.querySelector('canvas');
        if (canvas) {
            canvas.remove();
        }
        this.container.appendChild(this.renderer.domElement);

        this.setupLighting();
        this.createSphere();
        this.createAxes();
        this.createGrid();
        this.createLabels();
        this.createStatePoint();

        this.controls = {
            isDragging: false,
            previousMousePosition: { x: 0, y: 0 },
            rotation: { x: 0, y: 0 }
        };
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        this.scene.add(directionalLight);

        const pointLight = new THREE.PointLight(0x00d4ff, 0.5, 10);
        pointLight.position.set(0, 0, 3);
        this.scene.add(pointLight);
    }

    createSphere() {
        const geometry = new THREE.SphereGeometry(this.options.radius, 64, 64);
        const material = new THREE.MeshPhongMaterial({
            color: 0x1a3a5c,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide,
            shininess: 100
        });
        this.sphere = new THREE.Mesh(geometry, material);
        this.scene.add(this.sphere);

        const wireframeGeometry = new THREE.SphereGeometry(this.options.radius, 32, 32);
        const wireframeMaterial = new THREE.MeshBasicMaterial({
            color: 0x00d4ff,
            wireframe: true,
            transparent: true,
            opacity: 0.15
        });
        this.wireframe = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
        this.scene.add(this.wireframe);
    }

    createAxes() {
        const axisLength = this.options.radius * 1.1;
        const axisWidth = 2;

        const xGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-axisLength, 0, 0),
            new THREE.Vector3(axisLength, 0, 0)
        ]);
        const xMaterial = new THREE.LineBasicMaterial({ color: 0xff6b6b, linewidth: axisWidth });
        this.xAxis = new THREE.Line(xGeometry, xMaterial);
        this.scene.add(this.xAxis);

        const yGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, -axisLength, 0),
            new THREE.Vector3(0, axisLength, 0)
        ]);
        const yMaterial = new THREE.LineBasicMaterial({ color: 0x51cf66, linewidth: axisWidth });
        this.yAxis = new THREE.Line(yGeometry, yMaterial);
        this.scene.add(this.yAxis);

        const zGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, -axisLength),
            new THREE.Vector3(0, 0, axisLength)
        ]);
        const zMaterial = new THREE.LineBasicMaterial({ color: 0x4dabf7, linewidth: axisWidth });
        this.zAxis = new THREE.Line(zGeometry, zMaterial);
        this.scene.add(this.zAxis);

        this.createArrow(new THREE.Vector3(axisLength, 0, 0), 0xff6b6b);
        this.createArrow(new THREE.Vector3(0, axisLength, 0), 0x51cf66);
        this.createArrow(new THREE.Vector3(0, 0, axisLength), 0x4dabf7);

        const equatorGeometry = new THREE.BufferGeometry();
        const equatorPoints = [];
        for (let i = 0; i <= 64; i++) {
            const angle = (i / 64) * Math.PI * 2;
            equatorPoints.push(new THREE.Vector3(
                Math.cos(angle) * this.options.radius,
                0,
                Math.sin(angle) * this.options.radius
            ));
        }
        equatorGeometry.setFromPoints(equatorPoints);
        const equatorMaterial = new THREE.LineDashedMaterial({
            color: 0xffffff,
            dashSize: 0.1,
            gapSize: 0.05,
            transparent: true,
            opacity: 0.4
        });
        const equator = new THREE.Line(equatorGeometry, equatorMaterial);
        equator.computeLineDistances();
        this.scene.add(equator);
    }

    createArrow(position, color) {
        const direction = position.clone().normalize();
        const arrowHelper = new THREE.ArrowHelper(
            direction,
            new THREE.Vector3(0, 0, 0),
            position.length(),
            color,
            0.1,
            0.06
        );
        this.scene.add(arrowHelper);
    }

    createGrid() {
        this.gridGroup = new THREE.Group();

        for (let phi = 0; phi < Math.PI; phi += Math.PI / 6) {
            const points = [];
            for (let theta = 0; theta <= Math.PI * 2; theta += Math.PI / 32) {
                points.push(new THREE.Vector3(
                    this.options.radius * Math.sin(phi) * Math.cos(theta),
                    this.options.radius * Math.cos(phi),
                    this.options.radius * Math.sin(phi) * Math.sin(theta)
                ));
            }
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({
                color: 0x00d4ff,
                transparent: true,
                opacity: 0.1
            });
            const line = new THREE.Line(geometry, material);
            this.gridGroup.add(line);
        }

        for (let theta = 0; theta < Math.PI; theta += Math.PI / 6) {
            const points = [];
            for (let phi = 0; phi <= Math.PI; phi += Math.PI / 32) {
                points.push(new THREE.Vector3(
                    this.options.radius * Math.sin(phi) * Math.cos(theta),
                    this.options.radius * Math.cos(phi),
                    this.options.radius * Math.sin(phi) * Math.sin(theta)
                ));
            }
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({
                color: 0x00d4ff,
                transparent: true,
                opacity: 0.1
            });
            const line = new THREE.Line(geometry, material);
            this.gridGroup.add(line);
        }

        this.scene.add(this.gridGroup);
        this.gridGroup.visible = this.options.showGrid;
    }

    createLabels() {
        this.labelsGroup = new THREE.Group();

        const labelPositions = [
            { pos: [0, this.options.radius * 1.2, 0], text: '|0⟩', color: 0x4dabf7 },
            { pos: [0, -this.options.radius * 1.2, 0], text: '|1⟩', color: 0x4dabf7 },
            { pos: [this.options.radius * 1.2, 0, 0], text: 'X', color: 0xff6b6b },
            { pos: [0, 0, this.options.radius * 1.2], text: 'Y', color: 0x51cf66 },
            { pos: [0, 0, -this.options.radius * 1.2], text: '-Y', color: 0x51cf66 }
        ];

        this.labelSprites = [];
        labelPositions.forEach(({ pos, text, color }) => {
            const sprite = this.createTextSprite(text, color);
            sprite.position.set(...pos);
            this.labelsGroup.add(sprite);
            this.labelSprites.push(sprite);
        });

        this.scene.add(this.labelsGroup);
        this.labelsGroup.visible = this.options.showLabels;
    }

    createTextSprite(text, color) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 64;

        context.fillStyle = 'transparent';
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.font = 'bold 32px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = '#' + color.toString(16).padStart(6, '0');
        context.shadowColor = 'rgba(0, 0, 0, 0.8)';
        context.shadowBlur = 10;
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(0.3, 0.15, 1);
        return sprite;
    }

    createStatePoint() {
        const geometry = new THREE.SphereGeometry(this.options.pointSize, 32, 32);
        const material = new THREE.MeshPhongMaterial({
            color: 0x00ff88,
            emissive: 0x00ff88,
            emissiveIntensity: 0.5,
            shininess: 100
        });
        this.statePoint = new THREE.Mesh(geometry, material);
        this.statePoint.position.set(0, 0, this.options.radius);
        this.scene.add(this.statePoint);

        const trailGeometry = new THREE.BufferGeometry();
        this.trailPositions = new Float32Array(100 * 3);
        trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
        const trailMaterial = new THREE.LineBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.5
        });
        this.stateTrail = new THREE.Line(trailGeometry, trailMaterial);
        this.scene.add(this.stateTrail);
        this.trailIndex = 0;

        this.createOrbit();
    }

    createOrbit() {
        const orbitGeometry = new THREE.BufferGeometry();
        const orbitPoints = [];
        for (let i = 0; i <= 100; i++) {
            const angle = (i / 100) * Math.PI * 2;
            orbitPoints.push(new THREE.Vector3(
                this.options.radius * Math.cos(angle),
                0,
                this.options.radius * Math.sin(angle)
            ));
        }
        orbitGeometry.setFromPoints(orbitPoints);
        const orbitMaterial = new THREE.LineDashedMaterial({
            color: 0xffd43b,
            dashSize: 0.05,
            gapSize: 0.05,
            transparent: true,
            opacity: 0.6
        });
        this.orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
        this.orbitLine.computeLineDistances();
        this.orbitLine.visible = false;
        this.scene.add(this.orbitLine);
    }

    updateStatePoint(x, y, z, animated = true) {
        const radius = this.options.radius;
        const targetX = x * radius;
        const targetY = y * radius;
        const targetZ = z * radius;

        if (animated) {
            this.animateStatePoint(targetX, targetY, targetZ);
        } else {
            this.statePoint.position.set(targetX, targetY, targetZ);
        }

        this.trailPositions[this.trailIndex * 3] = targetX;
        this.trailPositions[this.trailIndex * 3 + 1] = targetY;
        this.trailPositions[this.trailIndex * 3 + 2] = targetZ;
        this.trailIndex = (this.trailIndex + 1) % 100;

        for (let i = 0; i < this.trailIndex; i++) {
            const idx = (this.trailIndex - 1 - i + 100) % 100;
            this.trailPositions[idx * 3] = this.trailPositions[((idx + 1) % 100) * 3];
            this.trailPositions[idx * 3 + 1] = this.trailPositions[((idx + 1) % 100) * 3 + 1];
            this.trailPositions[idx * 3 + 2] = this.trailPositions[((idx + 1) % 100) * 3 + 2];
        }

        this.stateTrail.geometry.attributes.position.needsUpdate = true;
    }

    animateStatePoint(targetX, targetY, targetZ) {
        const startPos = this.statePoint.position.clone();
        const endPos = new THREE.Vector3(targetX, targetY, targetZ);
        const duration = 500;
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);

            const startQ = this.vectorToQuaternion(startPos);
            const endQ = this.vectorToQuaternion(endPos);
            const interpQ = this.quaternionSlerp(startQ, endQ, eased);
            const interpDir = this.quaternionToVector(interpQ);
            const interpPos = interpDir.multiplyScalar(this.options.radius);

            this.statePoint.position.copy(interpPos);

            if (t < 1) {
                requestAnimationFrame(animate);
            }
        };

        animate();
    }

    vectorToQuaternion(v) {
        const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (len < 1e-10) {
            return { x: 0, y: 0, z: 0, w: 1 };
        }
        const nx = v.x / len;
        const ny = v.y / len;
        const nz = v.z / len;

        const theta = Math.acos(Math.max(-1, Math.min(1, nz)));
        const phi = Math.atan2(ny, nx);

        const halfTheta = theta / 2;
        const w = Math.cos(halfTheta);
        const qx = Math.sin(halfTheta) * Math.cos(phi);
        const qy = Math.sin(halfTheta) * Math.sin(phi);

        const norm = Math.sqrt(w * w + qx * qx + qy * qy);
        if (norm < 1e-15) {
            return { x: 0, y: 0, z: 0, w: 1 };
        }
        return { x: qx / norm, y: qy / norm, z: 0, w: w / norm };
    }

    quaternionToVector(q) {
        const norm = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
        if (norm < 1e-15) {
            return new THREE.Vector3(0, 0, 1);
        }
        const w = q.w / norm;
        const qx = q.x / norm;
        const qy = q.y / norm;

        const theta = 2 * Math.acos(Math.max(0, Math.min(1, Math.abs(w))));

        const sinHalf = Math.sqrt(qx * qx + qy * qy);
        if (sinHalf < 1e-10) {
            return new THREE.Vector3(0, 0, w >= 0 ? 1 : -1);
        }

        const phi = Math.atan2(qy, qx);
        const x = Math.sin(theta) * Math.cos(phi);
        const y = Math.sin(theta) * Math.sin(phi);
        const z = Math.cos(theta);

        return new THREE.Vector3(x, y, z).normalize();
    }

    quaternionSlerp(q1, q2, t) {
        const n1 = Math.sqrt(q1.w * q1.w + q1.x * q1.x + q1.y * q1.y + q1.z * q1.z);
        const n2 = Math.sqrt(q2.w * q2.w + q2.x * q2.x + q2.y * q2.y + q2.z * q2.z);
        if (n1 < 1e-15 || n2 < 1e-15) return q1;

        let qx1 = q1.x / n1, qy1 = q1.y / n1, qz1 = q1.z / n1, qw1 = q1.w / n1;
        let qx2 = q2.x / n2, qy2 = q2.y / n2, qz2 = q2.z / n2, qw2 = q2.w / n2;

        let dot = qx1 * qx2 + qy1 * qy2 + qz1 * qz2 + qw1 * qw2;

        if (dot < 0) {
            qx2 = -qx2; qy2 = -qy2; qz2 = -qz2; qw2 = -qw2;
            dot = -dot;
        }

        dot = Math.min(dot, 1.0);

        let rx, ry, rz, rw;
        if (dot > 0.9995) {
            rx = qx1 + t * (qx2 - qx1);
            ry = qy1 + t * (qy2 - qy1);
            rz = qz1 + t * (qz2 - qz1);
            rw = qw1 + t * (qw2 - qw1);
        } else {
            const theta_0 = Math.acos(dot);
            const sin_theta_0 = Math.sin(theta_0);
            const theta = theta_0 * t;
            const sin_theta = Math.sin(theta);

            const s0 = Math.cos(theta) - dot * sin_theta / sin_theta_0;
            const s1 = sin_theta / sin_theta_0;

            rx = s0 * qx1 + s1 * qx2;
            ry = s0 * qy1 + s1 * qy2;
            rz = s0 * qz1 + s1 * qz2;
            rw = s0 * qw1 + s1 * qw2;
        }

        const rn = Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw);
        if (rn < 1e-15) return { x: 0, y: 0, z: 0, w: 1 };
        return { x: rx / rn, y: ry / rn, z: rz / rn, w: rw / rn };
    }

    showInterpolationPath(points) {
        this.clearInterpolation();

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(points.length * 3);

        for (let i = 0; i < points.length; i++) {
            positions[i * 3] = points[i].x * this.options.radius;
            positions[i * 3 + 1] = points[i].y * this.options.radius;
            positions[i * 3 + 2] = points[i].z * this.options.radius;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: 0xffd43b,
            transparent: true,
            opacity: 0.8,
            linewidth: 3
        });

        this.interpolationLine = new THREE.Line(geometry, material);
        this.scene.add(this.interpolationLine);

        points.forEach((point, index) => {
            const dotGeometry = new THREE.SphereGeometry(0.02, 8, 8);
            const dotMaterial = new THREE.MeshBasicMaterial({
                color: 0xffd43b,
                transparent: true,
                opacity: 0.6
            });
            const dot = new THREE.Mesh(dotGeometry, dotMaterial);
            dot.position.set(
                point.x * this.options.radius,
                point.y * this.options.radius,
                point.z * this.options.radius
            );
            this.interpolationPoints.push(dot);
            this.scene.add(dot);
        });
    }

    clearInterpolation() {
        if (this.interpolationLine) {
            this.scene.remove(this.interpolationLine);
            this.interpolationLine = null;
        }
        this.interpolationPoints.forEach(point => {
            this.scene.remove(point);
        });
        this.interpolationPoints = [];
    }

    animateInterpolation(points, onUpdate, onComplete) {
        this.showInterpolationPath(points);

        let currentIndex = 0;

        const animateStep = () => {
            if (currentIndex < points.length) {
                const point = points[currentIndex];
                this.updateStatePoint(point.x, point.y, point.z, false);

                if (onUpdate) {
                    onUpdate(point, currentIndex, points.length);
                }

                currentIndex++;
                setTimeout(animateStep, 20);
            } else if (onComplete) {
                onComplete();
            }
        };

        animateStep();
    }

    setupEventListeners() {
        const canvas = this.renderer.domElement;

        canvas.addEventListener('mousedown', (e) => {
            this.controls.isDragging = true;
            this.controls.previousMousePosition = { x: e.clientX, y: e.clientY };
            this.options.autoRotate = false;

            if (this.onSphereClick) {
                const rect = canvas.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

                const intersects = raycaster.intersectObject(this.sphere);
                if (intersects.length > 0) {
                    const point = intersects[0].point.clone().normalize();
                    this.onSphereClick(point.x, point.y, point.z);
                }
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!this.controls.isDragging) return;

            const deltaX = e.clientX - this.controls.previousMousePosition.x;
            const deltaY = e.clientY - this.controls.previousMousePosition.y;

            this.controls.rotation.y += deltaX * 0.01;
            this.controls.rotation.x += deltaY * 0.01;

            this.controls.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.controls.rotation.x));

            this.controls.previousMousePosition = { x: e.clientX, y: e.clientY };
        });

        canvas.addEventListener('mouseup', () => {
            this.controls.isDragging = false;
        });

        canvas.addEventListener('mouseleave', () => {
            this.controls.isDragging = false;
        });

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.camera.position.z += e.deltaY * 0.01;
            this.camera.position.z = Math.max(2, Math.min(10, this.camera.position.z));
        });

        window.addEventListener('resize', () => {
            this.resize();
        });
    }

    resize() {
        const rect = this.container.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;

        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);
    }

    setAutoRotate(value) {
        this.options.autoRotate = value;
    }

    setShowGrid(value) {
        this.options.showGrid = value;
        this.gridGroup.visible = value;
    }

    setShowLabels(value) {
        this.options.showLabels = value;
        this.labelsGroup.visible = value;
    }

    setPointSize(size) {
        this.options.pointSize = size * 0.01;
        this.statePoint.scale.setScalar(size * 0.01 / 0.05);
    }

    setOnSphereClick(callback) {
        this.onSphereClick = callback;
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (this.options.autoRotate && !this.controls.isDragging) {
            this.controls.rotation.y += 0.003;
        }

        this.sphere.rotation.x = this.controls.rotation.x;
        this.sphere.rotation.y = this.controls.rotation.y;
        this.wireframe.rotation.x = this.controls.rotation.x;
        this.wireframe.rotation.y = this.controls.rotation.y;
        this.gridGroup.rotation.x = this.controls.rotation.x;
        this.gridGroup.rotation.y = this.controls.rotation.y;

        this.stateTrail.rotation.x = this.controls.rotation.x;
        this.stateTrail.rotation.y = this.controls.rotation.y;

        if (this.interpolationLine) {
            this.interpolationLine.rotation.x = this.controls.rotation.x;
            this.interpolationLine.rotation.y = this.controls.rotation.y;
        }
        this.interpolationPoints.forEach(point => {
            point.rotation.x = this.controls.rotation.x;
            point.rotation.y = this.controls.rotation.y;
        });

        this.labelSprites.forEach(sprite => {
            sprite.lookAt(this.camera.position);
        });

        this.renderer.render(this.scene, this.camera);
    }
}
