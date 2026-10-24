// ============================================================
// PHASE 3a, D6 — CE QU'UN `collecteur-texte.js --reparser` RÉÉCRIRAIT SUR LES CARTES D'UN SET, comparé à ce qui y est stocké (LECTURE SEULE)
// ============================================================
//   node lancer-a-blanc.js controler-reparse.js --sets=CSV5C,smK --sortie=<fichier>.json
// Le rejeu relit la page archivée de chaque carte sur R2 (BULBAPEDIA) et RÉÉCRIT ses champs (`$set` de collecteur-texte.js l. 315). Or une donnée Bulbapedia ne doit jamais être écrite comme valeur.
// Ce contrôle REJOUE, sans rien écrire, le calcul exact du `$set` — `faitsDeCarte(archive)` (la fonction de production), `impressionCible`, `reporterChampsPoses` (idem) — et le compare, champ par
// champ, aux champs stockés. Le lot ne part QUE si aucun champ de carte ne change (rareté comprise) ; sinon la liste des champs qui changeraient sort ici, carte par carte.
// `reparseLe` change à chaque rejeu par construction (une date) : seul champ exclu, nommé.
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const { champsDuRejeu } = require('./collecte-cartes/champs-du-rejeu');
const { ligne: ligneDeTable } = require('./collecte-cartes/table-sets');
const { canon } = require('./collecte-cartes/garde-contrat-api');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const AUTORISES = [/^--sets=[\w.,/-]+$/, /^--sortie=.+\.json$/, /^--eprouve$/];
// `--eprouve` : EN MÉMOIRE seulement, le nom de la première carte de chaque set est altéré avant la comparaison — l'instrument doit alors DIRE non (une garde se prouve en la faisant crier, §41).
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length || !arg('sets')) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --sets=<code>[,…] [--sortie=<fichier>.json]`); process.exit(2); }
const EXCLUS = new Set(['reparseLe']);

/** Les champs que le rejeu écrirait sur une carte — la MÊME fonction que collecteur-texte.js (--reparser) : collecte-cartes/champs-du-rejeu.js (PHASE 3b : plus de copie de la formule, §21 bis). */
function champsDuRejeuDuSet({ carte, epure, L }) {
    const TIRAGE = L.bulba.tirage || 'jp', nomsCibles = [].concat(L.bulba.expansion);
    const impressionCible = faits => faits.impressions.find(x => x.tirage === TIRAGE && nomsCibles.includes(x.expansion) && (!L.bulba.deck || x.deck === L.bulba.deck));   // collecteur-texte.js l. 122
    return champsDuRejeu({ carte, epure, impressionCible }).champs;
}

(async () => {
    if (!process.env.R2_BUCKET_BRUT) throw new Error('R2_BUCKET_BRUT absent : l\'archive ne se lit pas');
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_BRUT'], lectureSeule: true });
    try {
        const sortie = { le: new Date().toISOString(), sets: {} };
        for (const code of arg('sets').split(',')) {
            const L = ligneDeTable(code);
            if (!L) throw new Error(`${code} : absent de la table`);
            const slug = L.slugSet || L.code;
            const cartes = await cx.db.collection('cartes').find({ sets: slug }).toArray();
            if (!cartes.length) throw new Error(`${code} (${slug}) : aucune carte dans le set — un contrôle sur du vide ne mesure rien (§41)`);
            const avecPage = cartes.filter(c => c.bulba?.cleR2);
            const differences = [], parChamp = {}; let identiques = 0, illisibles = 0;
            for (let c of avecPage) {
                // PHASE 3b : l'épreuve altère `nomEn` (que le rejeu réécrit TOUJOURS depuis la page) et non plus `rarete` : depuis qu'un rejeu garde la rareté en base quand la page n'en donne pas, une rareté
                // altérée en mémoire aurait été « gardée » et l'épreuve serait restée muette (exit 0) — une garde qui ne sait plus dire non (§41)
                if (process.argv.includes('--eprouve') && c === avecPage[0]) c = { ...c, nomEn: '#épreuve-altérée-en-mémoire#' };
                let epure;
                try { epure = await r2.lireTexte(process.env.R2_BUCKET_BRUT, c.bulba.cleR2); } catch (e) { illisibles++; differences.push({ carteId: c._id, nomEn: c.nomEn, champ: '(archive illisible)', stocke: null, rejeu: String(e.message).slice(0, 80) }); continue; }
                const ecrit = champsDuRejeuDuSet({ carte: c, epure, L });
                const diff = Object.keys(ecrit).filter(k => !EXCLUS.has(k) && canon(ecrit[k]) !== canon(c[k]));
                if (!diff.length) { identiques++; continue; }
                for (const k of diff) { parChamp[k] = (parChamp[k] || 0) + 1; differences.push({ carteId: c._id, nomEn: c.nomEn, champ: k, stocke: c[k] === undefined ? '(absent)' : c[k], rejeu: ecrit[k] }); }
            }
            sortie.sets[code] = { slug, cartes: cartes.length, sansPageArchivee: cartes.length - avecPage.length, rejouees: avecPage.length, identiques, illisibles, cartesQuiChangeraient: new Set(differences.map(d => d.carteId)).size, parChamp, differences };
            console.log(`■ ${code} (${slug}) : ${cartes.length} cartes dont ${avecPage.length} à page archivée (${cartes.length - avecPage.length} fiches simples, sautées par le rejeu) · IDENTIQUES ${identiques} · qui changeraient ${sortie.sets[code].cartesQuiChangeraient} · archives illisibles ${illisibles}`);
            if (Object.keys(parChamp).length) console.log(`   champs qui changeraient : ${JSON.stringify(parChamp)}`);
            for (const d of differences.slice(0, 12)) console.log(`   · ${d.carteId} « ${d.nomEn} » ${d.champ} : stocké ${JSON.stringify(d.stocke)?.slice(0, 90)} → rejeu ${JSON.stringify(d.rejeu)?.slice(0, 90)}`);
        }
        const total = Object.values(sortie.sets).reduce((t, s) => t + s.cartesQuiChangeraient + s.illisibles, 0);
        sortie.verdict = total === 0 ? 'AUCUN champ de carte ne change : le lot peut partir' : `${total} carte(s) changeraient ou sont illisibles : le lot reste EN ATTENTE`;
        console.log(`\n   ${sortie.verdict} · cartes rejouées au total : ${Object.values(sortie.sets).reduce((t, s) => t + s.rejouees, 0)}`);
        if (arg('sortie')) fs.writeFileSync(arg('sortie'), JSON.stringify(sortie, null, 1));
        process.exitCode = total === 0 ? 0 : 3;
    } finally { await fermer(); }
})().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
