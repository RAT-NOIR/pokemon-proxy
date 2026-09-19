// ============================================================
// RAPATRIER LE NOM FRANÇAIS DE CARDMARKET DANS `cartes` — le site n'affiche que l'anglais et le japonais
// ============================================================
//   node rapatrier-noms-fr.js               (mesure seule, c'est le défaut)
//   node rapatrier-noms-fr.js --ecrire
//   node rapatrier-noms-fr.js --parentheses (ce que les noms portent entre parenthèses, avant de décider)
//
// 🔴 LA SOURCE EST CARDMARKET, PAS BULBAPEDIA. `numeros_cartes.nomFr` du cluster de PRODUCTION vient de
// Cardmarket. Les traductions de Bulbapedia sont sous licence NON COMMERCIALE et n'ont rien à faire ici :
// ce fichier ne lit AUCUNE page Bulbapedia, et il écrit `nomFrSource: 'cardmarket'` à côté de chaque nom
// pour qu'on n'ait jamais à se demander d'où il vient.
//
// TROIS RÈGLES, dans l'ordre où elles s'appliquent :
//   1. LE NOM SEUL. Cardmarket suffixe ses produits (« (V.2) », « Holo », « (Theme Deck) », le numéro).
//      Un nom d'affichage ne porte pas la variante d'un produit parmi plusieurs.
//   2. 🔑 UNE CARTE PORTE PLUSIEURS PRODUITS. Si leurs noms divergent, on écrit `null` — jamais l'un des
//      deux, jamais le plus fréquent. Un nom faux affiché sans mention est pire qu'un nom absent, et la
//      divergence est le SEUL signe qu'on a que quelque chose ne va pas : on la compte, on ne la lisse pas.
//   3. LES ACCENTS DÉPARTAGENT CE QUE LA CASSE NE SÉPARE PAS. « Elektek » et « Élektek » sont le même nom
//      mal saisi deux fois, pas deux noms : on garde la forme ACCENTUÉE, et ça ne compte pas comme conflit.
//
// ⚠️ CE QUE L'OUTIL NE FAIT PAS : il ne traduit rien, il ne devine rien, et il ne touche pas aux cartes
// dont aucun produit ne porte de nom français — elles restent sans `nomFr` plutôt que de recevoir `null`,
// pour que `null` garde son sens de « ses produits se contredisent ».
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');

// Les suffixes que Cardmarket colle au nom du PRODUIT. Chacun désigne un tirage parmi plusieurs,
// aucun ne fait partie du nom de la carte.
//
// ⚠️ LA LISTE N'A PAS ÉTÉ DEVINÉE, ELLE A ÉTÉ ÉNUMÉRÉE (--parentheses) : 457 noms sur 68 231 portent une
// parenthèse finale, 437 libellés DISTINCTS, et pas un seul n'est un nom de carte — ce sont des coffrets
// (« (Pikachu V Box) », « (EX Power Tins: Keldeo-EX Tin) », « (Theme Deck) »). Une liste de motifs aurait
// raté 430 d'entre eux en silence ; on retire donc TOUTE parenthèse finale, ce que l'énumération autorise.
const PARENTHESE = /\s*\([^)]*\)\s*$/;
// 🔴 « Lv.10 » CHIFFRÉ EST UN SUFFIXE, « LV.X » EST UNE CARTE. Cardmarket écrit « Salamèche Lv.10 » là où
// la carte s'appelle « Salamèche » — le niveau est imprimé sur la carte, il n'est pas son nom. Mais
// « Dialga LV.X » est un TYPE de carte, réellement distinct de Dialga : le motif exige des CHIFFRES, et
// le X y échappe par construction. Sans cette distinction, 68 conflits disparaissaient en fusionnant
// deux cartes différentes — exactement ce qu'un nettoyage de nom ne doit jamais faire.
const NIVEAU = /\s*Lv\.?\s?\d+\s*$/i;
const nomSeul = s => {
    let t = String(s || '').trim();
    for (let i = 0; i < 3 && PARENTHESE.test(t); i++) t = t.replace(PARENTHESE, '').trim();   // « X (Holo) (V.2) »
    return t.replace(NIVEAU, '').replace(/\s*-\s*(?:Holo|Reverse Holo)\s*$/i, '').trim();
};
// la clé de comparaison : accents, casse et ponctuation retirés. « Mélo » = « Melo ».
const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const accents = s => (String(s).normalize('NFD').match(/[̀-ͯ]/g) || []).length;

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions();
    const M = modeles(cx);
    const NC = prod.db.collection('numeros_cartes');

    const produits = await NC.find({}, { projection: { idProduct: 1, nomFr: 1, slugSet: 1 } }).toArray();
    const avecFr = produits.filter(p => p.nomFr && String(p.nomFr).trim());
    console.log(`\n════ SOURCE : ${produits.length} produits Cardmarket · ${avecFr.length} portent un nomFr (${(avecFr.length / produits.length * 100).toFixed(1)} %) ════`);

    if (process.argv.includes('--parentheses')) {
        const par = {};
        for (const p of avecFr) { const m = String(p.nomFr).match(/\(([^)]*)\)\s*$/); if (m) par[m[1]] = (par[m[1]] || 0) + 1; }
        const tot = Object.values(par).reduce((a, b) => a + b, 0);
        console.log(`   ${tot} noms portent une parenthèse finale, ${Object.keys(par).length} libellés distincts :`);
        for (const [k, v] of Object.entries(par).sort((a, b) => b[1] - a[1]).slice(0, 40))
            console.log(`      ${String(v).padStart(5)} — « (${k}) »`);
        const niv = {};
        for (const p of avecFr) { const m = String(p.nomFr).match(/\bLv\.?\s?([0-9X]+)\s*$/i); if (m) niv[m[1].toUpperCase()] = (niv[m[1].toUpperCase()] || 0) + 1; }
        console.log(`\n   et les « Lv. » finaux : ${Object.values(niv).reduce((a, b) => a + b, 0)} noms`);
        for (const [k, v] of Object.entries(niv).sort((a, b) => b[1] - a[1]).slice(0, 12))
            console.log(`      ${String(v).padStart(5)} — « Lv.${k} » ${k === 'X' ? '← GARDÉ : « LV.X » est une carte, pas un suffixe' : '← retiré'}`);
        await fermer(); return;
    }

    const frDuProduit = new Map(avecFr.map(p => [p.idProduct, nomSeul(p.nomFr)]));
    const liens = await cx.db.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1 } }).toArray();

    // par CARTE : toutes les formes vues, comptées
    const parCarte = new Map();
    for (const l of liens) {
        const fr = frDuProduit.get(l.idProduct);
        if (!fr) continue;
        const e = parCarte.get(l.carteId) || (parCarte.set(l.carteId, new Map()), parCarte.get(l.carteId));
        const k = cle(fr);
        const g = e.get(k) || (e.set(k, { formes: new Map(), n: 0 }), e.get(k));
        g.formes.set(fr, (g.formes.get(fr) || 0) + 1); g.n++;
    }

    const aEcrire = [];
    let conflits = 0, accentues = 0;
    const exemplesConflit = [], exemplesNom = [];
    for (const [carteId, groupes] of parCarte) {
        if (groupes.size > 1) {
            conflits++;
            if (exemplesConflit.length < 10) exemplesConflit.push(`carte ${carteId} : ${[...groupes.values()].map(g => `« ${[...g.formes.keys()][0]} »`).join(' ≠ ')}`);
            aEcrire.push({ carteId, nomFr: null });
            continue;
        }
        const g = [...groupes.values()][0];
        // même nom aux accents près : on garde la forme la PLUS ACCENTUÉE, puis la plus fréquente
        const formes = [...g.formes].sort((a, b) => (accents(b[0]) - accents(a[0])) || (b[1] - a[1]));
        if (formes.length > 1) accentues++;
        aEcrire.push({ carteId, nomFr: formes[0][0] });
        if (exemplesNom.length < 12) exemplesNom.push(`carte ${carteId} : « ${formes[0][0] }»${formes.length > 1 ? `  (${formes.length} graphies : ${formes.map(f => `« ${f[0]} »×${f[1]}`).join(', ')})` : ''}`);
    }
    const nommees = aEcrire.filter(x => x.nomFr).length;
    const totalCartes = await M.Carte.countDocuments({});

    console.log(`\n════ DÉNOMINATEUR : ${totalCartes} cartes en base · ${parCarte.size} portent au moins un produit à nomFr ════`);
    console.log(`   ✅ nom français ÉCRIT      : ${nommees} (${(nommees / parCarte.size * 100).toFixed(1)} % des cartes traitées, ${(nommees / totalCartes * 100).toFixed(1)} % de la base)`);
    console.log(`   🔴 CONFLIT entre produits -> null : ${conflits} (${(conflits / parCarte.size * 100).toFixed(1)} %)`);
    console.log(`      dont ${accentues} cartes où deux graphies ne différaient QUE par les accents — départagées, pas comptées en conflit`);
    console.log(`   (les ${totalCartes - parCarte.size} cartes sans aucun produit à nomFr ne sont PAS touchées : \`null\` doit garder son sens)`);
    // DE QUOI LES CONFLITS SONT-ILS FAITS ? — un compte de conflits ne dit pas ce qu'ils contiennent (§22).
    // Chacun a une cause, et elles ne se réparent pas de la même façon : « de base » est un renommage
    // Cardmarket, l'anglais recopié est un produit non traduit, et un NOM DIFFÉRENT est une jointure
    // fausse — la seule des trois qui ne soit pas un problème de libellé.
    const enConflit = aEcrire.filter(x => x.nomFr === null).map(x => x.carteId);
    const nomEnDe = new Map((await cx.db.collection('cartes').find({ _id: { $in: enConflit } }, { projection: { nomEn: 1 } }).toArray()).map(c => [c._id, c.nomEn]));
    const motifs = {};
    for (const id of enConflit) {
        const noms = [...parCarte.get(id).values()].map(g => [...g.formes.keys()][0]);
        const en = cle(nomEnDe.get(id));
        const m = noms.some(n => /\bde base\b/i.test(n)) ? '« de base » ajouté par Cardmarket sur les énergies'
            : (en && noms.some(n => cle(n) === en)) ? 'un produit a gardé le nom ANGLAIS'
                : 'noms réellement différents — à ouvrir, c\'est peut-être une jointure fausse';
        motifs[m] = (motifs[m] || 0) + 1;
    }
    console.log(`\n   les ${conflits} conflits, par cause :`);
    for (const [k, v] of Object.entries(motifs).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(4)} — ${k}`);
    console.log(`\n   dix conflits, tels quels :`);
    for (const x of exemplesConflit) console.log(`      ${x}`);
    console.log(`\n   douze noms retenus :`);
    for (const x of exemplesNom) console.log(`      ${x}`);

    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --ecrire pour écrire)`); await fermer(); return; }

    const le = new Date();
    let n = 0;
    for (let i = 0; i < aEcrire.length; i += 500) {
        const lot = aEcrire.slice(i, i + 500);
        await cx.db.collection('cartes').bulkWrite(lot.map(x => ({
            updateOne: { filter: { _id: x.carteId }, update: { $set: { nomFr: x.nomFr, nomFrSource: 'cardmarket', nomFrLe: le } } }
        })), { ordered: false });
        n += lot.length;
        if (i % 5000 === 0) process.stdout.write(`   ${n}/${aEcrire.length}\r`);
    }
    const relu = await cx.db.collection('cartes').countDocuments({ nomFr: { $type: 'string' } });
    const reluNull = await cx.db.collection('cartes').countDocuments({ nomFrSource: 'cardmarket', nomFr: null });
    console.log(`\n   ÉCRIT : ${n} cartes touchées · relu en base : ${relu} avec un nom, ${reluNull} à null`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
