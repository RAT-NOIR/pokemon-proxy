# Cree « Juge Rat-Market.lnk » sur le Bureau : cible wscript.exe sur le lancer-juge.vbs de la COPIE d'api-v2 du Bureau (jamais celui du dossier d'ou ce script est lance),
# dossier de travail = cette copie. Refuse, avec un message clair, si ce fichier n'existe pas dans la copie.
# Usage : powershell -File outils\banc-200\creer-raccourci.ps1 [-Bureau <dossier>] [-Copie <dossier de la copie d'api-v2>]
param(
    [string]$Bureau = [Environment]::GetFolderPath('Desktop'),
    [string]$Copie = 'C:\Users\Yung\Desktop\pokemon-proxy-api-v2'
)
$ErrorActionPreference = 'Stop'
$vbs = Join-Path $Copie 'outils\banc-200\lancer-juge.vbs'
if (-not (Test-Path -LiteralPath $vbs)) { throw "La copie d'api-v2 n'a pas encore le juge : $vbs est introuvable. Mettez d'abord cette copie a jour (git pull), puis relancez ce script." }
if (-not (Test-Path -LiteralPath $Bureau)) { throw "Bureau introuvable : $Bureau" }
$lien = Join-Path $Bureau 'Juge Rat-Market.lnk'
$sh = New-Object -ComObject WScript.Shell
$l = $sh.CreateShortcut($lien)
$l.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$l.Arguments = '"' + $vbs + '"'
$l.WorkingDirectory = $Copie
$l.WindowStyle = 7
$l.Description = 'Juge Rat-Market : page locale de saisie des verites (banc des 200)'
$l.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',44'
$l.Save()
Write-Output "Raccourci cree : $lien -> $vbs"
