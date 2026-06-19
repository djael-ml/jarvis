// Détecteur de Son d'Activation (Wake Sound) basé sur l'analyse fréquentielle

class WakeWordDetector {
    constructor(onWakeCallback) {
        this.onWake = onWakeCallback;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.scriptProcessor = null;
        
        this.isCalibrating = false;
        this.calibrationSamples = [];
        this.calibrationStep = 0;
        this.onCalibrationProgress = null;
        this.onCalibrationComplete = null;
        
        // Taille FFT : 256 donne 128 bandes de fréquences, idéal pour la rapidité
        this.fftSize = 256;
        this.frequencyBinsCount = this.fftSize / 2;
        
        // Empreinte fréquentielle enregistrée (Normalisée)
        this.fingerprint = null;
        this.tolerance = 0.85; // Seuil de similarité cosinus par défaut
        this.isListening = false;
        
        // Historique récent pour éviter les déclenchements trop proches
        this.lastTriggerTime = 0;
        this.cooldown = 1500; // ms
    }

    async init() {
        if (this.audioContext) return;
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.fftSize;
            this.analyser.smoothingTimeConstant = 0.4;
            
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);
            
            // ScriptProcessor pour analyser le flux audio en temps réel
            this.scriptProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);
            this.analyser.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);
            
            this.scriptProcessor.onaudioprocess = () => this.processAudio();
            this.isListening = true;
            console.log("[WakeDetector] Audio initialisé");
        } catch (e) {
            console.error("[WakeDetector] Erreur initialisation audio :", e);
            throw new Error("L'accès au microphone a été refusé ou a échoué.");
        }
    }

    setFingerprint(fingerprint, tolerance) {
        this.fingerprint = fingerprint;
        if (tolerance) this.tolerance = parseFloat(tolerance);
        console.log("[WakeDetector] Empreinte fréquentielle chargée.");
    }

    startCalibration(onProgress, onComplete) {
        this.isCalibrating = true;
        this.calibrationSamples = [];
        this.calibrationStep = 0;
        this.onCalibrationProgress = onProgress;
        this.onCalibrationComplete = onComplete;
        
        if (onProgress) onProgress(0, "Prêt pour le premier son... Produisez le son d'activation !");
    }

    // Calcul de la similarité cosinus entre deux vecteurs
    getCosineSimilarity(vecA, vecB) {
        let dotProduct = 0.0;
        let normA = 0.0;
        let normB = 0.0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    processAudio() {
        if (!this.isListening) return;

        const dataArray = new Uint8Array(this.frequencyBinsCount);
        this.analyser.getByteFrequencyData(dataArray);

        // 1. Calculer le volume général (amplitude moyenne)
        let totalVolume = 0;
        for (let i = 0; i < this.frequencyBinsCount; i++) {
            totalVolume += dataArray[i];
        }
        const averageVolume = totalVolume / this.frequencyBinsCount;

        // Seuil d'activité sonore (bruit significatif)
        const volumeThreshold = 40; // Ajustable

        if (averageVolume > volumeThreshold) {
            const now = Date.now();
            if (now - this.lastTriggerTime < this.cooldown) return;

            // Convertir dataArray en tableau standard et le normaliser
            const spectrum = Array.from(dataArray);
            const sum = spectrum.reduce((a, b) => a + b, 0);
            if (sum === 0) return;
            const normalizedSpectrum = spectrum.map(v => v / sum);

            if (this.isCalibrating) {
                // Phase d'étalonnage
                this.calibrationSamples.push(normalizedSpectrum);
                this.calibrationStep++;
                
                this.lastTriggerTime = now; // Éviter le double enregistrement sur le même son
                
                if (this.calibrationStep < 3) {
                    if (this.onCalibrationProgress) {
                        this.onCalibrationProgress(
                            this.calibrationStep, 
                            `Son ${this.calibrationStep} enregistré ! Produisez le son suivant...`
                        );
                    }
                } else {
                    // Étalonnage terminé : faire la moyenne des 3 spectres
                    this.isCalibrating = false;
                    const finalFingerprint = new Array(this.frequencyBinsCount).fill(0);
                    
                    for (let i = 0; i < this.frequencyBinsCount; i++) {
                        let sumBin = 0;
                        for (let j = 0; j < 3; j++) {
                            sumBin += this.calibrationSamples[j][i];
                        }
                        finalFingerprint[i] = sumBin / 3;
                    }

                    this.fingerprint = finalFingerprint;
                    if (this.onCalibrationComplete) {
                        this.onCalibrationComplete(finalFingerprint);
                    }
                }
            } else if (this.fingerprint) {
                // Phase de détection
                const similarity = this.getCosineSimilarity(normalizedSpectrum, this.fingerprint);
                
                // Si la similarité dépasse le seuil
                if (similarity >= this.tolerance) {
                    this.lastTriggerTime = now;
                    console.log(`[WakeDetector] Activation détectée ! (Similarité: ${similarity.toFixed(3)})`);
                    this.onWake(similarity);
                }
            }
        }
    }

    stop() {
        this.isListening = false;
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}
