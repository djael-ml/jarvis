import urllib.request
import json
import urllib.parse

class WeatherModule:
    name = "Météo"
    description = "Obtient les prévisions météo pour n'importe quelle ville via l'API gratuite Open-Meteo."
    priority = 1
    keywords = ["météo", "meteo", "meto", "temperature", "température", "degré", "degrés", "pluie", "rain", "soleil", "sun", "temps qu'il fait", "climat", "temps", "weather", "forecast", "previsions"]

    # Codes météo WMO traduits en français
    WMO_CODES = {
        0: "ciel dégagé",
        1: "principalement dégagé", 2: "partiellement nuageux", 3: "couvert",
        45: "brouillard", 48: "brouillard givrant",
        51: "bruine légère", 53: "bruine modérée", 55: "bruine dense",
        56: "bruine verglaçante légère", 57: "bruine verglaçante dense",
        61: "pluie faible", 63: "pluie modérée", 65: "pluie forte",
        66: "pluie verglaçante légère", 67: "pluie verglaçante forte",
        71: "chute de neige légère", 73: "chute de neige modérée", 75: "chute de neige forte",
        77: "grains de neige",
        80: "averses de pluie faibles", 81: "averses de pluie modérées", 82: "averses de pluie violentes",
        85: "averses de neige légères", 86: "averses de neige fortes",
        95: "orage léger ou modéré", 96: "orage avec grêle faible", 99: "orage avec grêle forte"
    }

    async def execute(self, text, context):
        text_lower = text.lower()
        
        # Trouver le nom de la ville
        # ex: "météo à Paris" ou "temps à Lyon" ou "température de Marseille"
        city = "Paris"  # Ville par défaut
        words = text_lower.split()
        
        # Mots indicateurs de localisation
        indicators = ["à", "a", "de", "pour", "sur"]
        for ind in indicators:
            if ind in words:
                idx = words.index(ind)
                if idx + 1 < len(words):
                    # Prendre le mot suivant (ou les mots restants s'il y a des noms composés)
                    city = " ".join(words[idx + 1:])
                    # Nettoyer les ponctuations
                    city = city.replace("?", "").replace(".", "").replace("!", "").strip()
                    break
        
        # Si la ville n'a pas été détectée par les prépositions, vérifier si un mot-clé météo est suivi d'un mot
        # ex: "météo Paris"
        for kw in self.keywords:
            if kw in text_lower:
                parts = text_lower.split(kw)
                if len(parts) > 1 and parts[1].strip():
                    potential_city = parts[1].strip().replace("?", "").replace(".", "").replace("!", "").strip()
                    if potential_city:
                        city = potential_city
                        break

        try:
            # 1. Obtenir les coordonnées géographiques de la ville (Geocoding API)
            encoded_city = urllib.parse.quote(city)
            geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={encoded_city}&count=1&language=fr&format=json"
            
            with urllib.request.urlopen(geo_url, timeout=5) as response:
                geo_data = json.loads(response.read().decode('utf-8'))
                
            if not geo_data.get("results"):
                return f"Désolé, je n'ai pas trouvé la ville de '{city}'."
            
            result = geo_data["results"][0]
            lat = result["latitude"]
            lon = result["longitude"]
            formatted_name = f"{result['name']} ({result.get('country', '')})"
            
            # 2. Obtenir la météo actuelle
            weather_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m"
            
            with urllib.request.urlopen(weather_url, timeout=5) as response:
                weather_data = json.loads(response.read().decode('utf-8'))
                
            current = weather_data["current"]
            temp = current["temperature_2m"]
            app_temp = current["apparent_temperature"]
            humidity = current["relative_humidity_2m"]
            code = current["weather_code"]
            wind = current["wind_speed_10m"]
            
            desc = self.WMO_CODES.get(code, "conditions variables")
            
            return f"Actuellement à {formatted_name}, le temps est : {desc}. La température est de {temp}°C (ressentie {app_temp}°C) avec une humidité de {humidity}% et un vent de {wind} km/h."
            
        except Exception as e:
            return f"Erreur lors de la récupération de la météo pour {city} : {e}"
