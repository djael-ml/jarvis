import os
import subprocess
import pyautogui

class SystemModule:
    name = "Contrôle Système"
    description = "Permet de contrôler le volume, de prendre des captures d'écran ou de lancer des applications sous Windows."
    keywords = [
        "volume", "son", "muet", "capture", "screenshot", 
        "lance", "ouvrir", "ouvre", "programme", "application"
    ]

    async def execute(self, text, context):
        text_lower = text.lower()
        
        # 1. Contrôle du Volume
        if "volume" in text_lower or "son" in text_lower:
            if any(w in text_lower for w in ["augmenter", "plus fort", "monte", "monter", "up"]):
                for _ in range(5):
                    pyautogui.press('volumeup')
                return "J'ai augmenté le volume."
            elif any(w in text_lower for w in ["diminuer", "moins fort", "baisse", "baisser", "down"]):
                for _ in range(5):
                    pyautogui.press('volumedown')
                return "J'ai diminué le volume."
            elif any(w in text_lower for w in ["couper", "muet", "silence", "mute"]):
                pyautogui.press('volumemute')
                return "J'ai basculé le mode muet."

        # 2. Capture d'écran
        if "capture" in text_lower or "screenshot" in text_lower:
            # Créer un dossier screenshots statique accessible par le web si on veut l'afficher
            static_screenshots_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "screenshots")
            os.makedirs(static_screenshots_dir, exist_ok=True)
            filename = f"capture_{os.urandom(4).hex()}.png"
            filepath = os.path.join(static_screenshots_dir, filename)
            
            # Prendre le screenshot
            screenshot = pyautogui.screenshot()
            screenshot.save(filepath)
            
            # URL relative pour l'afficher sur le web
            web_url = f"/static/screenshots/{filename}"
            # Envoyer une commande spéciale au client pour afficher l'image
            if "websocket" in context:
                await context["websocket"].send_json({
                    "type": "show_image",
                    "url": web_url
                })
            
            return f"Capture d'écran effectuée et sauvegardée sous le nom {filename}."

        # 3. Ouverture d'Applications (Windows)
        if any(w in text_lower for w in ["lance", "ouvrir", "ouvre"]):
            if any(w in text_lower for w in ["navigateur", "chrome", "internet"]):
                subprocess.Popen("start chrome", shell=True)
                return "J'ouvre Google Chrome."
            elif any(w in text_lower for w in ["notepad", "bloc-notes", "texte"]):
                subprocess.Popen("notepad.exe")
                return "J'ouvre le Bloc-notes."
            elif any(w in text_lower for w in ["calculatrice", "calc"]):
                subprocess.Popen("calc.exe")
                return "J'ouvre la calculatrice."
            elif any(w in text_lower for w in ["explorateur", "dossier"]):
                subprocess.Popen("explorer.exe")
                return "J'ouvre l'explorateur de fichiers."
            
            # Essayer de deviner le nom de l'application
            words = text_lower.split()
            for verb in ["lance", "ouvrir", "ouvre"]:
                if verb in words:
                    idx = words.index(verb)
                    if idx + 1 < len(words):
                        app_name = words[idx + 1]
                        # Retirer de potentiels caractères bizarres
                        app_clean = "".join(c for c in app_name if c.isalnum())
                        try:
                            # Tente de démarrer sous Windows via le shell
                            subprocess.Popen(f"start {app_clean}", shell=True)
                            return f"J'ai tenté de lancer l'application : {app_clean}."
                        except Exception as e:
                            return f"Impossible de démarrer {app_clean} : {e}"
            
        return "Commande système reçue mais l'action n'a pas pu être identifiée."
