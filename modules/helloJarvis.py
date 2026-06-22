import datetime
import random

class HelloJarvisModule:
    name = "Hello Jarvis (Fonctions de base)"
    description = "Gère les salutations, l'heure, la date, l'identité et les remerciements hors ligne sans requêtes API."
    priority = 10
    keywords = [
        "bonjour", "salut", "hello", "hi", "hey", "yo", "ca va", "ça va",
        "heure", "time", "date", "jour", "aujourd'hui", "identity", "qui es tu", 
        "qui es-tu", "nom", "merci", "thanks", "thank you", "s'il te plaît", "s'il te plait"
    ]

    async def execute(self, text, context):
        text_lower = text.lower()
        
        # 1. Heure
        if any(w in text_lower for w in ["heure", "time", "hour"]):
            now = datetime.datetime.now()
            time_str = now.strftime("%H:%M")
            return f"Il est actuellement {time_str}."

        # 2. Date
        if any(w in text_lower for w in ["date", "jour", "aujourd'hui", "calendar"]):
            now = datetime.datetime.now()
            jours = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
            mois = [
                "janvier", "février", "mars", "avril", "mai", "juin", 
                "juillet", "août", "septembre", "octobre", "novembre", "décembre"
            ]
            jour_semaine = jours[now.weekday()]
            jour_mois = now.day
            nom_mois = mois[now.month - 1]
            annee = now.year
            return f"Nous sommes le {jour_semaine} {jour_mois} {nom_mois} {annee}."

        # 3. Salutations
        if any(w in text_lower for w in ["bonjour", "salut", "hello", "hi", "hey", "yo"]):
            greetings = [
                "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
                "Salut ! Je suis en ligne et à votre écoute.",
                "Bonjour. Systèmes pleinement opérationnels. Que puis-je faire pour vous ?",
                "Hello ! Ravi de vous entendre."
            ]
            return random.choice(greetings)

        # 4. Ca va
        if "ca va" in text_lower or "ça va" in text_lower or "comment tu vas" in text_lower:
            return "Je fonctionne à pleine capacité. Merci de vous en soucier ! Et vous, comment se passe votre journée ?"

        # 5. Identité / Qui es-tu
        if any(w in text_lower for w in ["qui es tu", "qui es-tu", "ton nom", "nom", "c'est quoi ton nom", "t'es qui"]):
            return "Je suis JARVIS, votre assistant virtuel personnel propulsé par une interface neurale 3D."

        # 6. Remerciements
        if any(w in text_lower for w in ["merci", "thanks", "thank you"]):
            thanks_responses = [
                "À votre service !",
                "C'est un plaisir de vous aider.",
                "Tout le plaisir est pour moi.",
                "N'hésitez pas si vous avez d'autres requêtes !"
            ]
            return random.choice(thanks_responses)

        return "Je suis à votre service. Comment puis-je vous aider ?"
