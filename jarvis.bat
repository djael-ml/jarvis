@echo off
setlocal enabledelayedexpansion

:: Définition du chemin de l'environnement virtuel
set VENV_DIR=%~dp0.venv
set PYTHON_CMD=python
set PIP_CMD=pip

:: Si l'environnement virtuel existe, on l'utilise
if exist "%VENV_DIR%\Scripts\python.exe" (
    set PYTHON_CMD="%VENV_DIR%\Scripts\python.exe"
    set PIP_CMD="%VENV_DIR%\Scripts\pip.exe"
)

:: Gestion des arguments
set CMD=%1

if "%CMD%"=="" goto help
if "%CMD%"=="help" goto help
if "%CMD%"=="--help" goto help
if "%CMD%"=="-h" goto help

if "%CMD%"=="start" goto start
if "%CMD%"=="plug" goto plug
if "%CMD%"=="version" goto version
if "%CMD%"=="--v" goto version
if "%CMD%"=="-v" goto version
if "%CMD%"=="--version" goto version
if "%CMD%"=="-V" goto version
if "%CMD%"=="source" goto source
if "%CMD%"=="github" goto source
if "%CMD%"=="status" goto status
if "%CMD%"=="modules" goto modules

echo [JARVIS] Commande inconnue : %CMD%
echo Tapez 'jarvis help' pour voir la liste des commandes disponibles.
exit /b 1

:help
echo =======================================================
echo              JARVIS - ASSISTANT CLI SYSTEM             
echo =======================================================
echo Usage: jarvis [commande]
echo.
echo Commandes disponibles:
echo   start     Lancer le serveur core FastAPI de JARVIS.
echo   plug      Créer l'env virtuel, installer les deps et setup les assets.
echo   version   Afficher la version actuelle de JARVIS (alias: --v, -v).
echo   source    Ouvrir le dépôt GitHub officiel dans votre navigateur (alias: github).
echo   status    Afficher l'état du système et de la configuration de JARVIS.
echo   modules   Lister les modules JARVIS disponibles et installés.
echo   help      Afficher cette aide (alias: --help, -h).
echo =======================================================
exit /b 0

:start
echo =======================================================
echo [JARVIS] Initialisation et lancement du Core FastAPI...
echo =======================================================
if exist "%VENV_DIR%" goto start_venv_exists
echo [JARVIS] Avertissement: Aucun environnement virtuel detecte.
echo Il est fortement conseille de lancer 'jarvis plug' avant de demarrer.
:start_venv_exists
%PYTHON_CMD% main.py
exit /b %errorlevel%

:plug
echo =======================================================
echo [JARVIS] Lancement de la configuration et des installs...
echo =======================================================
:: Vérifier si Python est installé
where python >nul 2>nul
if errorlevel 1 goto plug_no_python

:: Créer l'environnement virtuel si inexistant
if exist "%VENV_DIR%" goto plug_venv_exists
echo [JARVIS] Creation de l'environnement virtuel (.venv)...
python -m venv "%VENV_DIR%"
if errorlevel 1 goto plug_venv_failed

:plug_venv_exists
:: Mettre à jour les variables pour le reste de l'install
set PYTHON_CMD="%VENV_DIR%\Scripts\python.exe"
set PIP_CMD="%VENV_DIR%\Scripts\pip.exe"

:: Installer les dépendances
echo [JARVIS] Mise a jour de pip...
%PYTHON_CMD% -m pip install --upgrade pip

echo [JARVIS] Installation des dependances (requirements.txt)...
%PIP_CMD% install -r "%~dp0requirements.txt"
if errorlevel 1 goto plug_deps_failed

:: Lancer le setup python
%PYTHON_CMD% "%~dp0setup_jarvis.py"
exit /b %errorlevel%

:plug_no_python
echo [JARVIS] Erreur: Python n'est pas installe ou pas dans le PATH.
echo Veuillez installer Python (v3.9+) avant de continuer.
exit /b 1

:plug_venv_failed
echo [JARVIS] Erreur lors de la creation du venv.
exit /b 1

:plug_deps_failed
echo [JARVIS] Erreur lors de l'installation des dependances.
exit /b 1

:version
where python >nul 2>nul
if errorlevel 1 goto version_fallback
%PYTHON_CMD% -c "import json; print('JARVIS Core - Version ' + json.load(open(r'%~dp0config.json', encoding='utf-8')).get('version', '2.3.0'))" 2>nul
if errorlevel 1 goto version_fallback
exit /b 0

:version_fallback
echo JARVIS Core - Version 2.3.0 (fallback)
exit /b 0

:source
echo [JARVIS] Ouverture du repertoire GitHub officiel...
start https://github.com/djael-ml/jarvis.git
exit /b 0

:status
echo =======================================================
echo              JARVIS - ETAT DU SYSTEME                  
echo =======================================================
echo OS : %OS%
if exist "%VENV_DIR%" goto status_venv_ok
echo Environnement virtuel (.venv) : Non configure [Lancer 'jarvis plug']
goto status_check_python
:status_venv_ok
echo Environnement virtuel (.venv) : Configure [OK]

:status_check_python
where python >nul 2>nul
if errorlevel 1 goto status_no_python
%PYTHON_CMD% -c "import json; cfg=json.load(open(r'%~dp0config.json', encoding='utf-8')); print('Version : ' + cfg.get('version', 'N/A') + '\nProvider IA : ' + cfg.get('provider', 'N/A') + '\nModel IA : ' + cfg.get('model_name', 'N/A') + '\nPort FastAPI : ' + str(cfg.get('port', 8000)) + '\nCamera active : ' + str(cfg.get('camera_active', False)))" 2>nul
goto status_end

:status_no_python
echo Impossible de lire la configuration sans Python dans le PATH.

:status_end
echo =======================================================
exit /b 0

:modules
echo =======================================================
echo              JARVIS - MODULES DISPONIBLES              
echo =======================================================
where python >nul 2>nul
if errorlevel 1 goto modules_no_python
%PYTHON_CMD% -c "import os, sys; sys.path.insert(0, r'%~dp0.'); import modules, inspect, pkgutil; print('Modules charges :'); [print(f' - {name} (Fichier: {name}.py)') for finder, name, ispkg in pkgutil.iter_modules(modules.__path__)]" 2>nul
goto modules_end

:modules_no_python
echo Liste des modules (depuis le dossier modules) :
dir /b "%~dp0modules\*.py" | findstr /v "__init__.py"

:modules_end
echo =======================================================
exit /b 0
