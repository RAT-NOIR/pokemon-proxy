@echo off
title Serveur Pokemon Vinted
cd /d "%~dp0"
echo ========================================
echo   Demarrage du serveur Pokemon Vinted
echo ========================================
echo.

REM Arreter UNIQUEMENT l'ancienne instance de ce serveur (node.exe lancant index.js qui ecoute sur le port), jamais les autres node
node arreter-instance-port.js

echo Lancement du serveur...
echo.
node index.js

REM Si le serveur s'arrete ou plante, la fenetre reste ouverte pour lire l'erreur
echo.
echo ========================================
echo   Le serveur s'est arrete.
echo ========================================
pause