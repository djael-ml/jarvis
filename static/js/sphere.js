// Gestion de la Sphère Neuronale 3D (Three.js)

class NeuralSphere {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.state = 'idle'; // idle, thinking, speaking, sleeping
        this.audioLevel = 0;
        this.smoothedAudioLevel = 0;
        this.handLandmarks = null;
        
        this.particleCount = 600;
        this.baseRadius = 2.0;
        
        this.sphereLineIndices = [];
        
        // Clic et glisser de la souris/doigt pour la rotation manuelle avec inertie/amortissement
        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.targetRotation = { x: 0, y: 0 };
        this.manualRotation = { x: 0, y: 0 };
        
        // Paramètres interpolés pour la fluidité absolue des transitions de formes et tailles
        this.currentNoiseScale = 0.2;
        this.currentBaseScale = 1.0;
        this.currentSpeed = 0.6;
        this.currentParticleSize = 0.12;

        // Horloge pour éviter les sauts de phase/mouvement lors des changements de vitesse
        this.clock = new THREE.Clock();
        this.phase = 0;

        // Suivi et lissage des mains pour une attraction gel liquide progressive et sans secousse
        this.trackedHands = [
            { x: 0, y: 0, z: 0, weight: 0 },
            { x: 0, y: 0, z: 0, weight: 0 }
        ];

        // Filtre de stabilité temporelle (hystérésis) pour éviter les scintillements de pose de doigts
        this.currentPoseName = 'other';
        this.pendingPoseName = 'other';
        this.poseFrameCounter = 0;
        
        this.initThree();
        this.createSphere();
        this.setupStateParams();
        this.setupPoseParams();
        this.setupMouseInteractions();
        this.animate();
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    initThree() {
        // Scène
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x05060f, 0.05);

        // Caméra
        this.camera = new THREE.PerspectiveCamera(60, this.container.clientWidth / this.container.clientHeight, 0.1, 100);
        this.camera.position.z = 6;

        // Rendu
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setClearColor(0x05060f, 0); // Transparent pour voir le dégradé du fond
        this.container.appendChild(this.renderer.domElement);
    }

    createCircleTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 16, 16);
        return new THREE.CanvasTexture(canvas);
    }

    createSphere() {
        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(this.particleCount * 3);
        this.originalPositions = new Float32Array(this.particleCount * 3);

        for (let i = 0; i < this.particleCount; i++) {
            // Distribution uniforme sur une sphère (Golden Spiral)
            const phi = Math.acos(-1 + (2 * i) / this.particleCount);
            const theta = Math.sqrt(this.particleCount * Math.PI) * phi;
            
            const x = this.baseRadius * Math.sin(phi) * Math.cos(theta);
            const y = this.baseRadius * Math.sin(phi) * Math.sin(theta);
            const z = this.baseRadius * Math.cos(phi);

            const idx = i * 3;
            this.positions[idx] = x;
            this.positions[idx + 1] = y;
            this.positions[idx + 2] = z;

            this.originalPositions[idx] = x;
            this.originalPositions[idx + 1] = y;
            this.originalPositions[idx + 2] = z;
        }

        // Créer un attribut de position unique partagé
        this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
        this.geometry.setAttribute('position', this.positionAttribute);

        // Matériau des particules
        this.particleMaterial = new THREE.PointsMaterial({
            size: 0.12,
            map: this.createCircleTexture(),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            color: 0x00f0ff // Cyan par défaut
        });

        // Système de particules
        this.particleSystem = new THREE.Points(this.geometry, this.particleMaterial);
        this.scene.add(this.particleSystem);

        // Connexions pour le mode Sphère
        this.sphereLineIndices = [];
        for (let i = 0; i < this.particleCount; i++) {
            this.sphereLineIndices.push(i, (i + 1) % this.particleCount);
            this.sphereLineIndices.push(i, (i + 17) % this.particleCount);
            this.sphereLineIndices.push(i, (i + 43) % this.particleCount);
        }

        // Matériau commun des lignes
        this.lineMaterial = new THREE.LineBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending
        });

        // Lignes pour le mode Sphère (toujours visibles)
        this.sphereLineGeometry = new THREE.BufferGeometry();
        this.sphereLineGeometry.setAttribute('position', this.positionAttribute);
        this.sphereLineGeometry.setIndex(this.sphereLineIndices);
        this.sphereLines = new THREE.LineSegments(this.sphereLineGeometry, this.lineMaterial);
        this.scene.add(this.sphereLines);
    }

    setupStateParams() {
        // Paramètres par défaut de la sphère par rapport à l'état
        this.stateParams = {
            idle: { color: 0x00f0ff, speed: 0.6, noiseScale: 0.2, baseScale: 1.0, opacity: 0.25 },
            thinking: { color: 0xbd00ff, speed: 2.2, noiseScale: 0.4, baseScale: 1.1, opacity: 0.4 },
            speaking: { color: 0x00ff66, speed: 1.2, noiseScale: 0.3, baseScale: 1.0, opacity: 0.35 },
            sleeping: { color: 0x0044ff, speed: 0.15, noiseScale: 0.08, baseScale: 0.75, opacity: 0.1 }
        };
    }

    setupPoseParams() {
        // Paramètres de forme et de couleur pour chaque pose de la main
        this.poseParams = {
            fist: { color: 0xff3b30, noiseScale: 0.05, baseScale: 0.6, speed: 0.4, particleSize: 0.06 },     // Rouge, compact, lisse
            open: { color: 0x00f0ff, noiseScale: 0.22, baseScale: 1.15, speed: 0.7, particleSize: 0.12 },   // Cyan, large, ondulant
            victory: { color: 0xbd00ff, noiseScale: 0.45, baseScale: 1.0, speed: 2.0, particleSize: 0.14 },  // Violet, excité, rapide
            pointing: { color: 0xffcc00, noiseScale: 0.35, baseScale: 0.9, speed: 1.5, particleSize: 0.15 }, // Doré, concentré
            rock: { color: 0xff5e00, noiseScale: 0.6, baseScale: 1.1, speed: 2.5, particleSize: 0.13 },      // Orange électrique, chaotique
            other: { color: 0x00ff88, noiseScale: 0.25, baseScale: 1.0, speed: 1.0, particleSize: 0.12 }     // Émeraude par défaut
        };
    }

    setupMouseInteractions() {
        this.container.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Clic gauche
                this.isDragging = true;
                this.previousMousePosition = {
                    x: e.clientX,
                    y: e.clientY
                };
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const deltaMove = {
                    x: e.clientX - this.previousMousePosition.x,
                    y: e.clientY - this.previousMousePosition.y
                };

                const rotationSpeed = 0.005;
                this.targetRotation.y += deltaMove.x * rotationSpeed;
                this.targetRotation.x += deltaMove.y * rotationSpeed;

                this.previousMousePosition = {
                    x: e.clientX,
                    y: e.clientY
                };
            }
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        // Version Tactile
        this.container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                this.isDragging = true;
                this.previousMousePosition = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY
                };
            }
        });

        window.addEventListener('touchmove', (e) => {
            if (this.isDragging && e.touches.length === 1) {
                const deltaMove = {
                    x: e.touches[0].clientX - this.previousMousePosition.x,
                    y: e.touches[0].clientY - this.previousMousePosition.y
                };

                const rotationSpeed = 0.008;
                this.targetRotation.y += deltaMove.x * rotationSpeed;
                this.targetRotation.x += deltaMove.y * rotationSpeed;

                this.previousMousePosition = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY
                };
            }
        });

        window.addEventListener('touchend', () => {
            this.isDragging = false;
        });
    }

    detectHandPose(handLandmarks) {
        if (!handLandmarks || handLandmarks.length < 21) return 'other';
        
        // Un doigt est étendu si le bout (tip) est plus haut (Y plus petit) que l'articulation PIP (knuckle 2)
        const indexExtended = handLandmarks[8].y < handLandmarks[6].y;
        const middleExtended = handLandmarks[12].y < handLandmarks[10].y;
        const ringExtended = handLandmarks[16].y < handLandmarks[14].y;
        const pinkyExtended = handLandmarks[20].y < handLandmarks[18].y;

        // Classer les configurations des doigts en poses distinctes
        if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
            return 'fist'; // Poing
        }
        if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
            return 'open'; // Main ouverte
        }
        if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
            return 'victory'; // Signe de victoire / V
        }
        if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
            return 'pointing'; // Index pointé
        }
        if (indexExtended && !middleExtended && !ringExtended && pinkyExtended) {
            return 'rock'; // Signe Rock (Cornes)
        }
        
        return 'other';
    }

    updateSensorsState(micActive, camActive) {
        let baseColor = 0x00f0ff; // Cyan par défaut
        
        if (micActive && camActive) {
            baseColor = 0x00ff88; // Vert émeraude brillant
        } else if (micActive) {
            baseColor = 0x00f0ff; // Cyan
        } else if (camActive) {
            baseColor = 0xbd00ff; // Violet
        } else {
            baseColor = 0x445566; // Bleu grisâtre inactif
        }
        
        this.stateParams.idle.color = baseColor;
        this.stateParams.speaking.color = baseColor;
        
        // Si Jarvis dort, on utilise une pulsation bleu sombre s'il n'y a pas d'activité, ou une veille de senseurs
        this.stateParams.sleeping.color = (micActive || camActive) ? 0x0044ff : 0x112244;
    }

    setState(newState) {
        if (this.stateParams[newState]) {
            this.state = newState;
        }
    }

    updateAudioLevel(level) {
        this.audioLevel = level; // Attend une valeur entre 0 et 1
    }

    updateHandLandmarks(landmarks) {
        this.handLandmarks = landmarks; // Attend un tableau de tableaux de 21 landmarks format {x, y, z} ou null
    }

    updateParticleCount(newCount) {
        if (this.particleCount === newCount) return;
        
        // Supprimer les anciens objets de la scène
        this.scene.remove(this.particleSystem);
        if (this.sphereLines) this.scene.remove(this.sphereLines);
        
        // Libérer la mémoire WebGL
        if (this.geometry) this.geometry.dispose();
        if (this.sphereLineGeometry) this.sphereLineGeometry.dispose();
        if (this.particleMaterial) this.particleMaterial.dispose();
        if (this.lineMaterial) this.lineMaterial.dispose();
        
        this.particleCount = newCount;
        
        // Re-générer les points et connexions
        this.createSphere();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const params = this.stateParams[this.state];
        
        // Déterminer la pose et les paramètres cibles de rendu
        let targetColor = params.color;
        let targetNoiseScale = params.noiseScale;
        let targetBaseScale = params.baseScale;
        let targetSpeed = params.speed;
        let targetParticleSize = 0.12;

        const isHandActive = !!(this.handLandmarks && this.handLandmarks.length > 0);
        if (isHandActive && this.state !== 'sleeping') {
            const firstHand = this.handLandmarks[0];
            const rawPoseName = this.detectHandPose(firstHand);
            
            // Hystérésis / Filtre de stabilité temporelle anti-flicker pour la pose
            if (rawPoseName === this.currentPoseName) {
                this.poseFrameCounter = 0;
            } else {
                if (rawPoseName === this.pendingPoseName) {
                    this.poseFrameCounter++;
                    if (this.poseFrameCounter >= 8) { // 8 frames de stabilité pour valider le changement
                        this.currentPoseName = rawPoseName;
                        this.poseFrameCounter = 0;
                    }
                } else {
                    this.pendingPoseName = rawPoseName;
                    this.poseFrameCounter = 1;
                }
            }
            
            const pose = this.poseParams[this.currentPoseName];
            if (pose) {
                targetColor = pose.color;
                targetNoiseScale = pose.noiseScale;
                targetBaseScale = pose.baseScale;
                targetSpeed = pose.speed;
                targetParticleSize = pose.particleSize;
            }
        } else {
            // Réinitialiser en douceur l'état de la pose
            this.currentPoseName = 'other';
            this.pendingPoseName = 'other';
            this.poseFrameCounter = 0;
        }

        // Interpoler les paramètres de forme/mouvement pour un rendu fluide style gel liquide
        this.currentNoiseScale = THREE.MathUtils.lerp(this.currentNoiseScale, targetNoiseScale, 0.05);
        this.currentBaseScale = THREE.MathUtils.lerp(this.currentBaseScale, targetBaseScale, 0.05);
        this.currentSpeed = THREE.MathUtils.lerp(this.currentSpeed, targetSpeed, 0.05);
        this.currentParticleSize = THREE.MathUtils.lerp(this.currentParticleSize, targetParticleSize, 0.05);

        // Accumuler continuellement la phase en fonction du delta time réel (évite les sauts de phase/secousses)
        const delta = this.clock.getDelta();
        const cappedDelta = Math.min(delta, 0.1); // Sécurité anti-sauts si perte de focus
        this.phase += cappedDelta * this.currentSpeed;

        // Lissage du niveau audio local pour amortir les variations brusques
        this.smoothedAudioLevel = THREE.MathUtils.lerp(this.smoothedAudioLevel, this.audioLevel, 0.15);

        // Transition de couleur, opacité et taille de particules fluide
        this.particleMaterial.color.lerp(new THREE.Color(targetColor), 0.05);
        this.lineMaterial.color.lerp(new THREE.Color(targetColor), 0.05);
        this.lineMaterial.opacity = THREE.MathUtils.lerp(this.lineMaterial.opacity, params.opacity, 0.05);
        this.particleMaterial.size = this.currentParticleSize;

        // Interpoler la rotation manuelle pour une inertie glissante de rotation premium
        this.manualRotation.y = THREE.MathUtils.lerp(this.manualRotation.y, this.targetRotation.y, 0.08);
        this.manualRotation.x = THREE.MathUtils.lerp(this.manualRotation.x, this.targetRotation.x, 0.08);

        // Rotation lente combinée (auto-rotation lente + rotation manuelle utilisateur avec inertie)
        this.particleSystem.rotation.y = this.phase * 0.1 + this.manualRotation.y;
        this.particleSystem.rotation.x = this.phase * 0.05 + this.manualRotation.x;
        
        if (this.sphereLines) {
            this.sphereLines.rotation.y = this.particleSystem.rotation.y;
            this.sphereLines.rotation.x = this.particleSystem.rotation.x;
        }

        // Respiration organique dynamique basée sur la phase continue
        const breathSpeed = this.state === 'sleeping' ? 1.0 : 1.5;
        const breathAmp = this.state === 'sleeping' ? 0.03 : 0.06;
        const breath = Math.sin(this.phase * breathSpeed) * breathAmp;

        const positionsAttr = this.geometry.attributes.position;
        const posArray = positionsAttr.array;

        // Détection des positions 3D des mains pour la gravité
        const handsCount = isHandActive ? this.handLandmarks.length : 0;
        const handsData = [];

        if (isHandActive) {
            let videoAspect = 4 / 3;
            const video = document.getElementById('webcam');
            if (video && video.videoWidth && video.videoHeight) {
                videoAspect = video.videoWidth / video.videoHeight;
            }
            
            for (let h = 0; h < Math.min(handsCount, 2); h++) {
                const handLandmarks = this.handLandmarks[h];
                if (handLandmarks && handLandmarks.length > 9) {
                    const centerLandmark = handLandmarks[9]; // Knuckle stable (middle MCP)
                    const hand3DX = (0.5 - centerLandmark.x) * videoAspect * 4.0;
                    const hand3DY = (0.5 - centerLandmark.y) * 4.0;
                    const hand3DZ = -centerLandmark.z * videoAspect * 4.0;
                    handsData.push({ x: hand3DX, y: hand3DY, z: hand3DZ });
                }
            }
        }

        // Mettre à jour les mains suivies avec interpolation de coordonnées et de poids (fondu d'apparition/disparition)
        for (let h = 0; h < 2; h++) {
            const targetHand = handsData[h];
            const trackedHand = this.trackedHands[h];
            if (targetHand) {
                trackedHand.x = THREE.MathUtils.lerp(trackedHand.x, targetHand.x, 0.12);
                trackedHand.y = THREE.MathUtils.lerp(trackedHand.y, targetHand.y, 0.12);
                trackedHand.z = THREE.MathUtils.lerp(trackedHand.z, targetHand.z, 0.12);
                trackedHand.weight = THREE.MathUtils.lerp(trackedHand.weight, 1.0, 0.06);
            } else {
                trackedHand.weight = THREE.MathUtils.lerp(trackedHand.weight, 0.0, 0.06);
            }
        }

        // Déformer les points
        for (let i = 0; i < this.particleCount; i++) {
            const idx = i * 3;
            
            // Coordonnées d'origine
            const ox = this.originalPositions[idx];
            const oy = this.originalPositions[idx + 1];
            const oz = this.originalPositions[idx + 2];

            // Calcul du bruit mathématique organique utilisant la phase continue
            const waveX = Math.sin(ox * 1.5 + this.phase) * Math.cos(oy * 2.0 + this.phase);
            const waveY = Math.sin(oy * 1.2 - this.phase) * Math.cos(oz * 1.8 + this.phase);
            const waveZ = Math.sin(oz * 2.2 + this.phase) * Math.cos(ox * 1.1 - this.phase);
            
            let noiseFactor = (waveX + waveY + waveZ) * this.currentNoiseScale;

            // Effet audio (vibrations et expansion lissées)
            let audioExpand = 0;
            let audioVibFactor = 0;
            if (this.smoothedAudioLevel > 0.001) {
                audioExpand = this.smoothedAudioLevel * 0.7;
                audioVibFactor = this.smoothedAudioLevel * 0.45 * Math.sin(i * 0.35 + this.phase * 5.0);
            }

            // Normalisation de la position originale
            const len = Math.sqrt(ox*ox + oy*oy + oz*oz);
            const nx = ox / (len || 1);
            const ny = oy / (len || 1);
            const nz = oz / (len || 1);

            // Rayon résultant avec respiration et audio
            const currentRadius = this.baseRadius * (this.currentBaseScale + breath + audioExpand) + noiseFactor + audioVibFactor;

            // Position cible de base sur la sphère
            let targetX = nx * currentRadius;
            let targetY = ny * currentRadius;
            let targetZ = nz * currentRadius;

            // Déformation gel liquide vers les mains actives via les slots lissés
            for (let h = 0; h < 2; h++) {
                const trackedHand = this.trackedHands[h];
                if (trackedHand.weight > 0.001) {
                    // Vecteur depuis la position cible de la particule vers le centre de la main
                    const dx = trackedHand.x - targetX;
                    const dy = trackedHand.y - targetY;
                    const dz = trackedHand.z - targetZ;
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    
                    const range = 5.5; // Zone d'influence du gel liquide
                    if (dist < range) {
                        // Force d'attraction non-linéaire (bulge/protrusion fluide)
                        const force = Math.pow(1.0 - dist / range, 2) * 0.65 * trackedHand.weight;
                        
                        // Wobble de gel liquide organique
                        const wobble = Math.sin(this.phase * 2.0 + i * 0.4) * 0.045 * (1.0 - dist / range) * trackedHand.weight;
                        
                        targetX += (dx * force) + (nx * wobble);
                        targetY += (dy * force) + (ny * wobble);
                        targetZ += (dz * force) + (nz * wobble);
                    }
                }
            }

            // Interpolation physique fluide (inertie de mouvement des particules adoucie à 0.08)
            posArray[idx] += (targetX - posArray[idx]) * 0.08;
            posArray[idx + 1] += (targetY - posArray[idx + 1]) * 0.08;
            posArray[idx + 2] += (targetZ - posArray[idx + 2]) * 0.08;
        }

        // Mettre à jour l'unique attribut de position
        this.positionAttribute.needsUpdate = true;

        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }
}
