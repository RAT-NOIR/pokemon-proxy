param([string]$Nom, [string]$Page, [string]$Manifeste = '-', [string]$Modele = '', [int]$Port = 18951, [int]$DelaiMax = 1800)
# Une passe d'une page de mesure dans Chrome headless (serveur local 127.0.0.1, profil jetable). Sortie : <DD>\<Nom>\ (resultat.json + octets postes).
# Arrets PAR PID seulement. Aucun reseau externe. $Page : ex. "dump640.html?qualite=high" (servi sous /p/).
$ErrorActionPreference = 'Stop'
$R = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$DD = 'C:\Users\Yung\rat-market-travail\api\detection-deterministe'
$sortie = "$DD\$Nom"
New-Item -ItemType Directory -Force $sortie | Out-Null
if (Test-Path "$sortie\resultat.json") { Remove-Item "$sortie\resultat.json" }
$argSrv = @("`"$R\outils\detection\serveur.js`"", $Port, "`"$sortie`"", "`"$Manifeste`"")
if ($Modele) { $argSrv += "`"$Modele`"" }
$srv = Start-Process 'C:\Program Files\nodejs\node.exe' -ArgumentList $argSrv -PassThru -WindowStyle Hidden -RedirectStandardOutput "$sortie\serveur.log"
Start-Sleep 2
$profil = "$DD\profil-$Nom"; if (Test-Path $profil) { Remove-Item $profil -Recurse -Force }
$url = "http://127.0.0.1:$Port/p/$Page"
$args2 = @('--headless=new', '--no-first-run', '--no-default-browser-check', "--user-data-dir=$profil", '--disable-extensions', '--remote-debugging-port=0', $url)
$chrome = Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList $args2 -PassThru
function Arbre($racine) { $tous = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId; $vu = New-Object 'System.Collections.Generic.HashSet[int]'; $file = New-Object 'System.Collections.Generic.Queue[int]'; [void]$vu.Add([int]$racine); $file.Enqueue([int]$racine)
  while ($file.Count -gt 0) { $p = $file.Dequeue(); foreach ($e in ($tous | Where-Object { $_.ParentProcessId -eq $p })) { if ($vu.Add([int]$e.ProcessId)) { $file.Enqueue([int]$e.ProcessId) } } }
  $vu }
$t0 = Get-Date
while (-not (Test-Path "$sortie\resultat.json") -and ((Get-Date) - $t0).TotalSeconds -lt $DelaiMax) { Start-Sleep -Milliseconds 1500 }
$duree = ((Get-Date) - $t0).TotalSeconds
foreach ($id in (Arbre $chrome.Id)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
Start-Sleep 2
if (-not @(Get-ChildItem $profil -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue).Count) { Remove-Item $profil -Recurse -Force -ErrorAction SilentlyContinue }
"$(Get-Date -Format s) fini $Nom : resultat $(Test-Path "$sortie\resultat.json"), $([math]::Round($duree)) s" | Add-Content -Encoding utf8 "$DD\journal.txt"
