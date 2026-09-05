// ============================================================================
// ⚠️⚠️ DISCIPLINE DES OUTILS DE MESURE — LIRE AVANT D'AJOUTER UNE LIGNE
// ============================================================================
// Le catalogue des erreurs d'instrument (septième principe, scoring.js) — sans le compter
// ici : un nombre recopié redevient faux au prochain ajout. Deux
// familles : FABRIQUER une entrée que le système n'a jamais produite, et LIRE UNE ABSENCE
// COMME UNE VALEUR CONTRAIRE. Règles appliquées ici :
//   1. ON APPELLE LA CHAÎNE, ON NE LA RÉIMPLÉMENTE PAS. Le vivier vient de
//      `trouverProduitsLocaux`, les scores de `scorerCandidatsLocal`, l'égalité de
//      `sontExAequo`. Aucune regex de nom, aucun seuil maison.
//   2. TOUT CE QUI EST ÉCARTÉ EST COMPTÉ ET NOMMÉ. Un échantillon qui rétrécit en
//      silence est le défaut qu'on traque depuis le début.
//   3. LES DIVERGENCES AVEC LA PRODUCTION SONT DÉCLARÉES EN TÊTE DE SORTIE, pas
//      découvertes après coup.
// LECTURE SEULE : aucune écriture, aucun réseau, aucune installation.
//
// ============================================================================
// CE QUE CET OUTIL MESURE : la clôture sur les EX AEQUO plutôt que sur le vivier
// ============================================================================
// Une ligne d'échec n'est mesurable par l'embedding que si TOUS ses concurrents ont un
// vecteur. Mais lesquels sont vraiment « ses concurrents » ?
//   - VIVIER ENTIER  : tous les candidats retenus. C'est ce que j'avais mesuré, et ça
//                      exige 22 sets et 1588 produits pour clore les 29 lignes.
//   - EX AEQUO SEULS : les seuls que le scoring N'A PAS SU SÉPARER. C'est eux, et eux
//                      seuls, que l'embedding doit départager — les autres, le scoring
//                      les a déjà écartés, et un vecteur ne changerait rien pour eux.
// Si le second périmètre est nettement plus petit, la collecte devient possible.
//
// USAGE : node mesure-cloture-exaequo.js --base=<nom>
process.env.MONGODB_BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1] || '';
if (!process.env.MONGODB_BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
require('dotenv').config();
const mongoose = require('mongoose');
const SCORING = require('./scoring');
const { sontExAequo } = SCORING;
const { EXPANSIONS_VINTAGE, SETS_VINTAGE_JAPONAIS, setCodeCompatibleVintage } = require('./sets-vintage-japonais');
const { trouverProduitsLocaux, scorerCandidatsLocal, lireCodeSets } = require('./index');

const codeParExp = new Map(SETS_VINTAGE_JAPONAIS.filter(s => s.exp != null).map(s => [s.exp, s.code]));
const prodParCode = new Map(SETS_VINTAGE_JAPONAIS.map(s => [s.code, s.prod]));
const ASIAT = ['JP', 'ZH', 'KR'];

// Couverture gloutonne : le plus petit ensemble de sets qui CLÔT le plus de lignes.
// Une ligne est CLOSE quand tous ses sets vintage sont pris. Les candidats hors des 24
// sets sont supposés couverts par TCGdex — hypothèse DÉCLARÉE, non vérifiée set par set.
function glouton(lignes, etiquette) {
    console.log('\n' + '═'.repeat(84));
    console.log(`COUVERTURE GLOUTONNE — ${etiquette}`);
    console.log('═'.repeat(84));
    const choisis = new Set();
    const closes = () => lignes.filter(x => [...x.sets].every(k => choisis.has(k))).length;
    console.log(`   ${'étape'.padEnd(6)} ${'set'.padEnd(8)} ${'produits'.padStart(8)} ${'cumul'.padStart(7)} ${'CLOSES'.padStart(7)} ${'partielles'.padStart(11)}`);
    console.log(`   ${'0'.padEnd(6)} ${'—'.padEnd(8)} ${'—'.padStart(8)} ${'0'.padStart(7)} ${String(closes()).padStart(7)} ${String(lignes.length - closes()).padStart(11)}   (lignes closes sans rien collecter)`);
    let cumul = 0, etape = 0;
    const trace = [];
    while (closes() < lignes.length && etape < 30) {
        const restantes = lignes.filter(x => ![...x.sets].every(k => choisis.has(k)));
        const cands = new Set(restantes.flatMap(x => [...x.sets]).filter(c => !choisis.has(c)));
        if (!cands.size) break;
        let meilleur = null, gain = -1, cout = Infinity;
        for (const c of cands) {
            const test = new Set([...choisis, c]);
            const g = lignes.filter(x => [...x.sets].every(k => test.has(k))).length;
            const p = prodParCode.get(c) ?? 9999;
            if (g > gain || (g === gain && p < cout)) { meilleur = c; gain = g; cout = p; }
        }
        choisis.add(meilleur);
        cumul += prodParCode.get(meilleur) ?? 0;
        etape++;
        trace.push({ etape, set: meilleur, cumul, closes: closes() });
        console.log(`   ${String(etape).padEnd(6)} ${meilleur.padEnd(8)} ${String(prodParCode.get(meilleur) ?? '?').padStart(8)} ${String(cumul).padStart(7)} ${String(closes()).padStart(7)} ${String(lignes.length - closes()).padStart(11)}`);
    }
    return trace;
}

(async () => {
    for (let i = 0; i < 60 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 500));
    if (mongoose.connection.readyState !== 1) { console.error('❌ Mongo non connecté.'); process.exit(1); }
    if (mongoose.connection.db.databaseName !== process.env.MONGODB_BASE) { console.error('❌ mauvaise base.'); process.exit(1); }
    const J = mongoose.connection.db.collection('journal_scans');

    console.log('⚠️ DIVERGENCES DÉCLARÉES AVEC LA PRODUCTION, à lire avant les chiffres :');
    console.log('   - `expansionsAttendues` est passé VIDE. En production il vient de');
    console.log('     `trouvaille.id`, absent des lignes de refus. Sur ces cartes il était');
    console.log('     très probablement vide aussi (c\'est ce qui déclenche le périmètre),');
    console.log('     mais ce n\'est PAS vérifié ligne par ligne.');
    console.log('   - `photos[0]` est passé null : le scoring ne s\'en sert plus (comparaison');
    console.log('     d\'images retirée), donc sans effet — vérifié dans scorerCandidatsLocal.');
    console.log('   - `numeroBrutPourScoring` est passé comme en production (lot B retenu).\n');

    const refus = (await J.find({ route: 'identifier', motifEchec: { $ne: null } }).sort({ le: 1 }).toArray())
        .filter(l => ASIAT.includes(String(l.langue || '').toUpperCase()) && l.nom);
    console.log(`refus asiatiques nommés : ${refus.length}\n`);

    const ecartees = [];
    const parVivier = [], parExAequo = [];
    console.log('═'.repeat(84));
    console.log('LIGNE PAR LIGNE — vivier retenu, puis groupe d\'ÉGALITÉ au sommet');
    console.log('═'.repeat(84));

    for (const l of refus) {
        const vivier = await trouverProduitsLocaux(l.nom);
        if (!vivier.length) { ecartees.push({ l, raison: 'vivier par le nom VIDE' }); continue; }

        // Périmètre vintage, comme en production : il ne s'applique que s'il garde quelque chose.
        const compat = setCodeCompatibleVintage(l.setCode, SCORING);
        const dedans = vivier.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
        const effectif = (compat.compatible && dedans.length) ? dedans : vivier;

        // ⚠️ LE SCORING RÉEL. `cardInfoEffectif` : le numéro neutralisé quand la règle du
        // Pokédex a tiré — sinon on scorerait sur un numéro que la production n'utilisait pas.
        const estDexLigne = l.estDex === true || (l.numero != null && l.total == null);
        const cardInfo = {
            name: l.nom, number: estDexLigne ? null : l.numero, total: l.total,
            setCode: l.setCode, language: l.langue, rarete: l.rarete, rareteElevee: false
        };
        let r;
        try {
            const cs = await lireCodeSets(effectif.map(p => p.idExpansion));
            r = await scorerCandidatsLocal(effectif, cardInfo, null, [], cs, { numeroBrutPourScoring: l.numero });
        } catch (e) { ecartees.push({ l, raison: `scoring en erreur : ${e.message}` }); continue; }
        if (!r.scores?.length) { ecartees.push({ l, raison: 'le scoring ne rend aucun score' }); continue; }

        // LE GROUPE D'ÉGALITÉ AU SOMMET — définition de production, pas une invention.
        const tete = r.scores[0].score;
        const exaequo = r.scores.filter(s => sontExAequo(s.score, tete));

        const setsDe = liste => {
            const s = new Set();
            let hors = 0;
            for (const p of liste) {
                const c = codeParExp.get(Number(p.idExpansion ?? p.candidat?.idExpansion));
                if (c) s.add(c); else hors++;
            }
            return { s, hors };
        };
        const vA = setsDe(effectif);
        const eA = setsDe(exaequo.map(s => s.candidat));

        console.log(`   "${String(l.nom).padEnd(15)}" n°${String(l.numero ?? '—').padEnd(5)} ${String(l.motifEchec).padEnd(18)}` +
            ` vivier=${String(effectif.length).padStart(3)} -> ÉGALITÉ au sommet : ${String(exaequo.length).padStart(2)} (score ${tete})`);
        console.log(`        vivier   : ${[...vA.s].join(', ') || '—'}${vA.hors ? ` +${vA.hors} hors` : ''}`);
        console.log(`        ex aequo : ${[...eA.s].join(', ') || '—'}${eA.hors ? ` +${eA.hors} hors` : ''}`);

        parVivier.push({ nom: l.nom, sets: vA.s, n: effectif.length });
        parExAequo.push({ nom: l.nom, sets: eA.s, n: exaequo.length });
    }

    console.log('\n' + '═'.repeat(84));
    console.log(`ÉCARTÉES — ${ecartees.length} ligne(s), avec leur cause`);
    console.log('═'.repeat(84));
    for (const e of ecartees) console.log(`   "${e.l.nom}" n°${e.l.numero ?? '—'} : ${e.raison}`);
    if (!ecartees.length) console.log('   aucune.');

    const tv = glouton(parVivier, `VIVIER ENTIER — ${parVivier.length} ligne(s)`);
    const te = glouton(parExAequo, `EX AEQUO SEULS — ${parExAequo.length} ligne(s)`);

    console.log('\n' + '═'.repeat(84));
    console.log('LA COMPARAISON QUI DÉCIDE');
    console.log('═'.repeat(84));
    const tailleMoy = a => a.length ? (a.reduce((s, x) => s + x.n, 0) / a.length).toFixed(1) : '—';
    console.log(`   taille moyenne du groupe de concurrents : vivier ${tailleMoy(parVivier)}  ->  ex aequo ${tailleMoy(parExAequo)}`);
    const finV = tv[tv.length - 1], finE = te[te.length - 1];
    console.log(`   pour TOUT clore : vivier ${tv.length} sets / ${finV?.cumul ?? 0} produits` +
        `   ->   ex aequo ${te.length} sets / ${finE?.cumul ?? 0} produits`);
    const seuil = (trace, n) => trace.find(t => t.closes >= n);
    for (const part of [0.5, 0.8]) {
        const nV = Math.ceil(parVivier.length * part), nE = Math.ceil(parExAequo.length * part);
        const a = seuil(tv, nV), b = seuil(te, nE);
        console.log(`   pour clore ${Math.round(part * 100)} % : vivier ${a ? `${a.etape} sets / ${a.cumul} produits` : 'jamais'}` +
            `   ->   ex aequo ${b ? `${b.etape} sets / ${b.cumul} produits` : 'jamais'}`);
    }
    console.log('\n   ⚠️ Le gain ne vaut que si l\'égalité mesurée ici est celle de la production.');
    console.log('      Voir les divergences déclarées en tête : `expansionsAttendues` vide est');
    console.log('      la seule qui puisse déplacer un score, et donc un groupe d\'égalité.');
    await mongoose.connection.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
