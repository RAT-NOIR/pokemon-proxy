// ============================================================
// REJEU de TOUS les sets de la table depuis R2 — ZÉRO requête Bulbapedia
// ============================================================
//   node rejouer-tous-sets.js [--seulement=EXP,PCG9]
//
// Lance `collecteur-texte.js --set=<CODE> --reparser` en séquence, un processus par set. Un rejeu
// ne parle qu'à R2 et à Mongo : la règle « un seul set par lancement » protégeait le DÉBIT
// Bulbapedia, et elle ne s'applique pas ici — ce qui est vérifié à la fin : le total de requêtes
// Bulbapedia doit être 0, et il s'imprime.
//
// Rend, pour les `slug`/`slugSet` ajoutés le 2026-09-12, le compte APPARIÉ demandé : lignes portant
// les deux champs, lignes n'en portant aucune, dénominateur imprimé.

require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');
const { TABLE } = require('./collecte-cartes/table-sets');

const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };

(async () => {
    const seulement = arg('seulement')?.split(',').map(s => s.trim()).filter(Boolean) || null;
    const codes = TABLE.filter(L => L.verifie).map(L => L.code).filter(c => !seulement || seulement.includes(c));
    console.log(`▶️  rejeu de ${codes.length} sets vérifiés : ${codes.join(' ')}\n`);

    const bilan = [];
    for (const [i, code] of codes.entries()) {
        const t0 = Date.now();
        const r = spawnSync(process.execPath, [path.join(__dirname, 'collecteur-texte.js'), `--set=${code}`, '--reparser'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const sortie = (r.stdout || '') + (r.stderr || '');
        const nb = re => { const m = sortie.match(re); return m ? Number(m[1]) : null; };
        const ligne = {
            code, ok: r.status === 0, s: Math.round((Date.now() - t0) / 1000),
            requetes: nb(/requêtes Bulbapedia : (\d+)/),
            lignes: nb(/lignes de jointure \(\w+\)\s*: (\d+)/),
            avecSlug: nb(/portant slug ET slugSet : (\d+)/),
            sansSlug: nb(/n'en portant AUCUN : (\d+)/),
            nonRendues: nb(/NON RENDUES : (\d+)/),
            aGabarit: nb(/champ à « \{\{ \}\} » : (\d+)/),
            ecartes: nb(/titre\(s\) non archivés sont ÉCARTÉS/) === null ? nb(/--reparser : (\d+) titre\(s\) non archivés/) : null
        };
        bilan.push(ligne);
        const etat = ligne.ok ? '✅' : '❌';
        console.log(`${etat} ${String(i + 1).padStart(2)}/${codes.length} ${code.padEnd(6)} ${ligne.s}s · ${ligne.lignes ?? '—'} lignes · slug ${ligne.avecSlug ?? '—'} / sans ${ligne.sansSlug ?? '—'} · non rendues ${ligne.nonRendues ?? '—'} · req ${ligne.requetes ?? '—'}`);
        if (!ligne.ok) console.log(sortie.split('\n').slice(-12).join('\n'));
    }

    const somme = k => bilan.reduce((a, b) => a + (b[k] || 0), 0);
    console.log(`\n════ BILAN DU REJEU — dénominateur : ${bilan.length} sets, ${somme('lignes')} lignes de jointure (tirage principal) ════`);
    console.log(`   sets rejoués sans erreur      : ${bilan.filter(b => b.ok).length} / ${bilan.length}`);
    console.log(`   requêtes Bulbapedia (doit être 0) : ${somme('requetes')}`);
    console.log(`   lignes portant slug ET slugSet : ${somme('avecSlug')}`);
    console.log(`   lignes n'en portant AUCUN      : ${somme('sansSlug')}`);
    console.log(`   cartes à gabarit non développé : ${somme('aGabarit')}`);
    console.log(`   entrées d'impression non rendues : ${somme('nonRendues')}`);
    const rates = bilan.filter(b => !b.ok).map(b => b.code);
    if (rates.length) console.log(`   ❌ sets en erreur : ${rates.join(' ')}`);
})().catch(e => { console.error(e); process.exit(1); });
