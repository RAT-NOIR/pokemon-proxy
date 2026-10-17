@echo off
rem Lanceur LOCAL des imports quotidiens (worker Render suspendu). A enregistrer dans le Planificateur de taches : voir COLLECTE-LOCALE-report.md.
rem La redirection de la sortie vit ICI (jamais cote PowerShell). Un fichier de journal par jour UTC-agnostique : date locale.
set "DOSSIER=C:\Users\Yung\rat-market-travail\catalogue\journaux-locaux"
if not exist "%DOSSIER%" mkdir "%DOSSIER%"
set "JOUR=%date:~-4%-%date:~3,2%-%date:~0,2%"
set IMPORTS_QUOTIDIENS=1
cd /d "%~dp0"
node imports-quotidiens-local.js >> "%DOSSIER%\imports-quotidiens-%JOUR%.log" 2>&1
exit /b %ERRORLEVEL%
