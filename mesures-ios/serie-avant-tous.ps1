# Une série mémoire AVANT (code d'origine) WASM puis WebGPU, avec la série temporelle. Stash des cinq fichiers modifiés puis rétablissement.
$g = (Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Filter 'app-*' -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName + '\resources\app\git\cmd\git.exe'
Set-Location C:\Users\Yung\rat-market-travail\api\v2-banc-ios
& $g stash push -m ios-mesures2 -- v2/banc-telephone/public/app.js v2/banc-telephone/public/lot.json v2/banc-telephone/public/page.html v2/banc-telephone/public/verdict.mjs v2/banc-telephone/stockage.js | Out-Null
try {
    node outils\banc-telephone\pilote-memoire.js --etiquette=s-av-tous --moteur=tous --sonde-wasm=1 --serie=mesures-ios\serie-av-tous.csv --json=mesures-ios\s-av-tous.json | Out-Null
} finally {
    & $g stash pop | Out-Null
}
'FINI' | Set-Content C:\Users\Yung\rat-market-travail\api\v2-banc-ios\mesures-ios\serie-avant-tous.fini -Encoding ascii
