param([string]$Test = 'v2\test\test-argent-debit.js', [int]$N = 50)
$env:MONGOMS_DOWNLOAD_DIR = 'C:\Users\Yung\Desktop\pokemon-proxy\.banc-local\cache-mongod'
$echecs = 0
for ($i = 1; $i -le $N; $i++) {
    $sortie = & node $Test | Out-String
    if ($LASTEXITCODE -ne 0) { $echecs++; Write-Output "essai $i : ECHEC"; Write-Output (($sortie -split "`n" | Select-String '❌') -join "`n") }
}
Write-Output "repetitions: $N, echecs: $echecs"
