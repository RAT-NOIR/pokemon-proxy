@echo off
rem Lanceur LOCAL des imports quotidiens : SECOURS MANUEL (les imports tournent sur GitHub Actions). Aucune tache planifiee Windows.
rem La redirection de la sortie vit ICI (jamais cote PowerShell). Un fichier de journal par jour (date locale ISO).
set "DOSSIER=C:\Users\Yung\rat-market-travail\catalogue\journaux-locaux"
if not exist "%DOSSIER%" mkdir "%DOSSIER%"
rem date ISO independante du format regional (le %%date%% de cmd varie selon la langue et le jour de semaine)
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "JOUR=%%i"
set IMPORTS_QUOTIDIENS=1
cd /d "%~dp0"
node imports-quotidiens-local.js >> "%DOSSIER%\imports-quotidiens-%JOUR%.log" 2>&1
exit /b %ERRORLEVEL%
