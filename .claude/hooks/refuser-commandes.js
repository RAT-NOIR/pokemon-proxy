// Hook PreToolUse (PowerShell, Bash) : REFUSE toute commande qui lit ou écrit un fichier par le shell, ou qui exécute du code en ligne.
// Consigne du testeur (2026-10-08) : « Plus jamais de Get-Content, Out-File, python -c ni node -e. » Les fichiers se lisent avec
// l'outil Read, s'écrivent avec Write/Edit, et un script s'écrit dans un fichier avant de se lancer.
// Code 2 = refus : le message part sur stderr et revient à l'agent. Une entrée illisible REFUSE aussi (une garde qui ne peut pas
// conclure bloque et le dit) — sauf un outil hors périmètre, qui passe.
const MOTIFS = [
    { re: /\bGet-Content\b/i, nom: 'Get-Content' },
    { re: /(^|[;|&({]\s*)(gc|cat|type)\s/i, nom: 'alias de Get-Content (gc, cat, type)' },
    { re: /\bOut-File\b/i, nom: 'Out-File' },
    { re: /\b(python3?|py)(\.exe)?\s+(-[A-Za-z]*\s+)*-c\b/i, nom: 'python -c' },
    { re: /\bnode(\.exe)?\s+(--?[A-Za-z-]+\s+)*(-e|--eval|-p|--print)\b/i, nom: 'node -e / -p' },
];

function verdict(entree) {
    let e;
    try { e = JSON.parse(entree); } catch { return { refus: 'entrée du hook illisible (JSON attendu) : refusé par prudence' }; }
    const outil = e && e.tool_name;
    if (outil !== 'PowerShell' && outil !== 'Bash') return { refus: null };
    const cmd = e.tool_input && typeof e.tool_input.command === 'string' ? e.tool_input.command : null;
    if (cmd === null) return { refus: `commande ${outil} sans texte lisible : refusé par prudence` };
    const touches = MOTIFS.filter(m => m.re.test(cmd)).map(m => m.nom);
    return { refus: touches.length ? `commande refusée par le hook du dépôt : ${touches.join(', ')}. Lire avec l'outil Read, écrire avec Write/Edit, `
        + `et lancer un script écrit dans un fichier (CLAUDE.md §3, consigne du 2026-10-08).` : null };
}

if (require.main === module) {
    // Un hook qui PLANTE sortirait à 1, que Claude Code traite comme non bloquant : tout passerait. Toute erreur refuse (code 2).
    const refuserSurPanne = err => { process.stderr.write(`hook en panne, refusé par prudence : ${err && err.message}\n`); process.exit(2); };
    process.on('uncaughtException', refuserSurPanne);
    process.stdin.on('error', refuserSurPanne);
    let entree = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { entree += d; });
    process.stdin.on('end', () => {
        const v = verdict(entree);
        if (v.refus) { process.stderr.write(v.refus + '\n'); process.exit(2); }
        process.exit(0);
    });
}

module.exports = { verdict, MOTIFS };
