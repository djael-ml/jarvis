// Gestion du Tracking des Mains avec MediaPipe Hands

class HandTracker {
    constructor(onHandDetectedCallback) {
        this.onHandDetected = onHandDetectedCallback;
        this.videoElement = document.getElementById('webcam');
        this.hands = null;
        this.camera = null;
        this.isActive = false;
    }

    async init() {
        if (this.hands) return;

        // Initialiser l'objet Hands de MediaPipe
        this.hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });

        // Configurer les options du modèle
        this.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
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
            // Créer le controleur caméra de MediaPipe
            this.camera = new Camera(this.videoElement, {
                onFrame: async () => {
                    if (this.isActive) {
                        await this.hands.send({ image: this.videoElement });
                    }
                },
                width: 320,
                height: 240
            });

            await this.camera.start();
            console.log("[HandTracker] Caméra et tracking démarrés.");
        } catch (e) {
            console.error("[HandTracker] Erreur démarrage caméra :", e);
            this.isActive = false;
            throw new Error("L'accès à la caméra a été refusé ou a échoué.");
        }
    }

    handleResults(results) {
        if (!this.isActive) return;

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            // Envoyer les landmarks de la première main détectée
            const landmarks = results.multiHandLandmarks[0];
            this.onHandDetected(landmarks);
        } else {
            // Aucune main détectée : renvoyer null pour revenir à la sphère normale
            this.onHandDetected(null);
        }
    }

    stop() {
        this.isActive = false;
        if (this.camera) {
            this.camera.stop();
            this.camera = null;
        }
        this.onHandDetected(null);
        console.log("[HandTracker] Caméra et tracking arrêtés.");
    }
}
