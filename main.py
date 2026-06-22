import os
import json
import asyncio
import importlib
import inspect
import pkgutil
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
import google.generativeai as genai
import urllib.request
import urllib.parse

from database import DatabaseManager
import modules

app = FastAPI(title="Jarvis Core")
db = DatabaseManager()

# Variables globales de configuration et d'état
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
config = {}
loaded_modules = []
is_sleeping = False
active_connections = set()

# Charger la configuration
def load_config():
    global config
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    else:
        config = {
            "gemini_api_key": "",
            "ollama_url": "http://localhost:11434",
            "provider": "gemini",
            "model_name": "gemini-1.5-flash",
            "port": 8000,
            "wake_sound_tolerance": 0.85,
            "wake_sound_fingerprint": None,
            "particle_count": 600,
            "version": "2.3.0",
            "camera_active": False,
            "mic_active": True,
            "disabled_modules": [],
            "tts_voice": "",
            "tts_rate": 1.0,
            "tts_pitch": 1.0
        }
        save_config(config)
    
    # Assurer la présence des clés par défaut si config existait sans elles
    needs_save = False
    if "particle_count" not in config:
        config["particle_count"] = 600
        needs_save = True
    if "version" not in config:
        config["version"] = "2.3.0"
        needs_save = True
    elif config.get("version") != "2.3.0":
        config["version"] = "2.3.0"
        needs_save = True
    if "camera_active" not in config:
        config["camera_active"] = False
        needs_save = True
    if "mic_active" not in config:
        config["mic_active"] = True
        needs_save = True
    if "disabled_modules" not in config:
        config["disabled_modules"] = []
        needs_save = True
    if "tts_voice" not in config:
        config["tts_voice"] = ""
        needs_save = True
    if "tts_rate" not in config:
        config["tts_rate"] = 1.0
        needs_save = True
    if "tts_pitch" not in config:
        config["tts_pitch"] = 1.0
        needs_save = True
        
    if needs_save:
        save_config(config)
        
    return config

def save_config(new_config):
    global config
    config = new_config
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    # Reconfigurer Gemini si besoin
    if config.get("provider") == "gemini" and config.get("gemini_api_key"):
        genai.configure(api_key=config.get("gemini_api_key"))

load_config()

async def watch_config_file():
    last_mtime = os.path.getmtime(CONFIG_PATH) if os.path.exists(CONFIG_PATH) else 0
    while True:
        await asyncio.sleep(2)
        try:
            if os.path.exists(CONFIG_PATH):
                current_mtime = os.path.getmtime(CONFIG_PATH)
                if current_mtime > last_mtime:
                    last_mtime = current_mtime
                    print("[Watcher] Détection de modification de config.json, rechargement...")
                    load_config()
                    load_all_modules()
                    if active_connections:
                        config_msg = {
                            "type": "config",
                            "config": config
                        }
                        modules_msg = {
                            "type": "modules_list",
                            "modules": get_modules_info()
                        }
                        tasks = []
                        for ws in list(active_connections):
                            tasks.append(ws.send_json(config_msg))
                            tasks.append(ws.send_json(modules_msg))
                        await asyncio.gather(*tasks, return_exceptions=True)
        except Exception as e:
            print(f"[Watcher] Erreur lors de la vérification de config.json : {e}")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(watch_config_file())

# Charger les modules d'extension
def load_all_modules():
    global loaded_modules
    loaded_modules = []
    print("[Modules] Détection et chargement des modules...")
    for _, module_name, _ in pkgutil.iter_modules(modules.__path__):
        try:
            mod = importlib.import_module(f"modules.{module_name}")
            importlib.reload(mod)
            
            for name, cls in inspect.getmembers(mod, inspect.isclass):
                if cls.__module__ == f"modules.{module_name}":
                    if hasattr(cls, "name") and hasattr(cls, "execute") and hasattr(cls, "keywords"):
                        loaded_modules.append(cls())
                        print(f"[Modules] Chargé : {cls.name} ({len(cls.keywords)} mots-clés)")
        except Exception as e:
            print(f"[Modules] Impossible de charger le module {module_name} : {e}")
            
    # Trier les modules par priorité (plus petite valeur de priorité en premier)
    loaded_modules.sort(key=lambda m: getattr(m, "priority", 5))
    return loaded_modules

load_all_modules()

def get_modules_info():
    disabled = config.get("disabled_modules", [])
    info = []
    for mod_instance in loaded_modules:
        filename = mod_instance.__class__.__module__.split(".")[-1] + ".py"
        info.append({
            "name": mod_instance.name,
            "description": getattr(mod_instance, "description", ""),
            "keywords": mod_instance.keywords,
            "filename": filename,
            "enabled": mod_instance.name not in disabled
        })
    return info

# Obtenir une instance client LLM ou URL
def get_llm_client():
    provider = config.get("provider", "gemini")
    if provider == "gemini":
        api_key = config.get("gemini_api_key")
        if api_key:
            try:
                genai.configure(api_key=api_key)
                return genai
            except Exception as e:
                print(f"[LLM] Erreur configuration Gemini : {e}")
        return None
    elif provider == "ollama":
        return config.get("ollama_url", "http://localhost:11434")
    return None

# Orchestrer la réponse LLM
async def get_llm_response(prompt, chat_history, memories):
    provider = config.get("provider", "gemini")
    model_name = config.get("model_name", "gemini-1.5-flash")
    
    # Construire le prompt système avec l'identité de Jarvis et les souvenirs
    memories_str = json.dumps(memories, indent=2, ensure_ascii=False)
    system_prompt = f"""
Tu es JARVIS, un assistant virtuel futuriste, rapide, intelligent et direct.
Tu t'adresses à l'utilisateur de manière polie et technologique (vouvoiement ou tutoiement selon l'historique, privilégie le tutoiement amical mais pro).
Sois concis, rapide et extrêmement précis. N'utilise pas d'introductions inutiles.

Informations connues sur l'utilisateur (Mémoire à long terme) :
{memories_str}

Consignes :
1. Si l'utilisateur pose une question sur lui-même ou des éléments mémorisés, utilise les données ci-dessus.
2. Formule ta réponse sous forme de texte brut facile à lire à haute voix (évite les syntaxes markdown trop complexes comme les listes à puces trop longues).
"""

    if provider == "gemini":
        client = get_llm_client()
        if not client:
            return "Veuillez configurer votre clé API Gemini dans les réglages en haut à droite."
        
        try:
            # Formater l'historique de chat pour Gemini
            contents = [{"role": "user", "parts": [system_prompt + "\n\nInitialise-toi avec cette personnalité."]}]
            
            # Ajouter l'historique récent
            for msg in chat_history:
                role = "model" if msg["role"] == "assistant" else "user"
                contents.append({"role": role, "parts": [msg["content"]]})
                
            # Ajouter le prompt actuel
            contents.append({"role": "user", "parts": [prompt]})
            
            model = client.GenerativeModel(model_name)
            response = await asyncio.to_thread(model.generate_content, contents)
            return response.text
        except Exception as e:
            return f"Erreur avec l'API Gemini : {e}. Vérifiez votre clé API ou votre connexion."
            
    elif provider == "ollama":
        url = get_llm_client()
        # Formater pour Ollama (modèle simple chat)
        ollama_prompt = f"{system_prompt}\n\nHistorique :\n"
        for msg in chat_history:
            ollama_prompt += f"{msg['role']}: {msg['content']}\n"
        ollama_prompt += f"user: {prompt}\nassistant:"
        
        try:
            data = {
                "model": model_name,
                "prompt": ollama_prompt,
                "stream": False
            }
            req_data = json.dumps(data).encode("utf-8")
            req = urllib.request.Request(
                f"{url}/api/generate", 
                data=req_data, 
                headers={"Content-Type": "application/json"}
            )
            
            # Exécuter l'appel réseau dans un thread séparé pour ne pas bloquer l'async
            def run_request():
                with urllib.request.urlopen(req, timeout=15) as response:
                    return json.loads(response.read().decode('utf-8'))
                    
            res = await asyncio.to_thread(run_request)
            return res.get("response", "Aucune réponse d'Ollama.")
        except Exception as e:
            return f"Erreur avec Ollama ({url}) : {e}. Assurez-vous qu'Ollama tourne et que le modèle {model_name} est chargé."
            
    return "Aucun fournisseur de LLM n'est correctement configuré."

import unicodedata

def normalize_text(text):
    text = text.lower()
    text = "".join(
        c for c in unicodedata.normalize('NFD', text)
        if unicodedata.category(c) != 'Mn'
    )
    for char in ".,!?;:()[]{}*-_+=\"'/\\":
        text = text.replace(char, " ")
    return " ".join(text.split())

def levenshtein_distance(s1, s2):
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
        
    return previous_row[-1]

def match_keywords(text, keywords):
    norm_text = normalize_text(text)
    words = norm_text.split()
    
    for kw in keywords:
        norm_kw = normalize_text(kw)
        if norm_kw in norm_text:
            return True
            
        kw_words = norm_kw.split()
        if len(kw_words) == 1:
            target_kw = kw_words[0]
            for w in words:
                max_dist = 1 if len(target_kw) <= 4 else 2
                if levenshtein_distance(w, target_kw) <= max_dist:
                    return True
    return False

@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")

# Routeur de WebSockets pour l'interaction en direct
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global is_sleeping
    await websocket.accept()
    active_connections.add(websocket)
    print("[WebSocket] Client connecté")
    
    try:
        # Envoyer la config au démarrage
        await websocket.send_json({
            "type": "config",
            "config": config
        })
        
        # Envoyer l'état des modules chargés
        await websocket.send_json({
            "type": "modules_list",
            "modules": get_modules_info()
        })

        # Envoyer l'historique récent des conversations
        history = db.get_recent_chat_history(limit=15)
        await websocket.send_json({
            "type": "history",
            "history": history
        })

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            if msg_type == "transcription":
                text = data.get("text", "").strip()
                if not text:
                    continue
                
                print(f"[WebSocket] Entrée utilisateur : {text}")
                db.add_chat_message("user", text)
                
                # Rechercher si un module local actif correspond
                module_triggered = False
                module_response = ""
                
                disabled = config.get("disabled_modules", [])
                for module in loaded_modules:
                    if module.name in disabled:
                        continue  # Ne pas exécuter si désactivé
                        
                    # Vérifier si l'un des mots-clés est dans le texte (avec tolérance aux typos et langues)
                    if match_keywords(text, module.keywords):
                        print(f"[Modules] Activation du module : {module.name}")
                        try:
                            # Envoyer un signal de réflexion au client
                            await websocket.send_json({"type": "thinking"})
                            # Exécuter le module
                            module_response = await module.execute(text, {"websocket": websocket, "db": db})
                            module_triggered = True
                            break
                        except Exception as e:
                            print(f"[Modules] Erreur exécution {module.name} : {e}")
                            module_response = f"Erreur dans le module {module.name}."
                            module_triggered = True
                            break
                
                if module_triggered:
                    print(f"[Modules] Réponse : {module_response}")
                    db.add_chat_message("assistant", module_response)
                    await websocket.send_json({
                        "type": "response",
                        "text": module_response,
                        "module": True
                    })
                else:
                    # Traitement LLM standard
                    await websocket.send_json({"type": "thinking"})
                    history = db.get_recent_chat_history(limit=10)
                    memories = db.get_all_memories()
                    
                    llm_response = await get_llm_response(text, history, memories)
                    print(f"[LLM] Réponse : {llm_response}")
                    db.add_chat_message("assistant", llm_response)
                    
                    await websocket.send_json({
                        "type": "response",
                        "text": llm_response,
                        "module": False
                    })
                    
            elif msg_type == "sleep":
                if not is_sleeping:
                    is_sleeping = True
                    print("[Système] Jarvis entre en veille. Lancement de la consolidation de la mémoire...")
                    # Lancer la consolidation dans un thread asynchrone pour ne pas bloquer les connexions
                    asyncio.create_task(async_consolidation())
                    
            elif msg_type == "wake":
                is_sleeping = False
                print("[Système] Jarvis est réveillé !")
                
            elif msg_type == "save_config":
                new_config = data.get("config", {})
                save_config(new_config)
                # Recharger les modules s'ils ont été modifiés
                load_all_modules()
                await websocket.send_json({
                    "type": "config",
                    "config": config
                })
                await websocket.send_json({
                    "type": "modules_list",
                    "modules": get_modules_info()
                })
                print("[Configuration] Sauvegardée avec succès")
                
            elif msg_type == "reload_modules":
                print("[Modules] Rechargement manuel demandé...")
                load_all_modules()
                await websocket.send_json({
                    "type": "modules_list",
                    "modules": get_modules_info()
                })
                
            elif msg_type == "toggle_module":
                module_name = data.get("module_name")
                enabled = data.get("enabled")
                disabled = config.get("disabled_modules", [])
                if not enabled:
                    if module_name not in disabled:
                        disabled.append(module_name)
                else:
                    if module_name in disabled:
                        disabled.remove(module_name)
                config["disabled_modules"] = disabled
                save_config(config)
                load_all_modules()
                await websocket.send_json({
                    "type": "modules_list",
                    "modules": get_modules_info()
                })
                print(f"[Modules] Statut de '{module_name}' mis à jour : {enabled}")
                
            elif msg_type == "import_module":
                filename = data.get("filename", "")
                code = data.get("code", "")
                if filename.endswith(".py") and code:
                    safe_filename = os.path.basename(filename)
                    modules_dir = os.path.join(os.path.dirname(__file__), "modules")
                    filepath = os.path.join(modules_dir, safe_filename)
                    try:
                        with open(filepath, "w", encoding="utf-8") as f:
                            f.write(code)
                        print(f"[Modules] Importation réussie : {safe_filename}")
                        load_all_modules()
                        await websocket.send_json({
                            "type": "import_module_status",
                            "success": True,
                            "message": f"Module '{safe_filename}' importé et chargé avec succès !",
                            "modules": get_modules_info()
                        })
                    except Exception as e:
                        print(f"[Modules] Échec importation {safe_filename} : {e}")
                        await websocket.send_json({
                            "type": "import_module_status",
                            "success": False,
                            "message": f"Échec d'importation : {e}"
                        })
                
    except WebSocketDisconnect:
        print("[WebSocket] Client déconnecté")
    except Exception as e:
        print(f"[WebSocket] Erreur générale : {e}")
    finally:
        active_connections.discard(websocket)

async def async_consolidation():
    # Attendre quelques secondes de veille continue avant de consolider pour être sûr
    await asyncio.sleep(5)
    if is_sleeping:
        client = get_llm_client()
        provider = config.get("provider")
        model_name = config.get("model_name")
        # Appeler la méthode de consolidation
        await asyncio.to_thread(db.consolidate_memory, client, provider, model_name)

# Monter le dossier static pour servir l'interface web
static_path = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_path, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_path), name="static")

if __name__ == "__main__":
    import uvicorn
    port = config.get("port", 8000)
    print(f"\n=======================================================")
    print(f"  JARVIS démarre sur http://localhost:{port}")
    print(f"  Accessible sur votre réseau local via l'IP de ce PC.")
    print(f"=======================================================\n")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
