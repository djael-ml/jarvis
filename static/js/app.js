// Contrôleur Principal - JARVIS

document.addEventListener('DOMContentLoaded', () => {
    const app = new JarvisApp();
    app.init();
});

class JarvisApp {
    constructor() {
        this.socket = null;
        this.sphere = null;
        this.wakeDetector = null;
        this.handTracker = null;
        
        // Configuration locale
        this.config = {};
        
        // Éléments du DOM
        this.statusDot = document.getElementById('status-dot');
        this.statusText = document.getElementById('status-text');
        this.responseDisplay = document.getElementById('jarvis-response-display');
        this.userInputDisplay = document.getElementById('user-input-display');
        this.settingsPanel = document.getElementById('settings-panel');
        this.settingsToggle = document.getElementById('settings-toggle');
        this.settingsClose = document.getElementById('settings-close');
        this.saveSettingsBtn = document.getElementById('save-settings');
        
        // Éléments formulaire settings
        this.providerRadios = document.getElementsByName('provider');
        this.geminiSettings = document.getElementById('gemini-settings');
        this.ollamaSettings = document.getElementById('ollama-settings');
        this.geminiKeyInput = document.getElementById('gemini-key');
        this.geminiModelSelect = document.getElementById('gemini-model');
        this.ollamaUrlInput = document.getElementById('ollama-url');
        this.ollamaModelInput = document.getElementById('ollama-model');
        this.cameraToggle = document.getElementById('camera-tracking-toggle');
        
        // Calibration
        this.calibrateBtn = document.getElementById('wake-calibrate-btn');
        this.calibrationSteps = document.getElementById('calibration-steps');
        this.calibrationStatus = document.getElementById('calibration-status');
        
        // Web Speech API
        this.recognition = null;
        this.speechSynthesis = window.speechSynthesis;
        this.currentUtterance = null;
        this.isSpeechActive = false; // Vrai si Jarvis parle
        this.isListening = false;     // Vrai si le micro écoute l'utilisateur
        
        // Analyseur Audio local pour la réactivité de la sphère
        this.micAudioContext = null;
        this.micAnalyser = null;
        this.micStream = null;
    }

    async init() {
        // 1. Initialiser la sphère 3D
        this.sphere = new NeuralSphere('canvas-container');
        this.sphere.setState('idle');
        
        // 2. Initialiser la connexion WebSocket
        this.connectWebSocket();
        
        // 3. Configurer les écouteurs d'événements UI
        this.setupUIListeners();
        
        // 4. Initialiser la reconnaissance vocale (Speech-to-Text)
        this.setupSpeechRecognition();
        
        // 5. Initialiser le microphone local pour l'animation de la sphère
        this.setupLocalMicAnalyser();
        
        // 6. Configurer le QR Code de partage local
        this.setupQRCode();
        
        // 7. Initialiser le détecteur de wake sound
        this.wakeDetector = new WakeWordDetector((similarity) => this.handleWakeSound(similarity));
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = () => {
            // Commencer directement en mode veille passive (pas de parole ni d'écoute de transcription auto)
            this.updateStatus('sleeping', 'EN VEILLE');
            this.responseDisplay.textContent = "Système connecté. Dites le son d'activation ou cliquez sur l'écran pour me réveiller.";
            this.syncSensorColors();
        };
        
        this.socket.onclose = () => {
            this.updateStatus('sleeping', 'HORS LIGNE');
            this.responseDisplay.textContent = "Connexion perdue avec le serveur Jarvis. Tentative de reconnexion...";
            setTimeout(() => this.connectWebSocket(), 4000);
        };
        
        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleServerMessage(data);
        };
    }

    handleServerMessage(data) {
        switch (data.type) {
            case 'config':
                this.config = data.config;
                this.applyConfigToForm();
                
                // Charger l'empreinte dans le détecteur de réveil
                if (this.config.wake_sound_fingerprint) {
                    this.wakeDetector.setFingerprint(
                        this.config.wake_sound_fingerprint, 
                        this.config.wake_sound_tolerance
                    );
                    this.calibrationStatus.textContent = "Son d'activation configuré et actif.";
                }
                break;
                
            case 'thinking':
                this.sphere.setState('thinking');
                this.updateStatus('thinking', 'RÉFLEXION...');
                break;
                
            case 'response':
                this.sphere.setState('speaking');
                this.updateStatus('speaking', 'RÉPONSE');
                
                const text = data.text;
                this.responseDisplay.textContent = text;
                
                // Synthèse Vocale
                this.say(text);
                break;
                
            case 'show_image':
                const imgContainer = document.getElementById('media-preview-container');
                const imgEl = document.getElementById('media-preview');
                imgEl.src = data.url;
                imgContainer.classList.remove('hidden');
                break;
        }
    }

    updateStatus(state, label) {
        this.sphere.setState(state);
        this.statusText.textContent = label;
        
        // Mettre à jour la couleur du point lumineux
        const colors = {
            idle: '#00f0ff',
            thinking: '#bd00ff',
            speaking: '#00ff66',
            sleeping: '#0044ff'
        };
        
        // Choisir la couleur du dot d'état
        let dotColor = colors[state] || colors.idle;
        if (state === 'idle' && this.handTracker && this.handTracker.isActive) {
            dotColor = '#00ffaa'; // Vert émeraude si caméra active en veille
        }
        
        this.statusDot.style.backgroundColor = dotColor;
        this.statusDot.style.boxShadow = `0 0 10px ${dotColor}`;
        this.syncSensorColors();
    }

    syncSensorColors() {
        const micActive = this.isListening || this.isSpeechActive;
        const camActive = this.handTracker && this.handTracker.isActive;
        
        // Mettre à jour les couleurs de rendu dans Three.js
        this.sphere.updateSensorsState(micActive, camActive);
        
        // Mettre à jour le label textuel d'état
        let sensorLabel = "CONNECTÉ";
        if (this.sphere.state === 'sleeping') {
            sensorLabel = "EN VEILLE";
        } else if (micActive && camActive) {
            sensorLabel = "MICRO + CAMÉRA ACTIFS";
        } else if (micActive) {
            sensorLabel = "MICRO ACTIF";
        } else if (camActive) {
            sensorLabel = "CAMÉRA ACTIVE";
        } else {
            sensorLabel = "SENSEURS INACTIFS";
        }
        
        if (this.sphere.state !== 'thinking' && this.sphere.state !== 'speaking') {
            this.statusText.textContent = sensorLabel;
        }
    }

    setupUIListeners() {
        // Toggle Réglages
        this.settingsToggle.addEventListener('click', () => {
            this.settingsPanel.classList.toggle('open');
        });
        
        this.settingsClose.addEventListener('click', () => {
            this.settingsPanel.classList.remove('open');
        });
        
        // Fermer la prévisualisation média
        document.getElementById('close-media-preview').addEventListener('click', () => {
            document.getElementById('media-preview-container').classList.add('hidden');
        });

        // Alternance des réglages Gemini/Ollama
        for (let radio of this.providerRadios) {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'gemini') {
                    this.geminiSettings.classList.remove('hidden');
                    this.ollamaSettings.classList.add('hidden');
                } else {
                    this.geminiSettings.classList.add('hidden');
                    this.ollamaSettings.classList.remove('hidden');
                }
            });
        }

        // Sauvegarder les réglages
        this.saveSettingsBtn.addEventListener('click', () => {
            this.saveSettings();
        });

        // Activer la détection du son au clic sur la sphère (fallback)
        document.getElementById('canvas-container').addEventListener('click', () => {
            this.triggerListening();
        });

        // Calibration du son de réveil
        this.calibrateBtn.addEventListener('click', () => this.calibrateWakeSound());
        
        // Basculement Caméra/Gestes
        this.cameraToggle.addEventListener('change', (e) => {
            this.toggleCamera(e.target.checked);
        });
    }

    applyConfigToForm() {
        // Provider
        for (let radio of this.providerRadios) {
            if (radio.value === this.config.provider) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change'));
            }
        }
        
        // Gemini
        this.geminiKeyInput.value = this.config.gemini_api_key || "";
        this.geminiModelSelect.value = this.config.model_name || "gemini-1.5-flash";
        
        // Ollama
        this.ollamaUrlInput.value = this.config.ollama_url || "http://localhost:11434";
        if (this.config.provider === 'ollama') {
            this.ollamaModelInput.value = this.config.model_name || "llama3";
        }
    }

    saveSettings() {
        const selectedProvider = Array.from(this.providerRadios).find(r => r.checked).value;
        
        this.config.provider = selectedProvider;
        this.config.gemini_api_key = this.geminiKeyInput.value.strip ? this.geminiKeyInput.value.strip() : this.geminiKeyInput.value;
        
        if (selectedProvider === 'gemini') {
            this.config.model_name = this.geminiModelSelect.value;
        } else {
            this.config.ollama_url = this.ollamaUrlInput.value;
            this.config.model_name = this.ollamaModelInput.value;
        }
        
        // Envoyer la configuration au serveur
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'save_config',
                config: this.config
            }));
            this.responseDisplay.textContent = "Configuration appliquée au serveur.";
            this.settingsPanel.classList.remove('open');
            this.say("Configuration sauvegardée.");
        }
    }

    setupQRCode() {
        const localIpContainer = document.getElementById('local-ip-address');
        const originUrl = window.location.origin;
        
        localIpContainer.textContent = originUrl;
        
        // Générer le QR Code
        new QRCode(document.getElementById("qrcode"), {
            text: originUrl,
            width: 140,
            height: 140,
            colorDark : "#05060f",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    }

    // --- SYNTHÈSE VOCALE (TTS) ---
    say(text) {
        if (!text) return;
        
        // Annuler toute synthèse en cours
        this.speechSynthesis.cancel();
        
        // Stopper l'écoute pour éviter le larsen/boucle infinie
        this.stopSpeechRecognition();
        
        this.isSpeechActive = true;
        this.sphere.setState('speaking');
        this.updateStatus('speaking', 'JARVIS PARLE');
        
        this.currentUtterance = new SpeechSynthesisUtterance(text);
        this.currentUtterance.lang = 'fr-FR';
        
        // Chercher une voix française de qualité (ex: Microsoft Hortense ou Google)
        const voices = this.speechSynthesis.getVoices();
        const frVoice = voices.find(v => v.lang.startsWith('fr'));
        if (frVoice) {
            this.currentUtterance.voice = frVoice;
        }

        // Simuler des variations d'audio amplitude pendant que Jarvis parle
        let speakAnimationInterval = setInterval(() => {
            if (this.isSpeechActive) {
                // Générer une amplitude pseudo-aléatoire
                const level = 0.3 + Math.random() * 0.7;
                this.sphere.updateAudioLevel(level);
            } else {
                clearInterval(speakAnimationInterval);
            }
        }, 80);

        this.currentUtterance.onend = () => {
            this.isSpeechActive = false;
            this.sphere.updateAudioLevel(0);
            this.updateStatus('idle', 'EN LIGNE');
            
            // Relancer l'écoute automatique
            this.startSpeechRecognition();
            
            // Lancer la minuterie de veille
            this.resetSleepTimer();
        };

        this.currentUtterance.onerror = () => {
            this.isSpeechActive = false;
            this.sphere.updateAudioLevel(0);
            this.updateStatus('idle', 'EN LIGNE');
            this.startSpeechRecognition();
        };

        this.speechSynthesis.speak(this.currentUtterance);
    }

    // --- RECONNAISSANCE VOCALE (STT) ---
    setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.error("Reconnaissance vocale non supportée par ce navigateur.");
            this.responseDisplay.textContent = "Reconnaissance vocale non supportée. Utilisez Google Chrome ou Microsoft Edge pour de meilleures performances.";
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'fr-FR';
        this.recognition.continuous = false; // Mode réactif commande par commande
        this.recognition.interimResults = false;

        this.recognition.onstart = () => {
            this.isListening = true;
            if (!this.isSpeechActive) {
                this.updateStatus('idle', 'ÉCOUTE ACTIVE...');
            }
            this.syncSensorColors();
        };

        this.recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            
            this.userInputDisplay.textContent = `Vous : "${transcript}"`;
            this.userInputDisplay.classList.remove('hidden');
            
            // Envoyer la transcription au serveur via WebSocket
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    type: 'transcription',
                    text: transcript
                }));
            }
            
            this.resetSleepTimer();
        };

        this.recognition.onerror = (e) => {
            if (e.error !== 'no-speech') {
                console.warn("[STT] Erreur :", e.error);
            }
            this.isListening = false;
            this.syncSensorColors();
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.syncSensorColors();
            // Relancer l'écoute en arrière-plan si Jarvis ne parle pas
            if (!this.isSpeechActive && this.sphere.state !== 'sleeping') {
                this.startSpeechRecognition();
            }
        };
    }

    startSpeechRecognition() {
        if (this.recognition && !this.isListening && !this.isSpeechActive) {
            try {
                this.recognition.start();
            } catch (e) {
                // Déjà démarré
            }
        }
    }

    stopSpeechRecognition() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    }

    triggerListening() {
        // Réveiller si Jarvis dort
        if (this.sphere.state === 'sleeping') {
            this.wakeUp();
            return;
        }
        
        if (this.isSpeechActive) {
            this.speechSynthesis.cancel();
            this.isSpeechActive = false;
        }
        
        this.say("J'écoute.");
        this.startSpeechRecognition();
    }

    // --- ANALYSE MICRO LOCAL (Réactivité à notre voix) ---
    async setupLocalMicAnalyser() {
        try {
            this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            
            this.micAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.micAudioContext.createMediaStreamSource(this.micStream);
            this.micAnalyser = this.micAudioContext.createAnalyser();
            this.micAnalyser.fftSize = 128;
            
            source.connect(this.micAnalyser);
            
            const bufferLength = this.micAnalyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            const checkMicVolume = () => {
                requestAnimationFrame(checkMicVolume);
                
                // Ne capter le micro que si on écoute et que Jarvis ne parle pas
                if (this.isListening && !this.isSpeechActive) {
                    this.micAnalyser.getByteFrequencyData(dataArray);
                    let sum = 0;
                    for (let i = 0; i < bufferLength; i++) {
                        sum += dataArray[i];
                    }
                    const avg = sum / bufferLength;
                    // Mapper [0, 100] vers [0, 1]
                    const normLevel = Math.min(avg / 80, 1);
                    this.sphere.updateAudioLevel(normLevel);
                }
            };
            checkMicVolume();
        } catch (e) {
            console.warn("[MicAnalyser] Impossible d'analyser le volume du micro local :", e);
        }
    }

    // --- CALIBRATION DU WAKE SOUND ---
    async calibrateWakeSound() {
        try {
            await this.wakeDetector.init();
            
            this.calibrateBtn.classList.add('hidden');
            this.calibrationSteps.classList.remove('hidden');
            this.calibrationStatus.textContent = "Produisez le son d'activation 1/3...";
            
            const dots = [
                document.getElementById('step-1'),
                document.getElementById('step-2'),
                document.getElementById('step-3')
            ];
            
            dots.forEach(d => {
                d.className = 'step-dot';
            });
            dots[0].classList.add('active');

            this.wakeDetector.startCalibration(
                (step, text) => {
                    this.calibrationStatus.textContent = text;
                    dots.forEach(d => d.classList.remove('active'));
                    
                    if (step < 3) {
                        dots[step].classList.add('active');
                        for (let i = 0; i < step; i++) {
                            dots[i].classList.add('done');
                        }
                    }
                },
                (fingerprint) => {
                    // Étalonnage terminé
                    dots.forEach(d => {
                        d.classList.remove('active');
                        d.classList.add('done');
                    });
                    
                    this.calibrationStatus.textContent = "Étalonnage réussi !";
                    this.config.wake_sound_fingerprint = fingerprint;
                    
                    // Ré-afficher le bouton
                    setTimeout(() => {
                        this.calibrateBtn.classList.remove('hidden');
                        this.calibrationSteps.classList.add('hidden');
                        this.calibrationStatus.textContent = "Son d'activation configuré et actif.";
                        this.say("Son d'activation enregistré avec succès.");
                    }, 2000);
                }
            );
        } catch (e) {
            this.calibrationStatus.textContent = e.message;
            this.calibrateBtn.classList.remove('hidden');
            this.calibrationSteps.classList.add('hidden');
        }
    }

    handleWakeSound(similarity) {
        if (this.sphere.state === 'sleeping') {
            this.wakeUp();
        } else if (!this.isSpeechActive && !this.isListening) {
            this.triggerListening();
        }
    }

    // --- GESTES & CAMÉRA ---
    async toggleCamera(active) {
        if (!this.handTracker) {
            this.handTracker = new HandTracker((landmarks) => {
                this.sphere.updateHandLandmarks(landmarks);
            });
        }
        
        if (active) {
            try {
                this.responseDisplay.textContent = "Démarrage de la caméra pour le contrôle gestuel...";
                await this.handTracker.start();
                this.responseDisplay.textContent = "Suivi des mains actif. Approchez votre main de la caméra pour voir le morphing 3D.";
                this.syncSensorColors();
            } catch (e) {
                this.cameraToggle.checked = false;
                this.responseDisplay.textContent = e.message;
                this.syncSensorColors();
            }
        } else {
            this.handTracker.stop();
            this.syncSensorColors();
        }
    }

    // --- ETATS DE VEILLE / REVEIL ---
    resetSleepTimer() {
        if (this.sleepTimeout) clearTimeout(this.sleepTimeout);
        
        // Jarvis se met en veille après 2 minutes d'inactivité
        this.sleepTimeout = setTimeout(() => {
            this.goToSleep();
        }, 120000);
    }

    goToSleep() {
        if (this.sphere.state === 'sleeping') return;
        
        this.stopSpeechRecognition();
        this.updateStatus('sleeping', 'EN VEILLE');
        this.responseDisplay.textContent = "Système en veille. Dites le son d'activation ou cliquez sur l'écran pour me réveiller.";
        
        // Notifier le serveur pour consolider la mémoire
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'sleep'
            }));
        }
    }

    wakeUp() {
        this.updateStatus('idle', 'EN LIGNE');
        this.responseDisplay.textContent = "Prêt. Que puis-je faire pour vous ?";
        
        // Notifier le serveur
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'wake'
            }));
        }
        
        this.say("Système réactivé.");
        this.startSpeechRecognition();
        this.resetSleepTimer();
    }
}
