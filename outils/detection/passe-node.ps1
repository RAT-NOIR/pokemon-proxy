param([string]$Nom, [string]$Voie = 'auto')
# Une passe complete : chaine node sur les 465 photos -> nav -> rejeu J des 862 lignes -> comparaison a la reference. Sorties dans detection-deterministe\.
$R = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$DD = 'C:\Users\Yung\rat-market-travail\api\detection-deterministe'
$py = 'C:\Users\Yung\AppData\Local\Python\pythoncore-3.14-64\python.exe'
Set-Location $R
node --no-warnings "$R\outils\detection\chaine-node.mjs" 'C:\Users\Yung\rat-market-travail\api\index-empreintes-essai\manifeste-photos.json' "$DD\$Nom.json" "--voie=$Voie" > "$DD\$Nom.out.txt"
& $py -I "$R\outils\detection\transition.py" construire $Nom "$DD\$Nom.json" >> "$DD\$Nom.out.txt"
& "$R\outils\detection\rejeu-j.ps1" -Nom $Nom
Set-Location $R
& $py -I "$R\outils\detection\transition.py" comparer $Nom "$DD\$Nom.json" > "$DD\transition-$Nom.txt"
"$(Get-Date -Format s) passe $Nom finie" | Add-Content -Encoding utf8 "$DD\journal.txt"
