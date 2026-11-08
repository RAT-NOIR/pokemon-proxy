# La série COMPLÈTE de mesures du pic mémoire, AVANT (code d'origine d2c28b30, les cinq fichiers modifiés mis de côté par stash) puis APRÈS (le lot iOS). Pics exacts par psapi (echantillonneur-memoire.ps1).
# Sorties : mesures-ios\av-*.json / ap-*.json, vecs-*.bin (empreintes WASM), fichier serie-complete.fini à la fin.
$g = (Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Filter 'app-*' -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName + '\resources\app\git\cmd\git.exe'
Set-Location C:\Users\Yung\rat-market-travail\api\v2-banc-ios
& $g stash push -m ios-mesures -- v2/banc-telephone/public/app.js v2/banc-telephone/public/lot.json v2/banc-telephone/public/page.html v2/banc-telephone/public/verdict.mjs v2/banc-telephone/stockage.js | Out-Null
try {
    foreach ($i in 1, 2, 3) { node outils\banc-telephone\pilote-memoire.js --etiquette=avant-wasm-$i --moteur=wasm --sonde-wasm=1 --vecs=mesures-ios\vecs-av-wasm-$i.bin --json=mesures-ios\av-wasm-$i.json | Out-Null }
    foreach ($i in 1, 2) { node outils\banc-telephone\pilote-memoire.js --etiquette=avant-tous-$i --moteur=tous --sonde-gpu=1 --sonde-wasm=1 --json=mesures-ios\av-tous-$i.json | Out-Null }
    foreach ($i in 1, 2) { node outils\banc-telephone\pilote-memoire.js --etiquette=avant-gpu-$i --moteur=webgpu --sonde-gpu=1 --sonde-wasm=1 --json=mesures-ios\av-gpu-$i.json | Out-Null }
} finally {
    & $g stash pop | Out-Null
}
foreach ($i in 1, 2, 3) { node outils\banc-telephone\pilote-memoire.js --etiquette=apres-wasm-$i --moteur=wasm --sonde-wasm=1 --vecs=mesures-ios\vecs-ap-wasm-$i.bin --json=mesures-ios\ap-wasm-$i.json | Out-Null }
foreach ($i in 1, 2, 3) { node outils\banc-telephone\pilote-memoire.js --etiquette=apres-arena-$i --moteur=wasm --sonde-wasm=1 --query=session=arena0,pattern0 --vecs=mesures-ios\vecs-ap-arena-$i.bin --json=mesures-ios\ap-arena-$i.json | Out-Null }
foreach ($i in 1, 2) { node outils\banc-telephone\pilote-memoire.js --etiquette=apres-tous-$i --moteur=tous --sonde-gpu=1 --sonde-wasm=1 --vecs=mesures-ios\vecs-ap-tous-$i.bin --json=mesures-ios\ap-tous-$i.json | Out-Null }
foreach ($i in 1, 2) { node outils\banc-telephone\pilote-memoire.js --etiquette=apres-gpu-$i --moteur=webgpu --sonde-gpu=1 --sonde-wasm=1 --json=mesures-ios\ap-gpu-$i.json | Out-Null }
'FINI' | Set-Content C:\Users\Yung\rat-market-travail\api\v2-banc-ios\mesures-ios\serie-complete.fini -Encoding ascii
