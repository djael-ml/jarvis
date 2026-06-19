import sqlite3
import os
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "memory.db")

class DatabaseManager:
    def __init__(self):
        self.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        self.create_tables()

    def create_tables(self):
        cursor = self.conn.cursor()
        # Table de mémoire à long terme (Faits / Informations clés)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memory (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT
            )
        """)
        # Table de l'historique des conversations
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT,
                message TEXT,
                timestamp TEXT
            )
        """)
        self.conn.commit()

    def save_fact(self, key, value):
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute(
            "INSERT OR REPLACE INTO memory (key, value, updated_at) VALUES (?, ?, ?)",
            (key, str(value), now)
        )
        self.conn.commit()

    def get_fact(self, key):
        cursor = self.conn.cursor()
        cursor.execute("SELECT value FROM memory WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row[0] if row else None

    def get_all_memories(self):
        cursor = self.conn.cursor()
        cursor.execute("SELECT key, value FROM memory")
        return {row[0]: row[1] for row in cursor.fetchall()}

    def add_chat_message(self, role, message):
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute(
            "INSERT INTO chat_history (role, message, timestamp) VALUES (?, ?, ?)",
            (role, message, now)
        )
        self.conn.commit()

    def get_recent_chat_history(self, limit=20):
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT role, message FROM chat_history ORDER BY id DESC LIMIT ?",
            (limit,)
        )
        # Inverser pour renvoyer par ordre chronologique
        rows = cursor.fetchall()
        rows.reverse()
        return [{"role": row[0], "content": row[1]} for row in rows]

    def clear_chat_history(self):
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM chat_history")
        self.conn.commit()

    def consolidate_memory(self, llm_client, provider, model_name):
        """
        Analyse l'historique des conversations récentes lors de la mise en veille
        pour extraire des faits importants sur l'utilisateur et les stocker dans la mémoire à long terme.
        """
        history = self.get_recent_chat_history(limit=50)
        if not history:
            return

        # Construire le prompt d'analyse
        history_str = "\n".join([f"{msg['role']}: {msg['content']}" for msg in history])
        memories = self.get_all_memories()
        memories_str = json.dumps(memories, indent=2, ensure_ascii=False)

        prompt = f"""
Tu es l'analyste de données en arrière-plan pour Jarvis. Ta tâche est d'analyser l'historique des conversations récentes
et de mettre à jour la mémoire à long terme (les faits clés sur l'utilisateur, ses préférences, son nom, etc.).

Mémoire actuelle existante :
{memories_str}

Nouvel historique de conversation :
{history_str}

Identifie les faits clés révélés dans la conversation. Si un fait est nouveau ou modifie un fait existant,
inclus-le sous format JSON clé/valeur. Ne conserve que les informations pérennes et utiles pour assister l'utilisateur dans le futur.
Retourne UNIQUEMENT un objet JSON valide (pas de blabla, pas de markdown) sous la forme :
{{
  "nom_utilisateur": "Djael",
  "prefere_cafe": "Oui",
  ...
}}
Si aucun nouveau fait utile n'est trouvé, retourne un objet vide {{}}.
"""

        try:
            new_facts = {}
            if provider == "gemini" and llm_client:
                # Appeler Gemini API
                response = llm_client.models.generate_content(
                    model=model_name,
                    contents=prompt
                )
                text = response.text.strip()
                # Nettoyer d'éventuels backticks markdown
                if text.startswith("```"):
                    lines = text.split("\n")
                    if lines[0].startswith("```json"):
                        text = "\n".join(lines[1:-1])
                    elif lines[0].startswith("```"):
                        text = "\n".join(lines[1:-1])
                new_facts = json.loads(text.strip())
            elif provider == "ollama":
                # Ollama support (placeholder ou implémentation simple avec requests)
                import requests
                resp = requests.post(f"{llm_client}/api/generate", json={
                    "model": model_name,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json"
                }, timeout=10)
                if resp.status_code == 200:
                    text = resp.json().get("response", "{}")
                    new_facts = json.loads(text)
            
            if isinstance(new_facts, dict) and new_facts:
                for key, val in new_facts.items():
                    self.save_fact(key, val)
                print(f"[Mémoire] Consolidation réussie : {len(new_facts)} faits mis à jour.")
                
            # Après consolidation, on peut purger l'historique pour éviter qu'il ne grandisse indéfiniment
            # (ou garder juste les 10 derniers messages pour garder le contexte immédiat)
            cursor = self.conn.cursor()
            # Supprimer tous les messages sauf les 10 derniers
            cursor.execute("""
                DELETE FROM chat_history WHERE id NOT IN (
                    SELECT id FROM chat_history ORDER BY id DESC LIMIT 10
                )
            """)
            self.conn.commit()
            
        except Exception as e:
            print(f"[Mémoire] Erreur lors de la consolidation : {e}")

    def close(self):
        self.conn.close()
