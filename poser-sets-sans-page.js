// ============================================================
// POSER `cartes.sets` POUR LA VOIE « SANS PAGE » — la clé que le joint d'images cherche
// ============================================================
//   node poser-sets-sans-page.js            (mesure seule, c'est le défaut)
//   node poser-sets-sans-page.js --ecrire
//
// 🔴 LE DÉFAUT, MESURÉ LE 2026-09-21 : `collecteur-images.js` joint ses images par
// `M.Carte.find({ sets: slug })`. La voie « sans page » — celle qui rattache un produit à une carte
// par le NOM D'EXPANSION déclaré sur la carte, sans page de set ni Setlist — ne pose JAMAIS le slug
// dans ce champ. Résultat : 29 sets dont les cartes existent, déclarent l'expansion, ont une source
// d'images artofpkm DÉCLARÉE, et dont **0 carte** est trouvable par le joint. **670 produits sans
// visuel, et la cause n'est ni la source ni la file : c'est une clé vide.**
//
// 🔴 LA PREMIÈRE VERSION DE CE FICHIER A ÉTÉ REFUSÉE PAR SON PROPRE CONTRÔLE, ET C'EST CE QU'ON
// ATTEND D'UN CONTRÔLE. Le critère essayé était « la carte déclare une impression dont l'expansion
// est celle que nomme la ligne ». Rejoué sur les 494 sets dont `cartes.sets` est DÉJÀ peuplé : il y
// **ajoutait 2 196 appartenances et en ratait 8 484**, et donnait **68 sets à une seule Énergie de
// base**. Il ne décrit donc pas l'appartenance à un set : il décrit « cette carte a été imprimée
// quelque part sous ce nom », ce qui est une autre chose. §22 : une clé ne se juge pas sur ce
// qu'elle rattrape mais sur la somme de ce qu'elle rattrape et de ce qu'elle abîme.
//
// ✅ LE CRITÈRE RETENU EST CELUI QUE LA VOIE « SANS PAGE » A RÉELLEMENT ÉTABLI, ET IL EST DÉJÀ ÉCRIT
// EN BASE : `cartes_produits`. Chaque ligne y dit « ce produit, qui appartient au set S, est cette
// carte ». L'appartenance (carte, set) n'est donc pas à deviner — elle est le résultat de la
// jointure du TEXTE, celle qui a produit les fiches. On ne fabrique rien : on RECOPIE dans le champ
// que le joint d'images interroge une appartenance qui existe déjà ailleurs.
// 🔑 C'est la question du haut du catalogue : *qu'est-ce qu'on a DÉJÀ ?* — avant *quelle clé
// inventer ?*
//
// ✅ ET LE CONTRÔLE QUI DÉCIDE EST SUR CE QUI MARCHE DÉJÀ (§22, §32 bis) : le critère est rejoué sur
// les sets dont `cartes.sets` est DÉJÀ peuplé par la voie Setlist. S'il y ajoutait ou retirait quoi
// que ce soit, il ne décrirait pas l'appartenance mais autre chose. Le compte s'imprime AVANT toute
// écriture, et l'écriture REFUSE de partir si le contrôle n'est pas à zéro.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { TABLE_MAIN, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { champSur, apparier, lireMongo } = require('./collecte-cartes/lecture-sure');

const ECRIRE = process.argv.includes('--ecrire');
const pad = (v, n) => String(v).padStart(n);

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });

    const lignes = new Map();
    for (const l of [...TABLE_SANS_PAGE, ...TABLE_AUTO, ...TABLE_MAIN])
        if (l.slugSet && l.code && l.bulba?.expansion) lignes.set(l.code, l);

    const cartes = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { sets: 1, impressions: 1 } });
    champSur(cartes, 'impressions', { collection: 'cartes' });
    champSur(cartes, 'sets', { collection: 'cartes' });

    // index : slugSet -> cartes que la JOINTURE DU TEXTE y a rattachées (via les produits)
    const liens = await lireMongo(cx.db.collection('cartes_produits'), {},
        { nom: 'cartes_produits', projection: { carteId: 1, slugSet: 1 } });
    champSur(liens, 'slugSet', { collection: 'cartes_produits' });
    const parSlug = new Map();
    for (const l of liens) {
        if (!l.slugSet || l.carteId == null) continue;
        if (!parSlug.has(l.slugSet)) parSlug.set(l.slugSet, new Set());
        parSlug.get(l.slugSet).add(l.carteId);
    }
    apparier([...lignes.values()].map(l => l.slugSet), parSlug.keys(),
        { gauche: 'lignes de table', droite: 'cartes_produits.slugSet', cle: 'slugSet', seuilBas: 0.3 });
    console.log(`\n════ DÉNOMINATEUR : ${cartes.length} cartes · ${liens.length} liens carte↔produit · ${parSlug.size} slugSet joints · ${lignes.size} lignes de table ════`);
    const parId = new Map(cartes.map(c => [c._id, c]));

    // ── LE CONTRÔLE : que ferait le critère sur les sets DÉJÀ peuplés par la voie Setlist ?
    let temoins = 0, temoinAjouts = 0, temoinManques = 0;
    const ecartsTemoins = [];
    for (const [code, l] of lignes) {
        const dejaDansSets = cartes.filter(c => (c.sets || []).includes(l.slugSet));
        if (!dejaDansSets.length) continue;                       // pas un témoin : rien n'est peuplé
        temoins++;
        const parCritere = parSlug.get(l.slugSet) || new Set();
        const ajouts = cartes.filter(c => parCritere.has(c._id) && !(c.sets || []).includes(l.slugSet)).length;
        const manques = dejaDansSets.filter(c => !parCritere.has(c._id)).length;
        temoinAjouts += ajouts; temoinManques += manques;
        if ((ajouts || manques) && ecartsTemoins.length < 12) ecartsTemoins.push(`${code} ${l.slugSet} : +${ajouts} / ${manques} déjà là que le critère ne voit pas (${dejaDansSets.length} peuplées)`);
    }
    console.log(`\n── CONTRÔLE SUR CE QUI MARCHE : ${temoins} sets dont \`cartes.sets\` est déjà peuplé`);
    console.log(`   le critère y AJOUTERAIT ${temoinAjouts} appartenance(s) et ne VOIT PAS ${temoinManques} des appartenances existantes`);
    for (const x of ecartsTemoins) console.log(`      ${x}`);
    console.log(`   🔑 un critère qui dérange ce qui marche ne se câble pas, quel que soit ce qu'il rattrape (§22).`);

    // ── LA POPULATION VISÉE : les sets dont AUCUNE carte ne porte le slug
    const aPoser = [];
    for (const [code, l] of lignes) {
        if (cartes.some(c => (c.sets || []).includes(l.slugSet))) continue;   // déjà peuplé : hors sujet
        const cibles = [...(parSlug.get(l.slugSet) || new Set())].filter(id => parId.has(id));
        if (!cibles.length) continue;
        aPoser.push({ code, slug: l.slugSet, exp: [].concat(l.bulba.expansion).join(' / '), n: cibles.length, ids: cibles });
    }
    aPoser.sort((a, b) => b.n - a.n);
    const totalCartes = aPoser.reduce((s, x) => s + x.n, 0);
    console.log(`\n── À POSER : ${aPoser.length} sets · ${totalCartes} appartenances (carte, set)`);
    for (const x of aPoser.slice(0, 30)) console.log(`   ${pad(x.n, 4)} cartes · ${x.code.padEnd(9)} ${String(x.slug).slice(0, 40).padEnd(40)} « ${x.exp} »`);
    if (aPoser.length > 30) console.log(`   … ${aPoser.length - 30} autres`);

    // ⚠️ UNE CARTE DANS PLUSIEURS SETS EST NORMAL, ET C'EST MÊME LA RAISON D'ÊTRE DU §19 : une page
    // Bulbapedia est une carte TOUS TIRAGES FUSIONNÉS, et `cartes.images` est une LISTE clé par set
    // précisément pour ça. Le chiffre se compare donc à ce qui existe DÉJÀ (§32 bis : un contrôle
    // neuf se vérifie d'abord contre un cas normal connu), il ne sert pas de refus en lui-même.
    const parCarte = new Map();
    for (const x of aPoser) for (const id of x.ids) parCarte.set(id, [...(parCarte.get(id) || []), x.slug]);
    const dejaMulti = cartes.filter(c => (c.sets || []).length > 1).length;
    const apresMulti = cartes.filter(c => new Set([...(c.sets || []), ...(parCarte.get(c._id) || [])]).size > 1).length;
    console.log(`\n   ⚖️ cartes appartenant à plusieurs sets : ${dejaMulti} aujourd'hui → ${apresMulti} après (le cas NORMAL, §19)`);
    const max = [...parCarte.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (max) console.log(`      la carte qui en recevrait le plus : ${max[0]} → ${max[1].length} set(s)`);

    if (!ECRIRE) { console.log(`\n   (mesure seule — relancer avec --ecrire)`); await fermer(); return; }
    // ⚠️ LES DEUX MOITIÉS DU CONTRÔLE NE SE TRAITENT PAS PAREIL, ET IL FAUT DIRE POURQUOI.
    // Les MANQUES sont attendus et bénins : `cartes.sets` posé par la voie Setlist contient des
    // cartes qu'aucun produit Cardmarket ne vend (2 382 sur 494 sets), donc qu'aucun lien
    // `cartes_produits` ne peut nommer. Le critère est un SOUS-ENSEMBLE du vrai, et pour poser un
    // slug là où il n'y en a aucun, un sous-ensemble est exactement ce qu'on veut.
    // Les AJOUTS, eux, sont ce qui pourrait ABÎMER ce qui marche : ils sont bornés à un nombre
    // ÉNONCÉ D'AVANCE, et le dépassement refuse. C'est la même mécanique que `videAutorise` du
    // §41 — le coût du contournement n'est pas un effort, c'est une phrase qu'on doit pouvoir
    // écrire. 🔑 AJOUTS OUVERTS LE 2026-09-21 : **1, et un seul** — « Basic Fire Energy » (carte
    // 13682) sur `Beginning-Set`, déjà membre de 43 sets, lien `preuve: 'set+nom'`. Juste.
    const AJOUTS_ACCEPTES = 1;
    if (temoinAjouts > AJOUTS_ACCEPTES) {
        console.error(`\n❌ le critère ajouterait ${temoinAjouts} appartenance(s) sur des sets qui marchent, et ${AJOUTS_ACCEPTES} seulement ont été OUVERTES et acceptées — on n'écrit pas.`);
        process.exit(1);
    }
    console.log(`\n   ✅ contrôle : ${temoinAjouts} ajout(s) sur ${AJOUTS_ACCEPTES} accepté(s) · ${temoinManques} manque(s), attendus (la Setlist connaît des cartes sans produit)`);

    let n = 0;
    for (const x of aPoser) {
        const r = await cx.db.collection('cartes').updateMany({ _id: { $in: x.ids } }, { $addToSet: { sets: x.slug } });
        n += r.modifiedCount;
        console.log(`   ✅ ${x.code.padEnd(9)} ${x.slug.padEnd(40)} ${r.modifiedCount} / ${x.ids.length} cartes modifiées`);
    }
    console.log(`\n════ ÉCRIT : ${n} appartenances posées (attendu ${totalCartes}) ${n === totalCartes ? '✅' : '⚠️ écart — certaines portaient déjà le slug'} ════`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
