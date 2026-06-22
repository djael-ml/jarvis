// Contrôleur Principal - JARVIS

document.addEventListener('DOMContentLoaded', () => {
    // Désactiver le clic droit et le glisser-déposer sur le document pour un rendu pro
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('dragstart', e => e.preventDefault());

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
        
        // Caching et navigation des paramètres
        this.lastSettingsClosedTime = 0;
        this.currentSettingsTab = 'general';
        
        // Éléments du DOM
        this.statusMic = document.getElementById('status-mic');
        this.statusCam = document.getElementById('status-cam');
        this.statusVersion = document.getElementById('system-version');
        this.responseDisplay = document.getElementById('jarvis-response-display');
        this.userInputDisplay = document.getElementById('user-input-display');
        this.settingsPanel = document.getElementById('settings-panel');
        this.settingsClose = document.getElementById('settings-close');
        this.settingsBackdrop = document.getElementById('settings-backdrop');
        this.tabButtons = document.querySelectorAll('.tab-btn');
        this.tabPanes = document.querySelectorAll('.tab-pane');
        this.saveSettingsBtn = document.getElementById('save-settings');
        
        // Éléments de l'onglet Modules
        this.modulesListContainer = document.getElementById('modules-list-container');
        this.reloadModulesBtn = document.getElementById('reload-modules-btn');
        this.importModuleFileInput = document.getElementById('import-module-file');
        this.selectModuleFileBtn = document.getElementById('select-module-file-btn');
        this.selectedModuleFilename = document.getElementById('selected-module-filename');
        this.uploadModuleBtn = document.getElementById('upload-module-btn');
        this.importStatusMessage = document.getElementById('import-status-message');
        
        // Éléments formulaire settings
        this.providerRadios = document.getElementsByName('provider');
        this.geminiSettings = document.getElementById('gemini-settings');
        this.ollamaSettings = document.getElementById('ollama-settings');
        this.geminiKeyInput = document.getElementById('gemini-key');
        this.geminiModelSelect = document.getElementById('gemini-model');
        this.ollamaUrlInput = document.getElementById('ollama-url');
        this.ollamaModelInput = document.getElementById('ollama-model');
        this.cameraToggle = document.getElementById('camera-tracking-toggle');
        this.particleSlider = document.getElementById('particle-count-slider');
        this.particleVal = document.getElementById('particle-count-val');
        
        // Éléments TTS (Synthèse vocale)
        this.ttsVoiceSelect = document.getElementById('tts-voice-select');
        this.ttsRateSlider = document.getElementById('tts-rate-slider');
        this.ttsRateVal = document.getElementById('tts-rate-val');
        this.ttsPitchSlider = document.getElementById('tts-pitch-slider');
        this.ttsPitchVal = document.getElementById('tts-pitch-val');
        
        // Éléments de chat écrit
        this.chatInput = document.getElementById('chat-input');
        this.chatSend = document.getElementById('chat-send');
        this.chatMicBtn = document.getElementById('chat-mic-btn');
        this.micToggle = document.getElementById('mic-active-toggle');
        
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

        // 8. Charger et lister les voix pour le TTS
        this.populateTtsVoices();
        if (this.speechSynthesis.onvoiceschanged !== undefined) {
            this.speechSynthesis.onvoiceschanged = () => this.populateTtsVoices();
        }

        // Garantie de retrait de l'écran de chargement après 2.5 secondes au maximum
        setTimeout(() => this.dismissLoadingScreen(), 2500);
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
            this.dismissLoadingScreen();
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
                
                // Mettre à jour la version affichée
                if (this.statusVersion && this.config.version) {
                    this.statusVersion.textContent = `v${this.config.version}`;
                }
                
                // Charger l'empreinte dans le détecteur de réveil
                if (this.config.wake_sound_fingerprint) {
                    this.wakeDetector.setFingerprint(
                        this.config.wake_sound_fingerprint, 
                        this.config.wake_sound_tolerance
                    );
                    this.calibrationStatus.textContent = "Son d'activation configuré et actif.";
                }

                // Initialiser l'état des senseurs depuis la configuration
                if (this.config.camera_active) {
                    this.toggleCamera(true);
                } else if (this.handTracker && this.handTracker.isActive) {
                    this.toggleCamera(false);
                }

                if (this.config.mic_active === false) {
                    this.stopSpeechRecognition();
                } else {
                    this.startSpeechRecognition();
                }
                this.syncSensorColors();
                break;
                
            case 'history':
                // Restaurer la dernière interaction de la conversation pour le minimalisme
                const history = data.history;
                if (history && history.length > 0) {
                    const lastUser = [...history].reverse().find(msg => msg.role === 'user');
                    const lastAssistant = [...history].reverse().find(msg => msg.role === 'assistant');
                    
                    if (lastUser) {
                        this.userInputDisplay.textContent = `Vous : "${lastUser.content}"`;
                        this.userInputDisplay.classList.remove('hidden');
                    }
                    if (lastAssistant) {
                        this.responseDisplay.textContent = lastAssistant.content;
                    }
                } else {
                    this.responseDisplay.textContent = "Système prêt. Dites le son d'activation ou cliquez sur l'écran pour me réveiller.";
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
                this.revealText(this.responseDisplay, text);
                
                // Synthèse Vocale
                this.say(text);
                break;
                
            case 'show_image':
                const imgContainer = document.getElementById('media-preview-container');
                const imgEl = document.getElementById('media-preview');
                imgEl.src = data.url;
                imgContainer.classList.remove('hidden');
                break;
                
            case 'modules_list':
                this.renderModulesList(data.modules);
                break;
                
            case 'import_module_status':
                if (data.success) {
                    this.showImportMessage(data.message, true);
                    if (this.importModuleFileInput) this.importModuleFileInput.value = '';
                    if (this.selectedModuleFilename) this.selectedModuleFilename.textContent = "Aucun fichier choisi";
                    if (data.modules) {
                        this.renderModulesList(data.modules);
                    }
                    this.say("Module importé avec succès.");
                } else {
                    this.showImportMessage(data.message, false);
                    this.say("Échec de l'importation du module.");
                }
                break;
        }
    }

    updateStatus(state, label) {
        this.sphere.setState(state);
        this.syncSensorColors();
    }

    syncSensorColors() {
        const micActive = (this.isListening || this.isSpeechActive) && this.config.mic_active !== false;
        const camActive = !!(this.handTracker && this.handTracker.isActive) && this.config.camera_active !== false;
        
        // Mettre à jour les couleurs de rendu dans Three.js
        this.sphere.updateSensorsState(micActive, camActive);
        
        // Mettre à jour les statuts texte (discrets et sans couleur)
        if (this.statusMic) {
            if (this.config.mic_active === false) {
                this.statusMic.textContent = "Désactivé";
            } else if (this.isSpeechActive) {
                this.statusMic.textContent = "Jarvis parle";
            } else if (this.isListening) {
                this.statusMic.textContent = "Écoute...";
            } else {
                this.statusMic.textContent = "Prêt";
            }
            this.statusMic.style.color = "";
        }
        
        if (this.statusCam) {
            if (this.config.camera_active === false) {
                this.statusCam.textContent = "Inactive";
            } else if (camActive) {
                this.statusCam.textContent = "Active";
            } else {
                this.statusCam.textContent = "Inactive";
            }
            this.statusCam.style.color = "";
        }

        // Mettre à jour la classe active sur le bouton micro du chat
        if (this.chatMicBtn) {
            if (this.isListening && this.config.mic_active !== false) {
                this.chatMicBtn.classList.add('active');
            } else {
                this.chatMicBtn.classList.remove('active');
            }
        }
    }

    setupUIListeners() {
        // Clic sur le bouton de fermeture des réglages
        this.settingsClose.addEventListener('click', () => {
            this.toggleSettings(false);
        });
        
        // Clic sur le backdrop pour fermer les réglages
        this.settingsBackdrop.addEventListener('click', () => {
            this.toggleSettings(false);
        });
        
        // Navigation par onglets dans les réglages
        this.tabButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetBtn = e.target.closest('.tab-btn');
                if (targetBtn) {
                    const tabName = targetBtn.getAttribute('data-tab');
                    this.switchSettingsTab(tabName);
                }
            });
        });
        
        // Raccourcis clavier (Ctrl + Espace & Ctrl + Échap)
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.code === 'Space') {
                e.preventDefault();
                this.toggleSettings();
            }
            if (e.ctrlKey && e.key === 'Escape') {
                e.preventDefault();
                this.toggleSettings(false);
            }
        });
        
        // Écriture à Jarvis
        this.chatSend.addEventListener('click', () => this.handleChatInput());
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.handleChatInput();
            }
        });

        // Alternance micro avec le bouton dédié
        if (this.chatMicBtn) {
            this.chatMicBtn.addEventListener('click', () => {
                if (this.isListening) {
                    this.stopSpeechRecognition();
                } else {
                    this.triggerListening();
                }
            });
        }

        // Basculement Micro (Checkbox dans settings)
        if (this.micToggle) {
            this.micToggle.addEventListener('change', (e) => {
                const active = e.target.checked;
                this.config.mic_active = active;
                if (active) {
                    this.startSpeechRecognition();
                } else {
                    this.stopSpeechRecognition();
                }
                this.syncSensorColors();
                this.saveConfigToServer();
            });
        }

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

        // Activer la détection du son au clic sur la sphère (avec gestion anti-drag et bascule de l'écoute)
        let dragStartX = 0;
        let dragStartY = 0;
        const canvasContainer = document.getElementById('canvas-container');
        
        canvasContainer.addEventListener('mousedown', (e) => {
            dragStartX = e.clientX;
            dragStartY = e.clientY;
        });

        canvasContainer.addEventListener('click', (e) => {
            const dragDistance = Math.sqrt(Math.pow(e.clientX - dragStartX, 2) + Math.pow(e.clientY - dragStartY, 2));
            if (dragDistance < 8) { // Simple clic, pas de drag
                if (this.sphere.state === 'sleeping') {
                    this.wakeUp();
                } else if (this.isListening) {
                    this.stopSpeechRecognition();
                } else {
                    this.triggerListening();
                }
            }
        });

        // Calibration du son de réveil
        this.calibrateBtn.addEventListener('click', () => this.calibrateWakeSound());
        
        // Basculement Caméra/Gestes
        this.cameraToggle.addEventListener('change', (e) => {
            this.toggleCamera(e.target.checked);
        });

        // Modification en temps réel de la quantité de neurones de la sphère
        this.particleSlider.addEventListener('input', (e) => {
            const count = parseInt(e.target.value);
            this.particleVal.textContent = count;
            this.sphere.updateParticleCount(count);
            this.config.particle_count = count;
        });

        // Écouteurs de l'onglet Modules
        if (this.selectModuleFileBtn && this.importModuleFileInput) {
            this.selectModuleFileBtn.addEventListener('click', () => {
                this.importModuleFileInput.click();
            });
        }

        if (this.importModuleFileInput) {
            this.importModuleFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file && this.selectedModuleFilename) {
                    this.selectedModuleFilename.textContent = file.name;
                } else if (this.selectedModuleFilename) {
                    this.selectedModuleFilename.textContent = "Aucun fichier choisi";
                }
            });
        }

        if (this.uploadModuleBtn) {
            this.uploadModuleBtn.addEventListener('click', () => {
                this.uploadModule();
            });
        }

        if (this.reloadModulesBtn) {
            this.reloadModulesBtn.addEventListener('click', () => {
                this.reloadModules();
            });
        }

        // Sliders de la synthèse vocale
        if (this.ttsRateSlider) {
            this.ttsRateSlider.addEventListener('input', (e) => {
                const rate = parseFloat(e.target.value);
                if (this.ttsRateVal) this.ttsRateVal.textContent = rate.toFixed(1);
            });
        }

        if (this.ttsPitchSlider) {
            this.ttsPitchSlider.addEventListener('input', (e) => {
                const pitch = parseFloat(e.target.value);
                if (this.ttsPitchVal) this.ttsPitchVal.textContent = pitch.toFixed(1);
            });
        }
    }

    toggleSettings(forceState) {
        const isVisible = this.settingsPanel.classList.contains('open');
        const shouldShow = forceState !== undefined ? forceState : !isVisible;
        
        if (shouldShow) {
            // Ouvrir les réglages
            const now = Date.now();
            if (now - this.lastSettingsClosedTime > 15000) {
                this.switchSettingsTab('general');
            }
            
            this.settingsBackdrop.classList.remove('hidden');
            this.settingsPanel.classList.remove('hidden');
            
            // Forcer le reflow pour les transitions
            this.settingsPanel.offsetHeight;
            
            this.settingsBackdrop.classList.add('open');
            this.settingsPanel.classList.add('open');
        } else {
            // Fermer les réglages
            this.lastSettingsClosedTime = Date.now();
            this.settingsBackdrop.classList.remove('open');
            this.settingsPanel.classList.remove('open');
            
            setTimeout(() => {
                this.settingsBackdrop.classList.add('hidden');
                this.settingsPanel.classList.add('hidden');
            }, 300); // Correspond à la durée de transition CSS
        }
    }

    switchSettingsTab(tabName) {
        this.currentSettingsTab = tabName;
        
        // Mettre à jour la classe active sur les boutons
        this.tabButtons.forEach(btn => {
            if (btn.getAttribute('data-tab') === tabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // Mettre à jour la visibilité des panes de contenu
        this.tabPanes.forEach(pane => {
            if (pane.id === `tab-${tabName}`) {
                pane.classList.remove('hidden');
                pane.classList.add('active');
            } else {
                pane.classList.add('hidden');
                pane.classList.remove('active');
            }
        });
    }

    handleChatInput() {
        const text = this.chatInput.value.trim();
        if (!text) return;
        
        this.chatInput.value = "";
        
        // Afficher l'entrée utilisateur
        this.userInputDisplay.textContent = `Vous : "${text}"`;
        this.userInputDisplay.classList.remove('hidden');
        
        // Intercepter les commandes locales
        if (text.startsWith('/')) {
            this.executeLocalCommand(text);
            return;
        }
        
        // Sinon, envoyer le texte par WebSocket
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'transcription',
                text: text
            }));
            this.resetSleepTimer();
        } else {
            this.responseDisplay.textContent = "Erreur : Non connecté au serveur Jarvis.";
        }
    }

    executeLocalCommand(cmdText) {
        const parts = cmdText.split(' ');
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');
        
        this.sphere.setState('thinking');
        
        setTimeout(() => {
            switch (cmd) {
                case '/help':
                    this.responseDisplay.innerHTML = `<strong>Commandes locales de JARVIS :</strong><br>
                    • <code>/settings</code> : Ouvrir la configuration<br>
                    • <code>/clear</code> : Effacer la zone de dialogue<br>
                    • <code>/camera</code> ou <code>/cam</code> : Activer/désactiver la caméra<br>
                    • <code>/micro</code> ou <code>/mic</code> : Activer/désactiver le micro<br>
                    • <code>/sleep</code> : Mettre Jarvis en veille<br>
                    • <code>/wake</code> : Réveiller Jarvis<br>
                    • <code>/version</code> : Gérer les versions système<br>
                    • <code>/mod</code> : Gérer les modules d'extension<br>
                    • <code>/doc</code> : Voir la documentation de création de modules`;
                    this.sphere.setState('idle');
                    break;
                    
                case '/settings':
                    this.toggleSettings(true);
                    this.responseDisplay.textContent = "Menu de configuration ouvert.";
                    this.sphere.setState('idle');
                    break;
                    
                case '/clear':
                    this.userInputDisplay.textContent = "";
                    this.userInputDisplay.classList.add('hidden');
                    this.responseDisplay.textContent = "Dialogue effacé.";
                    this.sphere.setState('idle');
                    break;
                    
                case '/camera':
                case '/cam':
                    const nextCamState = !this.config.camera_active;
                    this.toggleCamera(nextCamState);
                    this.responseDisplay.textContent = nextCamState ? "Caméra activée." : "Caméra désactivée.";
                    this.sphere.setState('idle');
                    break;

                case '/mic':
                case '/micro':
                    const nextMicState = !(this.config.mic_active !== false);
                    this.config.mic_active = nextMicState;
                    if (this.micToggle) this.micToggle.checked = nextMicState;
                    
                    if (nextMicState) {
                        this.responseDisplay.textContent = "Microphone activé.";
                        this.startSpeechRecognition();
                    } else {
                        this.responseDisplay.textContent = "Microphone désactivé (Jarvis n'écoute plus la voix).";
                        this.stopSpeechRecognition();
                    }
                    this.syncSensorColors();
                    this.saveConfigToServer();
                    this.sphere.setState('idle');
                    break;
                    
                case '/sleep':
                    this.goToSleep();
                    break;
                    
                case '/wake':
                    this.wakeUp();
                    break;
                    
                case '/version':
                    this.responseDisplay.textContent = `JARVIS Core Client v${this.config.version || '2.3.0'} (Modular Gel Orb Edition)`;
                    this.sphere.setState('idle');
                    break;

                case '/mod':
                    this.toggleSettings(true);
                    this.switchSettingsTab('modules');
                    this.responseDisplay.textContent = "Gestionnaire de modules ouvert.";
                    this.sphere.setState('idle');
                    break;

                case '/doc':
                    window.open('/static/doc.html', '_blank');
                    this.responseDisplay.textContent = "Ouverture de la documentation des modules dans un nouvel onglet.";
                    this.sphere.setState('idle');
                    break;
                    
                default:
                    this.responseDisplay.textContent = `Commande inconnue : ${cmd}. Tapez /help pour voir la liste des commandes.`;
                    this.sphere.setState('idle');
                    break;
            }
        }, 300);
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

        // Quantité de neurones
        const count = this.config.particle_count || 600;
        this.particleSlider.value = count;
        this.particleVal.textContent = count;
        this.sphere.updateParticleCount(count);

        // État des capteurs
        if (this.micToggle) {
            this.micToggle.checked = this.config.mic_active !== false;
        }
        if (this.cameraToggle) {
            this.cameraToggle.checked = !!this.config.camera_active;
        }

        // Voix et presets TTS
        if (this.ttsVoiceSelect) {
            this.ttsVoiceSelect.value = this.config.tts_voice || "";
        }
        if (this.ttsRateSlider) {
            const rate = this.config.tts_rate !== undefined ? this.config.tts_rate : 1.0;
            this.ttsRateSlider.value = rate;
            if (this.ttsRateVal) this.ttsRateVal.textContent = rate.toFixed(1);
        }
        if (this.ttsPitchSlider) {
            const pitch = this.config.tts_pitch !== undefined ? this.config.tts_pitch : 1.0;
            this.ttsPitchSlider.value = pitch;
            if (this.ttsPitchVal) this.ttsPitchVal.textContent = pitch.toFixed(1);
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

        this.config.particle_count = parseInt(this.particleSlider.value);
        
        if (this.ttsVoiceSelect) {
            this.config.tts_voice = this.ttsVoiceSelect.value;
        }
        if (this.ttsRateSlider) {
            this.config.tts_rate = parseFloat(this.ttsRateSlider.value);
        }
        if (this.ttsPitchSlider) {
            this.config.tts_pitch = parseFloat(this.ttsPitchSlider.value);
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

    saveConfigToServer() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'save_config',
                config: this.config
            }));
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
        
        // Appliquer la voix configurée
        const voices = this.speechSynthesis.getVoices();
        if (this.config.tts_voice) {
            const selectedVoice = voices.find(v => v.name === this.config.tts_voice);
            if (selectedVoice) {
                this.currentUtterance.voice = selectedVoice;
            }
        } else {
            // Chercher une voix française de qualité (ex: Microsoft Hortense ou Google)
            const frVoice = voices.find(v => v.lang.startsWith('fr'));
            if (frVoice) {
                this.currentUtterance.voice = frVoice;
            }
        }
        
        this.currentUtterance.lang = this.currentUtterance.voice ? this.currentUtterance.voice.lang : 'fr-FR';
        
        // Appliquer les rate et pitch
        this.currentUtterance.rate = this.config.tts_rate !== undefined ? this.config.tts_rate : 1.0;
        this.currentUtterance.pitch = this.config.tts_pitch !== undefined ? this.config.tts_pitch : 1.0;

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

    // Effet d'apparition progressive de lettres pour dévoiler le texte
    revealText(element, text, callback) {
        if (element.revealTimer) {
            clearInterval(element.revealTimer);
        }
        element.innerHTML = "";
        
        const chars = Array.from(text);
        let index = 0;
        
        element.revealTimer = setInterval(() => {
            if (index < chars.length) {
                const char = chars[index];
                const span = document.createElement('span');
                if (char === ' ') {
                    span.innerHTML = '&nbsp;';
                } else if (char === '\n') {
                    span.appendChild(document.createElement('br'));
                } else {
                    span.textContent = char;
                }
                span.style.opacity = '0';
                span.style.transition = 'opacity 200ms ease';
                element.appendChild(span);
                
                // Forcer le recalcul du layout
                span.getBoundingClientRect();
                span.style.opacity = '1';
                index++;
            } else {
                clearInterval(element.revealTimer);
                element.revealTimer = null;
                if (callback) callback();
            }
        }, 15);
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
        if (this.config.mic_active === false) {
            this.stopSpeechRecognition();
            return;
        }
        if (this.recognition && !this.isListening && !this.isSpeechActive && this.sphere.state !== 'sleeping') {
            try {
                this.isListening = true;
                this.recognition.start();
                this.syncSensorColors();
            } catch (e) {
                this.isListening = false;
                this.syncSensorColors();
            }
        }
    }

    stopSpeechRecognition() {
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {}
        }
        this.isListening = false;
        this.syncSensorColors();
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

        // Si le micro était globalement désactivé, le réactiver
        if (this.config.mic_active === false) {
            this.config.mic_active = true;
            if (this.micToggle) this.micToggle.checked = true;
            this.saveConfigToServer();
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
        
        if (this.cameraToggle) {
            this.cameraToggle.checked = active;
        }
        
        if (active) {
            try {
                this.responseDisplay.textContent = "Démarrage de la caméra pour le contrôle gestuel...";
                await this.handTracker.start();
                this.responseDisplay.textContent = "Suivi des mains actif. Approchez votre main de la caméra pour voir le morphing 3D.";
                this.syncSensorColors();
            } catch (e) {
                if (this.cameraToggle) {
                    this.cameraToggle.checked = false;
                }
                this.responseDisplay.textContent = e.message;
                this.syncSensorColors();
                active = false;
            }
        } else {
            this.handTracker.stop();
            this.syncSensorColors();
        }

        // Sauvegarder l'état dans la config
        if (this.config.camera_active !== active) {
            this.config.camera_active = active;
            this.saveConfigToServer();
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

    dismissLoadingScreen() {
        const loader = document.getElementById('loading-screen');
        if (loader && !loader.classList.contains('fade-out')) {
            loader.classList.add('fade-out');
        }
    }

    reloadModules() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'reload_modules'
            }));
            this.say("Rechargement des modules demandé.");
        }
    }

    uploadModule() {
        const file = this.importModuleFileInput.files[0];
        if (!file) {
            this.showImportMessage("Veuillez sélectionner un fichier .py d'abord.", false);
            return;
        }
        
        if (!file.name.endsWith('.py')) {
            this.showImportMessage("Seuls les fichiers Python (.py) sont acceptés.", false);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const code = e.target.result;
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    type: 'import_module',
                    filename: file.name,
                    code: code
                }));
                this.showImportMessage("Importation en cours...", null);
            } else {
                this.showImportMessage("Erreur: connexion perdue.", false);
            }
        };
        reader.readAsText(file);
    }

    showImportMessage(text, success) {
        if (!this.importStatusMessage) return;
        this.importStatusMessage.style.display = 'block';
        this.importStatusMessage.textContent = text;
        if (success === true) {
            this.importStatusMessage.style.color = '#34c759'; // Apple green
        } else if (success === false) {
            this.importStatusMessage.style.color = '#ff3b30'; // Apple red
        } else {
            this.importStatusMessage.style.color = '#8e8e93'; // Apple gray
        }
    }

    renderModulesList(modules) {
        if (!this.modulesListContainer) return;
        this.modulesListContainer.innerHTML = '';
        
        if (!modules || modules.length === 0) {
            this.modulesListContainer.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary);">Aucun module détecté.</p>';
            return;
        }

        modules.forEach(mod => {
            const card = document.createElement('div');
            card.className = 'module-card';
            
            const badgeClass = mod.enabled ? 'active' : 'inactive';
            const badgeText = mod.enabled ? 'Actif' : 'Inactif';
            
            card.innerHTML = `
                <div class="module-info">
                    <div class="module-title-row">
                        <span class="module-name">${mod.name}</span>
                        <span class="module-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="module-description">${mod.description || 'Aucune description fournie.'}</div>
                    <div class="module-keywords">Mots-clés: ${mod.keywords.join(', ')}</div>
                </div>
                <label class="switch">
                    <input type="checkbox" class="module-toggle-checkbox" data-name="${mod.name}" ${mod.enabled ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            `;
            
            // Ajouter un écouteur de changement pour le switch
            const checkbox = card.querySelector('.module-toggle-checkbox');
            checkbox.addEventListener('change', (e) => {
                this.toggleModule(mod.name, e.target.checked);
            });
            
            this.modulesListContainer.appendChild(card);
        });
    }

    toggleModule(moduleName, enabled) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'toggle_module',
                module_name: moduleName,
                enabled: enabled
            }));
            const actionText = enabled ? "activé" : "désactivé";
            this.say(`Module ${moduleName} ${actionText}.`);
        }
    }

    populateTtsVoices() {
        if (!this.ttsVoiceSelect) return;
        
        const voices = this.speechSynthesis.getVoices();
        this.ttsVoiceSelect.innerHTML = '<option value="">Par défaut (Système)</option>';
        
        const frVoices = voices.filter(v => v.lang.startsWith('fr'));
        const otherVoices = voices.filter(v => !v.lang.startsWith('fr'));
        
        if (frVoices.length > 0) {
            const optGroupFr = document.createElement('optgroup');
            optGroupFr.label = "Voix Françaises";
            frVoices.forEach(voice => {
                const opt = document.createElement('option');
                opt.value = voice.name;
                opt.textContent = `${voice.name} (${voice.lang})`;
                optGroupFr.appendChild(opt);
            });
            this.ttsVoiceSelect.appendChild(optGroupFr);
        }
        
        if (otherVoices.length > 0) {
            const optGroupOther = document.createElement('optgroup');
            optGroupOther.label = "Autres Langues";
            otherVoices.forEach(voice => {
                const opt = document.createElement('option');
                opt.value = voice.name;
                opt.textContent = `${voice.name} (${voice.lang})`;
                optGroupOther.appendChild(opt);
            });
            this.ttsVoiceSelect.appendChild(optGroupOther);
        }

        if (this.config.tts_voice) {
            this.ttsVoiceSelect.value = this.config.tts_voice;
        }
    }
}
