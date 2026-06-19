@echo off
if "%1"=="start" (
    echo ============================================
    echo [JARVIS] Initialisation et lancement...
    echo ============================================
    python main.py
) else (
    echo [JARVIS] Commande inconnue.
    echo Usage: jarvis start
)
