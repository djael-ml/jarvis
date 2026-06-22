import os
import sys
import json
import urllib.request
import urllib.error

# ASCII Art pour JARVIS en caractères ASCII standard (100% compatibles)
ASCII_ART = r"""
      _   _   ____   __     __  ___   ____
     | | / \ |  _ \  \ \   / / |_ _| / ___|
  _  | |/ _ \| |_) |  \ \ / /   | |  \___ \
 | |_| / ___ \  _ <    \ V /    | |   ___) |
  \___/_/   \_\_| \_\   \_/    |___| |____/
"""

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
LIBS_DIR = os.path.join(os.path.dirname(__file__), "static", "js", "libs")
MP_DIR = os.path.join(LIBS_DIR, "mediapipe")

ASSETS = {
    os.path.join(LIBS_DIR, "three.min.js"): "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    os.path.join(LIBS_DIR, "qrcode.min.js"): "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
    os.path.join(MP_DIR, "hands.js"): "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js",
    os.path.join(MP_DIR, "hands_solution_simd_wasm_bin.js"): "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands_solution_simd_wasm_bin.js",
    os.path.join(MP_DIR, "hands_solution_simd_wasm_bin.wasm"): "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands_solution_simd_wasm_bin.wasm",
    os.path.join(MP_DIR, "hands_solution_packed_assets.data"): "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands_solution_packed_assets.data",
    os.path.join(MP_DIR, "hands.binarypb"): "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.binarypb",
    os.path.join(MP_DIR, "hand_landmark_full.tflite"): "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hand_landmark_full.tflite",
    os.path.join(MP_DIR, "hand_landmark_lite.tflite"): "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hand_landmark_lite.tflite",
    os.path.join(MP_DIR, "hands_solution_packed_assets_loader.js"): "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands_solution_packed_assets_loader.js"
}

def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_config(config_data):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[-] Impossible de sauvegarder la configuration : {e}")

def setup_config():
    print("[*] Verification de la configuration...")
    config = load_config()
    defaults = {
        "gemini_api_key": "",
        "ollama_url": "http://localhost:11434",
        "provider": "gemini",
        "model_name": "gemini-1.5-flash",
        "port": 8000,
        "wake_sound_tolerance": 0.85,
        "wake_sound_fingerprint": None,
        "particle_count": 100,
        "version": "2.3.0",
        "camera_active": True,
        "mic_active": False,
        "disabled_modules": [],
        "tts_voice": "",
        "tts_rate": 1,
        "tts_pitch": 1
    }
    
    modified = False
    for k, v in defaults.items():
        if k not in config:
            config[k] = v
            modified = True
            
    if modified:
        save_config(config)
        print("[+] Configuration initialisee/mise a jour.")
    else:
        print("[+] Configuration valide.")
        
    return config

def download_assets():
    print("\n[*] Verification des ressources statiques (MediaPipe & Three.js)...")
    os.makedirs(LIBS_DIR, exist_ok=True)
    os.makedirs(MP_DIR, exist_ok=True)
    
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    
    for path, url in ASSETS.items():
        filename = os.path.basename(path)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            print(f"  [-] {filename} deja present localement.")
            continue
            
        print(f"  [+] Telechargement de {filename} depuis CDN...")
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                data = response.read()
                with open(path, "wb") as out_file:
                    out_file.write(data)
            print(f"  [OK] Sauvegarde : {filename} ({len(data)} octets)")
        except Exception as e:
            print(f"  [ERR] Echec du telechargement de {filename} : {e}")

def init_database():
    print("\n[*] Verification de la base de donnees SQLite...")
    try:
        # Assurer que u:\jarvis est dans le path pour importer database
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from database import DatabaseManager
        db = DatabaseManager()
        print("[OK] Base de donnees memory.db verifiee/initialisee.")
    except Exception as e:
        print(f"[-] Avertissement lors de l'initialisation de la base de donnees : {e}")

def main():
    print(ASCII_ART)
    print("=======================================================")
    print("              JARVIS - ASSISTANT SETUP                 ")
    print("=======================================================")
    
    config = setup_config()
    download_assets()
    init_database()
    
    # Prompt Gemini key interactively if stdin is a terminal
    if sys.stdin.isatty():
        current_key = config.get("gemini_api_key", "")
        if not current_key:
            try:
                print("\n--- CONFIGURATION DE LA CLÉ API GEMINI ---")
                print("Pour activer les fonctionnalites d'IA avancees avec Gemini,")
                print("obtenez une cle API gratuite sur : https://aistudio.google.com/")
                key_input = input("Entrez votre cle API Gemini (ou Entree pour ignorer) : ").strip()
                if key_input:
                    config["gemini_api_key"] = key_input
                    save_config(config)
                    print("[OK] Cle API enregistree !")
            except Exception:
                pass
                
    print("\n=======================================================")
    print("[OK] Installation et configuration de JARVIS terminees !")
    print("Utilisez la commande 'jarvis start' pour lancer l'assistant.")
    print("=======================================================")

if __name__ == "__main__":
    main()
