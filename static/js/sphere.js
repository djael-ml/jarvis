// Gestion de la Sphère Neuronale 3D (Three.js)

class NeuralSphere {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.state = 'idle'; // idle, thinking, speaking, sleeping
        this.audioLevel = 0;
        this.handLandmarks = null;
        
        // Définition des connexions d'os de la main pour le morphing 3D squelettique
        this.handConnections = [
            [0, 1], [1, 2], [2, 3], [3, 4],       // Pouce
            [0, 5], [5, 6], [6, 7], [7, 8],       // Index
            [0, 9], [9, 10], [10, 11], [11, 12],  // Majeur
            [0, 13], [13, 14], [14, 15], [15, 16], // Annulaire
            [0, 17], [17, 18], [18, 19], [19, 20], // Auriculaire
            [5, 9], [9, 13], [13, 17]             // Paume
        ];
        
        this.particleCount = 600;
        this.baseRadius = 2.0;
        
        this.initThree();
        this.createSphere();
        this.setupStateParams();
        this.animate();
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    initThree() {
        // Scène
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x05060f, 0.05);

        // Caméra
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.z = 6;

        // Rendu
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
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

        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

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

        // Connexions (Lignes)
        this.lineGeometry = new THREE.BufferGeometry();
        // Créer un réseau de connexions fixes (chaque point se connecte à ses voisins)
        const lineIndices = [];
        for (let i = 0; i < this.particleCount; i++) {
            // Connecter au point suivant
            lineIndices.push(i, (i + 1) % this.particleCount);
            // Connecter à un point éloigné pour former un maillage neuronal
            lineIndices.push(i, (i + 17) % this.particleCount);
            lineIndices.push(i, (i + 43) % this.particleCount);
        }
        
        this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.lineGeometry.setIndex(lineIndices);

        this.lineMaterial = new THREE.LineBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending
        });

        this.lines = new THREE.LineSegments(this.lineGeometry, this.lineMaterial);
        this.scene.add(this.lines);
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
        this.handLandmarks = landmarks; // Attend 21 landmarks format {x, y, z} ou null
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const params = this.stateParams[this.state];
        const time = Date.now() * 0.001 * params.speed;

        // Transition de couleur fluide
        this.particleMaterial.color.lerp(new THREE.Color(params.color), 0.08);
        this.lineMaterial.color.lerp(new THREE.Color(params.color), 0.08);
        this.lineMaterial.opacity = THREE.MathUtils.lerp(this.lineMaterial.opacity, params.opacity, 0.08);

        // Rotation lente de la sphère
        this.particleSystem.rotation.y = time * 0.1;
        this.particleSystem.rotation.x = time * 0.05;
        this.lines.rotation.y = this.particleSystem.rotation.y;
        this.lines.rotation.x = this.particleSystem.rotation.x;

        const positionsAttr = this.geometry.attributes.position;
        const posArray = positionsAttr.array;

        // Déformer les points
        for (let i = 0; i < this.particleCount; i++) {
            const idx = i * 3;
            
            // Coordonnées d'origine
            const ox = this.originalPositions[idx];
            const oy = this.originalPositions[idx + 1];
            const oz = this.originalPositions[idx + 2];

            // Calcul du bruit mathématique organique (combinaisons sinusoïdales complexes)
            const waveX = Math.sin(ox * 1.5 + time) * Math.cos(oy * 2.0 + time);
            const waveY = Math.sin(oy * 1.2 - time) * Math.cos(oz * 1.8 + time);
            const waveZ = Math.sin(oz * 2.2 + time) * Math.cos(ox * 1.1 - time);
            
            let noiseFactor = (waveX + waveY + waveZ) * params.noiseScale;

            // Effet audio (pulsation)
            if (this.state === 'speaking') {
                noiseFactor += this.audioLevel * 1.4 * Math.sin(i * 0.2 + time * 15);
            }

            // Normalisation de la position originale pour garder une sphère parfaite sous la déformation
            const len = Math.sqrt(ox*ox + oy*oy + oz*oz);
            const nx = ox / len;
            const ny = oy / len;
            const nz = oz / len;

            // Rayon résultant
            const currentRadius = this.baseRadius * params.baseScale + noiseFactor;

            // Position cible sur la sphère
            let targetX = nx * currentRadius;
            let targetY = ny * currentRadius;
            let targetZ = nz * currentRadius;

            // Morphing si la main est détectée (Squelette articulé avec bruit organique)
            if (this.handLandmarks && this.handLandmarks.length > 0) {
                // Associer la particule à un segment d'os de la main
                const seg = this.handConnections[i % this.handConnections.length];
                const p1 = this.handLandmarks[seg[0]];
                const p2 = this.handLandmarks[seg[1]];
                
                // Distribuer uniformément le long de l'os (t de 0 à 1)
                const t = ((i * 17) % 11) / 10.0;
                
                // Convertir les coordonnées normalisées MediaPipe en coordonnées 3D
                const x1 = (0.5 - p1.x) * 5.5;
                const y1 = (0.5 - p1.y) * 5.5;
                const z1 = -p1.z * 5.5;
                
                const x2 = (0.5 - p2.x) * 5.5;
                const y2 = (0.5 - p2.y) * 5.5;
                const z2 = -p2.z * 5.5;
                
                // Interpolation linéaire le long de l'os
                let handX = x1 + (x2 - x1) * t;
                let handY = y1 + (y2 - y1) * t;
                let handZ = z1 + (z2 - z1) * t;
                
                // Ajouter des petites oscillations organiques 3D stables par particule
                // pour donner un aspect de "nuage d'énergie" qui dessine la main au lieu d'un trait rigide
                const waveTime = time * 2.5;
                handX += Math.sin(i * 1.5 + waveTime) * 0.12;
                handY += Math.cos(i * 2.2 + waveTime) * 0.12;
                handZ += Math.sin(i * 3.7 + waveTime) * 0.12;
 
                const morphStrength = 0.88; // Attraction forte
                targetX = THREE.MathUtils.lerp(targetX, handX, morphStrength);
                targetY = THREE.MathUtils.lerp(targetY, handY, morphStrength);
                targetZ = THREE.MathUtils.lerp(targetZ, handZ, morphStrength);
            }

            // Interpolation physique fluide (amortissement)
            posArray[idx] += (targetX - posArray[idx]) * 0.12;
            posArray[idx + 1] += (targetY - posArray[idx + 1]) * 0.12;
            posArray[idx + 2] += (targetZ - posArray[idx + 2]) * 0.12;
        }

        positionsAttr.needsUpdate = true;
        this.lineGeometry.attributes.position.needsUpdate = true;

        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}
