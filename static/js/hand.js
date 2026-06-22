// Gestion du Tracking des Mains avec MediaPipe Hands

class HandTracker {
    constructor(onHandDetectedCallback) {
        this.onHandDetected = onHandDetectedCallback;
        this.videoElement = document.getElementById('webcam');
        this.hands = null;
        this.stream = null;
        this.animationFrameId = null;
        this.frameTimeoutId = null;
        this.isActive = false;
        this.isProcessing = false;
    }

    async init() {
        if (this.hands) return;

        // Initialiser l'objet Hands de MediaPipe
        this.hands = new Hands({
            locateFile: (file) => {
                return `/static/js/libs/mediapipe/${file}`;
            }
        });

        // Configurer les options du modèle (utilisation de Lite pour de meilleures performances)
        this.hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 0, // 0 = Lite (ultra-rapide, évite le lag)
            minDetectionConfidence: 0.55, // Seuil de détection optimal pour de meilleures performances
            minTrackingConfidence: 0.55
        });

        // Associer le callback de détection
        this.hands.onResults((results) => this.handleResults(results));

        console.log("[HandTracker] MediaPipe Hands initialisé.");
    }

    async start() {
        await this.init();
        
        if (this.isActive) return;
        this.isActive = true;

        try {
            // Demander le flux vidéo de la caméra (léger et sans fioritures)
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 320 },
                    height: { ideal: 240 },
                    facingMode: "user"
                },
                audio: false
            });
            this.videoElement.srcObject = stream;
            await this.videoElement.play();

            this.stream = stream;
            this.runFrameLoop();
            console.log("[HandTracker] Caméra et tracking démarrés via getUserMedia.");
        } catch (e) {
            console.error("[HandTracker] Erreur démarrage caméra :", e);
            this.isActive = false;
            throw new Error("L'accès à la caméra a été refusé ou a échoué.");
        }
    }

    async runFrameLoop() {
        if (!this.isActive) return;
        
        if (!this.isProcessing && this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
            this.isProcessing = true;
            try {
                await this.hands.send({ image: this.videoElement });
            } catch (e) {
                console.error("[HandTracker] Erreur lors de l'envoi de l'image à MediaPipe:", e);
            } finally {
                this.isProcessing = false;
            }
        }
        
        if (this.isActive) {
            // Planifier la prochaine capture dans 50ms (environ 20 FPS, idéal pour le tracking sans bloquer le rendu à 60 FPS)
            this.frameTimeoutId = setTimeout(() => this.runFrameLoop(), 50);
        }
    }

    handleResults(results) {
        if (!this.isActive) return;

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            // Envoyer toutes les mains détectées
            this.onHandDetected(results.multiHandLandmarks);
        } else {
            // Aucune main détectée
            this.onHandDetected(null);
        }
    }

    stop() {
        this.isActive = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.frameTimeoutId) {
            clearTimeout(this.frameTimeoutId);
            this.frameTimeoutId = null;
        }
        this.isProcessing = false;
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }
        this.onHandDetected(null);
        console.log("[HandTracker] Caméra et tracking arrêtés.");
    }
}
