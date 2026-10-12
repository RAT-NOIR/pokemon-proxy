// ============================================================
// RETIRER LES 6 PAGES D'HOMONYMIE DES SETS — liste fermée, un seul champ touché : `cartes.sets` (R4, 2026-10-12)
// ============================================================
//   node retirer-homonymies-des-sets.js [--annonce=<fichier.json>]     (MESURE, par défaut : rien n'est écrit ; --annonce écrit le fichier)
//   node lot-additif.js --quoi="retrait de 6 pages d'homonymie des sets (R4)" --collections=cartes \
//        --annonce=collecte-cartes/rapports/annonce-homonymies-des-sets.json -- node retirer-homonymies-des-sets.js --ecrire
//
// DÉCISION DU TESTEUR (2026-10-12) : « Les 6 pages d'homonymie : RETIRE-les des sets, sous la garde, avec un test qui les empêche de
// redevenir des cartes. » (le test : test-page-de-carte.js ; la cause fermée : collecte-cartes/page-de-carte.js, appelé par collecteur-texte.js).
// Ruling du coordinateur : seul `cartes.sets` change. `nomFr` et `idMetacards` (3 de ces pages) ne bougent pas.
// LISTE FERMÉE : 6 `_id`, 12 appartenances, 9 sets. L'outil REFUSE (et n'écrit rien du tout) si, pour une seule des 6 :
//   · la carte est introuvable, ou son titre Bulbapedia n'est pas celui de la liste ;
//   · elle porte un nomEn, une impression, ou une ligne de cartes_produits (ce n'est alors plus une page d'homonymie sans emploi) ;
//   · `sets` contient un set HORS de sa liste (on ne retire que ce qui est listé, et on ne devine pas le reste) ;
//   · la page archivée sur R2 n'est plus une page d'homonymie (la PRÉMISSE du feu vert se rejoue avant d'écrire, §77).
// Une reprise (une partie des sets déjà retirée) est acceptée : seuls les sets restants de la liste sont retirés.
// L'annonce est calculée par compterEtat, la fonction même de la garde de lot (collecte-cartes/garde-lot.js) : elle ne peut pas
// diverger de ce qu'elle juge. Les sets à revalider sont imprimés ; lot-additif.js les revalide lui-même (comparaison des documents).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { estPageDHomonymie } = require('./collecte-cartes/page-de-carte');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const f = (id, titre, ...sets) => Object.freeze({ id, titre, sets: Object.freeze(sets) });
const CIBLES = Object.freeze([
    f(23486, 'Darkness Energy (TCG)', 'M-Master-Deck-Build-Box-Speed-Style', 'M-Master-Deck-Build-Box-Power-Style'),
    f(23489, 'Metal Energy (TCG)', 'M-Master-Deck-Build-Box-Speed-Style', 'M-Master-Deck-Build-Box-Power-Style'),
    f(282531, 'Pikachu (SV-P Promo 1)', 'Scarlet-Violet-Promos', 'Scarlet-Violet-Simplified-Chinese-Promos'),
    f(294565, 'Pikachu (SV-P Promo 120)', 'Scarlet-Violet-Promos', 'Scarlet-Violet-Indonesian-Promos'),
    f(262602, 'Eevee (S-P Promo 23)', 'Sword-Shield-Simplified-Chinese-Promos', 'Sword-Shield-Thai-Promos'),
    f(350467, 'Clefairy (M-P Promo 60)', 'M-P-Thai-Promos', 'M-P-Indonesian-Promos')
]);
const FICHIER_ANNONCE = path.join('collecte-cartes', 'rapports', 'annonce-homonymies-des-sets.json');

/**
 * @param {object} cible une entrée de CIBLES
 * @param {{carte: object|null, lignes: number, texte: string|null}} etat ce que la base et l'archive disent
 * @returns {{refus: string|null, aRetirer: string[], dejaFait: number}}
 */
function planifier(cible, { carte, lignes, texte }) {
    const non = refus => ({ refus: `carte ${cible.id} : ${refus}`, aRetirer: [], dejaFait: 0 });
    if (!carte) return non('introuvable en base');
    if (carte.bulba?.titre !== cible.titre) return non(`titre « ${carte.bulba?.titre} » au lieu de « ${cible.titre} »`);
    if (carte.nomEn) return non(`porte un nomEn (« ${carte.nomEn} ») : ce n'est plus une page sans nom`);
    if ((carte.impressions || []).length) return non(`porte ${carte.impressions.length} impression(s) : ce n'est plus une page sans emploi`);
    if (lignes) return non(`${lignes} ligne(s) de cartes_produits la désignent (produit joint)`);
    const hors = (carte.sets || []).filter(s => !cible.sets.includes(s));
    if (hors.length) return non(`sets hors liste : ${hors.join(', ')} (on ne retire que ce qui est listé)`);
    if (typeof texte !== 'string') return non('page archivée illisible (la prémisse « homonymie » ne se rejoue pas)');
    if (!estPageDHomonymie(texte)) return non('la page archivée ne porte plus de gabarit d\'homonymie (la prémisse du feu vert ne tient plus)');
    const presents = cible.sets.filter(s => (carte.sets || []).includes(s));
    return { refus: null, aRetirer: presents, dejaFait: cible.sets.length - presents.length };
}

/** L'annonce de la garde : `cartes set:<slug>` −n, comptée par compterEtat sur les cartes avant / après le retrait de la liste. */
function annonceDe(cartes) {
    const cible = new Map(CIBLES.map(c => [c.id, c.sets]));
    const apres = cartes.map(c => ({ ...c, sets: (c.sets || []).filter(s => !(cible.get(c._id) || []).includes(s)) }));
    const { baisses } = comparer(compterEtat({ cartes }), compterEtat({ cartes: apres }));
    return Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
}
const setsARevalider = () => [...new Set(CIBLES.flatMap(c => c.sets))].sort();

/** L'écriture : un `$pull` de sets listés, gardé par « aucune impression » ; rien d'autre. @returns {Promise<number>} documents modifiés */
async function appliquer(db, cible, aRetirer) {
    if (!aRetirer.length) return 0;
    const r = await db.collection('cartes').updateOne({ _id: cible.id, 'impressions.0': { $exists: false } }, { $pull: { sets: { $in: aRetirer } } });
    return r.modifiedCount;
}

/** Relecture APRÈS écriture, comparée à l'ATTENDU (sets vide, et — si `avant` est donné — tous les autres champs inchangés). @returns {string[]} les écarts */
function verifierRelu(cible, relu, avant = null) {
    if (!relu) return [`carte ${cible.id} introuvable à la relecture`];
    const ecarts = [];
    const restes = (relu.sets || []).filter(s => cible.sets.includes(s));
    if (restes.length) ecarts.push(`sets encore présents : ${restes.join(', ')}`);
    if (avant) {
        const sans = c => JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'sets').sort(([a], [b]) => a.localeCompare(b))));
        if (sans(relu) !== sans(avant)) ecarts.push('un autre champ que `sets` a changé');
    }
    return ecarts;
}

module.exports = { CIBLES, planifier, annonceDe, setsARevalider, appliquer, verifierRelu, FICHIER_ANNONCE };

if (require.main === module) (async () => {
    const AUTORISES = [/^--ecrire$/, /^--annonce=.+\.json$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --annonce=<fichier.json>, --ecrire`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire');
    const fichierAnnonce = process.argv.find(a => a.startsWith('--annonce='))?.slice(10);
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const r2 = require('./collecte-cartes/r2');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_BRUT'] });
    let code = 0;
    try {
        await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
        const plans = [];
        for (const cible of CIBLES) {
            const carte = await cx.db.collection('cartes').findOne({ _id: cible.id });
            const lignes = await cx.db.collection('cartes_produits').countDocuments({ carteId: cible.id });
            const texte = carte?.bulba?.cleR2 ? await r2.lireTexte(process.env.R2_BUCKET_BRUT, carte.bulba.cleR2).catch(() => null) : null;
            const p = planifier(cible, { carte, lignes, texte });
            plans.push({ cible, carte, p });
            if (p.refus) { console.log(`   🔴 REFUS — ${p.refus}`); code = 1; continue; }
            console.log(`   ${cible.id} « ${cible.titre} » : sets à retirer ${p.aRetirer.length}/${cible.sets.length}${p.dejaFait ? ` (${p.dejaFait} déjà retiré(s))` : ''} : ${p.aRetirer.join(', ') || '—'}`);
        }
        const attendues = CIBLES.reduce((a, c) => a + c.sets.length, 0), presentes = plans.reduce((a, x) => a + x.p.aRetirer.length, 0);
        console.log(`   dénominateur : ${CIBLES.length} cibles, ${plans.filter(x => x.carte).length} trouvées, ${plans.filter(x => x.p.refus).length} refusée(s) · appartenances : ${attendues} listées, ${presentes} présentes, ${plans.reduce((a, x) => a + x.p.dejaFait, 0)} déjà retirées`);
        if (code) { console.log('   rien n\'est écrit : un refus arrête tout.'); process.exitCode = code; return; }
        const annonce = annonceDe(plans.map(x => x.carte));
        // l'annonce porte sur l'état ACTUEL : si une reprise a déjà retiré des sets, on n'annonce que ce qui reste (compterEtat sur les cartes lues)
        console.log(`   annonce de la garde (--annonce=) : ${JSON.stringify(annonce)}`);
        console.log(`   sets à revalider (${setsARevalider().length}) : ${setsARevalider().join(' · ')}`);
        if (fichierAnnonce) { fs.mkdirSync(path.dirname(path.resolve(fichierAnnonce)), { recursive: true }); fs.writeFileSync(path.resolve(fichierAnnonce), JSON.stringify(annonce, null, 1)); console.log(`   annonce écrite : ${fichierAnnonce}`); }
        if (!ECRIRE) { console.log('   (mesure — rien n\'est écrit ; voir l\'en-tête pour la commande lot-additif.js)'); return; }
        for (const { cible, carte, p } of plans) {
            const n = await appliquer(cx.db, cible, p.aRetirer);
            const relu = await cx.db.collection('cartes').findOne({ _id: cible.id });
            const ecarts = verifierRelu(cible, relu, carte);
            const attendu = p.aRetirer.length ? 1 : 0;
            console.log(`   ${ecarts.length || n !== attendu ? '🔴' : '✅'} ${cible.id} : modifiée ${n} (attendu ${attendu}) · relu : ${ecarts.length ? ecarts.join(' ; ') : 'conforme'}`);
            if (ecarts.length || n !== attendu) code = 1;
        }
        process.exitCode = code;
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exit(1); });
