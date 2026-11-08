param([string]$Nom)
# Rejeu des lignes (rejeu_jumeaux_quant.js de p8000-quant, LECTURE SEULE de la base d'essai) avec detection-deterministe\nav\nav-<Nom>.json. Meme index scelle, meme archive, memes variables que ecart-safari\lancer_j.ps1 ; sortie dans detection-deterministe\verdicts\.
$DD = 'C:\Users\Yung\rat-market-travail\api\detection-deterministe'
$q = 'C:\Users\Yung\rat-market-travail\api\p8000-quant'
New-Item -ItemType Directory -Force "$DD\verdicts" | Out-Null
Set-Location "$q\verdicts"
$env:SORTIE = "$DD\verdicts\J-$Nom.json"
$env:NAV_JSON = "$DD\nav\nav-$Nom.json"
$env:INDEX_RMEI = 'C:\Users\Yung\rat-market-travail\api\index-empreintes-essai\sortie\index-empreintes-2026-10-24.rmei'
node --expose-gc "$q\verdicts\rejeu_jumeaux_quant.js" > "$DD\verdicts\J-$Nom.out.txt" 2> "$DD\verdicts\J-$Nom.err.txt"
"$(Get-Date -Format s) J-$Nom exit=$LASTEXITCODE" | Add-Content -Encoding utf8 "$DD\journal.txt"
