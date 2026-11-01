# Cree « Juge Rat-Market.lnk » sur le Bureau : cible wscript.exe sur lancer-juge.vbs (aucune fenetre de console), dossier de travail = la copie d'api-v2 du Bureau.
# Usage : powershell -File outils\banc-200\creer-raccourci.ps1 [-Bureau <dossier>] [-DossierDeTravail <dossier>]
param(
    [string]$Bureau = [Environment]::GetFolderPath('Desktop'),
    [string]$DossierDeTravail = 'C:\Users\Yung\Desktop\pokemon-proxy-api-v2'
)
$ErrorActionPreference = 'Stop'
$vbs = Join-Path $PSScriptRoot 'lancer-juge.vbs'
if (-not (Test-Path -LiteralPath $vbs)) { throw "lancer-juge.vbs introuvable : $vbs" }
if (-not (Test-Path -LiteralPath $Bureau)) { throw "Bureau introuvable : $Bureau" }
$lien = Join-Path $Bureau 'Juge Rat-Market.lnk'
$sh = New-Object -ComObject WScript.Shell
$l = $sh.CreateShortcut($lien)
$l.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$l.Arguments = '"' + $vbs + '"'
$l.WorkingDirectory = $DossierDeTravail
$l.WindowStyle = 7
$l.Description = 'Juge Rat-Market : page locale de saisie des verites (banc des 200)'
$l.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',44'
$l.Save()
Write-Output "Raccourci cree : $lien"
