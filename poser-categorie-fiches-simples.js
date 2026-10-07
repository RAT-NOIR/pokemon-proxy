// ============================================================
// LA CATÉGORIE DES FICHES SIMPLES — par la carte d'origine, quand la réimpression est PROUVÉE (décision du testeur, 2026-10-07, nuit)
// ============================================================
//   node poser-categorie-fiches-simples.js            → simulation : calibration, plan, liste par set (collecte-cartes/rapports/)
//   node lot-additif.js --quoi="catégorie des fiches simples" --collections=cartes -- node poser-categorie-fiches-simples.js --ecrire
//
// La demande du site : les fiches simples (cartes sans page, creer-sets-sans-page.js) n'ont pas de `categorie` ; ses vedettes ne
// gardent que les Pokémon, et 23 sets en perdent tout ou partie. La décision : « source 1 : la carte d'origine, quand la réimpression
// est PROUVÉE (même nom ET mêmes attaques ou même texte) ; source 2 : les fiches TPC, une fois collectées ; sinon le champ reste vide.
// On ne devine jamais, on n'écrase jamais une valeur. »
// LA PREUVE (categorieProuvee), sur la clé de production collecte-cartes/cle-nom-attaques.js :
//   · des cartes À PAGE du même nom dont TOUTES les attaques sont dans les crochets Cardmarket, qui peuvent nommer au plus DEUX entrées
//     de plus — le talent et l'attaque GX, que Bulbapedia ne range pas dans `attaques` (Sylveon GX [Magical Ribbon | Fairy Wind | Plea GX]) ;
//   · ET toutes les cartes de ce nom portent la MÊME catégorie (un nom partagé par un Dresseur ne prouve rien) ; la question n'est pas
//     QUEL texte (la garde de `designer` refuse une voisine qui partage une attaque), c'est sa catégorie ;
//   · une fiche SANS attaque (Dresseurs, Énergies) n'est jamais prouvée : le nom seul ne désigne pas (« Honey » est Sweet Honey).
// 🔑 ÉPROUVÉE À CHAQUE LANCEMENT, et l'écriture en dépend (un seul faux, ou aucune réponse : rien ne s'écrit) :
//   · la calibration — chaque carte à page et à catégorie, ELLE-MÊME RETIRÉE (2 232 réponses sur 15 578, 0 faux le 2026-10-07) ; elle
//     ne peut guère échouer (une carte y porte ses propres attaques, un Dresseur n'en a pas : relecture), d'où
//   · l'ÉPREUVE sur les noms Cardmarket RÉELS, crochets compris, de chaque produit déjà joint, la carte retirée : 66 398 jugés dont 14 009
//     Dresseurs/Énergies, 7 040 réponses, 0 sur un Dresseur/Énergie, 0 faux. Elle a trouvé deux jointures FAUSSES chez nous (Umbreon ex
//     SV-P143 → Energy Sticker, Espeon ex SV-P142 → Double Dragon Energy), listées, non touchées.
// L'ÉCRITURE est ADDITIVE : `categorie` et `categoriePreuve` posés là où la catégorie est absente, sur une fiche simple seulement — le
// filtre de l'updateOne le redit (jamais une valeur écrasée). `categoriePreuve.source` est `carte-origine` : retirable d'un geste.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { indexer, candidats, memeAttaque, memeNom } = require('./collecte-cartes/cle-nom-attaques');

const REGLE = 'nom + attaques (toutes celles de la carte d\'origine dans les crochets, au plus 2 entrées en plus : talent, attaque GX) ; catégorie unanime des cartes du même nom';

/**
 * @param {Map} index  indexer(cartes à page ET à catégorie)
 * @param {{nomEn: string, attaques?: {nom: string}[]}} fiche
 * @param {{sauf?: number}} [o]  un _id à ignorer (la calibration : la vraie carte retirée)
 * @returns {{categorie: string|null, origine?: number, candidates?: number, raison: string|null}}
 */
function categorieProuvee(index, fiche, { sauf = null } = {}) {
    const attaques = (fiche.attaques || []).map(a => a?.nom).filter(Boolean);
    if (!attaques.length) return { categorie: null, raison: 'sans attaque : le nom seul ne prouve pas la réimpression' };
    const p = { nom: fiche.nomEn, attaques };
    // les candidates, la mieux couvrante d'abord : « en plus » = entrées des crochets que la carte ne porte pas
    const enPlusDe = c => attaques.filter(x => !(c.attaques || []).some(a => memeAttaque(a.nom, x))).length;
    const cs = candidats(index, p, { forme: 'incluses', sauf }).sort((a, b) => enPlusDe(a) - enPlusDe(b) || a._id - b._id);
    if (!cs.length) return { categorie: null, raison: 'aucune carte de ce nom à ces attaques' };
    // (relecture) « incluses » acceptait UNE attaque commune pour des crochets de trois : au plus EN_PLUS_MAX entrées que la carte ne
    // porte pas — un talent et une attaque GX, ce que Bulbapedia ne range pas dans `attaques` (mesuré le 2026-10-07 sur le plan :
    // 0 en plus 372, 1 : 314, 2 : 123, 3 : 1 — Sky-Splitting Deoxys, refusé)
    const enPlus = enPlusDe(cs[0]);
    if (enPlus > EN_PLUS_MAX) return { categorie: null, raison: `la carte d'origine ne porte que ${attaques.length - enPlus} des ${attaques.length} entrées des crochets` };
    const memes = memeNom(index, p, sauf);
    // (relecture) un nom que portent des cartes de catégories différentes ne prouve rien, même si les seules voisines qui partagent une
    // attaque sont unanimes
    const catsDuNom = new Set(memes.map(c => c.categorie));
    if (catsDuNom.size !== 1) return { categorie: null, raison: `homonymes de catégories différentes (${[...catsDuNom].join(', ')})` };
    const voisines = memes.filter(c => (c.attaques || []).some(a => attaques.some(x => memeAttaque(a.nom, x))));
    const cats = new Set([...cs, ...voisines].map(c => c.categorie));
    if (cats.size !== 1 || [...cats][0] == null) return { categorie: null, raison: `catégories en désaccord parmi les cartes du même nom (${[...cats].join(', ')})` };
    return { categorie: [...cats][0], origines: cs.slice(0, 5).map(c => c._id), cartesAuxMemesAttaques: cs.length, enPlus, raison: null };
}
const EN_PLUS_MAX = 2;

/**
 * Peut-on écrire ? Pure, écrite par ce qu'elle AUTORISE : rend null (écrire) ou la raison du refus. Un seul chemin passe — calibration et
 * épreuve qui PARLENT sans un faux, le volume annoncé, et les jointures à contre-catégorie exactement celles qu'on a annoncées après les
 * avoir regardées (relecture du 2026-10-08 : une 3e, inconnue, aurait laissé partir l'écriture). Une valeur absente ne passe jamais.
 */
function refusEcriture({ parle, faux, epParle, epFaux, aRemplir, attendu, contredites, contreditesAnnoncees }) {
    const entier = x => Number.isInteger(x) && x >= 0;
    if (![parle, faux, epParle, epFaux, aRemplir, attendu, contredites, contreditesAnnoncees].every(entier)) return 'un compte manque ou n\'est pas un entier : je ne peux pas conclure';
    if (!(parle > 0 && faux === 0 && epParle > 0 && epFaux === 0)) return `calibration ${parle ? `${faux} faux` : 'muette'}, épreuve ${epParle ? `${epFaux} faux` : 'muette'}`;
    if (aRemplir !== attendu) return `${aRemplir} fiches à remplir, ${attendu} annoncées (relancer la simulation)`;
    if (contredites !== contreditesAnnoncees) return `${contredites} jointures à contre-catégorie, ${contreditesAnnoncees} annoncées : chacune se regarde avant d'écrire (--contredites=<N>)`;
    return null;
}

module.exports = { categorieProuvee, refusEcriture, REGLE };

if (require.main === module) (async () => {
    // (relecture) une écriture nomme son volume d'avance : --ecrire exige --attendu=<N>, le nombre de fiches que la simulation a annoncé
    const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/, /^--contredites=\d+$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    const ECRIRE = process.argv.includes('--ecrire');
    const ATTENDU = Number(process.argv.find(a => a.startsWith('--attendu='))?.slice(10) ?? NaN);
    const CONTREDITES = Number(process.argv.find(a => a.startsWith('--contredites='))?.slice(14) ?? 0);
    if (inconnus.length || (ECRIRE && !Number.isInteger(ATTENDU))) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : [--ecrire --attendu=<N annoncé par la simulation> [--contredites=<N regardées>]]`); process.exit(2); }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });   // production : LECTURE des noms Cardmarket
    const C = cx.db.collection('cartes');
    const toutes = await C.find({}, { projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1, categorie: 1, ficheSimple: 1, sets: 1 } }).toArray();
    if (!toutes.length) throw new Error('« cartes » est VIDE (§41)');
    const origines = toutes.filter(c => !c.ficheSimple && c.categorie);
    const simplesTout = toutes.filter(c => c.ficheSimple);
    const simples = simplesTout.filter(c => c.categorie == null);
    console.log(`cartes ${toutes.length} · à page et à catégorie ${origines.length} · fiches simples ${simplesTout.length}, dont sans catégorie ${simples.length}`);
    if (!origines.length || !simplesTout.length) throw new Error('population vide : clé ou base fausse (§41)');
    const index = indexer(origines);

    // la calibration, vraie carte retirée
    let parle = 0, faux = 0; const exemplesFaux = [];
    for (const c of origines) {
        const r = categorieProuvee(index, c, { sauf: c._id });
        if (!r.categorie) continue;
        parle++;
        if (r.categorie !== c.categorie) { faux++; if (exemplesFaux.length < 10) exemplesFaux.push(`${c._id} « ${c.nomEn} » ${c.categorie} → ${r.categorie}`); }
    }
    console.log(`CALIBRATION (vraie carte retirée) : ${origines.length} cartes · la règle parle ${parle} · FAUX ${faux}${exemplesFaux.length ? ` — ${exemplesFaux.join(' ; ')}` : ''}`);
    // (relecture du 2026-10-07) LA CALIBRATION CI-DESSUS NE PEUT PAS ÉCHOUER UTILEMENT : chaque carte y porte ses PROPRES attaques, et un
    // Dresseur n'en a pas. L'ÉPREUVE se fait donc sur les VRAIS NOMS CARDMARKET (crochets compris : « Boss's Orders [Ghetsis] ») de
    // chaque produit déjà joint à une carte à page et à catégorie, la carte RETIRÉE — c'est la forme exacte d'une fiche simple, et c'est
    // sur les Dresseurs et Énergies à crochets que vit le danger.
    // Une « vérité » dont le NOM contredit la carte n'est pas une vérité connue : le 2026-10-07, l'épreuve a rendu 2 « faux » — Umbreon ex
    // SV-P143 joint à Energy Sticker, Espeon ex SV-P142 à Double Dragon Energy (`set+numero`) : des jointures FAUSSES chez nous, que la
    // règle contredisait à raison. Elles se comptent et se listent à part ; les détacher attend le feu vert du testeur.
    const { decomposerNomCardmarket, clesNom, nomJointDe } = require('./collecte-cartes/jointure');
    const contredites = [];
    const nomsCm = new Map((await prod.db.collection('catalogue_produits').find({}, { projection: { _id: 0, idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name]));
    const parId = new Map(origines.map(c => [c._id, c]));
    const lignes = await cx.db.collection('cartes_produits').find({}, { projection: { _id: 0, idProduct: 1, carteId: 1 } }).toArray();
    if (!nomsCm.size || !lignes.length) throw new Error(`épreuve impossible : ${nomsCm.size} noms Cardmarket, ${lignes.length} lignes (§41)`);
    const vus = new Set(); let epreuve = 0, epNomContredit = 0, epParle = 0, epFaux = 0, epNonPokemon = 0, epNonPokemonParle = 0; const epExemples = [];
    for (const l of lignes) {
        const c = parId.get(l.carteId), nom = nomsCm.get(l.idProduct);
        if (!c || !nom || vus.has(`${l.idProduct}|${l.carteId}`)) continue;
        vus.add(`${l.idProduct}|${l.carteId}`); epreuve++;
        const d = decomposerNomCardmarket(nom);
        const kc = clesNom(nomJointDe(c));
        if (!clesNom(d.nom).some(k => kc.includes(k))) {
            epNomContredit++;
            const r0 = categorieProuvee(index, { nomEn: d.nom, attaques: (d.attaques || []).map(x => ({ nom: x })) }, { sauf: c._id });
            if (r0.categorie && r0.categorie !== c.categorie) contredites.push(`${l.idProduct} « ${nom} » → carte ${c._id} « ${c.nomEn} » ${c.categorie}`);
            continue;
        }
        if (c.categorie !== 'pokemon') epNonPokemon++;
        const r = categorieProuvee(index, { nomEn: d.nom, attaques: (d.attaques || []).map(x => ({ nom: x })) }, { sauf: c._id });
        if (!r.categorie) continue;
        epParle++; if (c.categorie !== 'pokemon') epNonPokemonParle++;
        if (r.categorie !== c.categorie) { epFaux++; if (epExemples.length < 10) epExemples.push(`${l.idProduct} « ${nom} » → carte ${c._id} ${c.categorie}, dite ${r.categorie}`); }
    }
    console.log(`ÉPREUVE (noms Cardmarket réels, carte retirée) : ${epreuve} produits joints lus · nom contredit par la carte ${epNomContredit} (pas une vérité connue) · jugés ${epreuve - epNomContredit}, dont ${epNonPokemon} Dresseurs/Énergies · la règle parle ${epParle} (dont ${epNonPokemonParle} sur un Dresseur/Énergie) · FAUX ${epFaux}${epExemples.length ? ` — ${epExemples.join(' ; ')}` : ''}`);
    console.log(`   parmi les noms contredits, la règle désigne une AUTRE catégorie que la carte jointe (jointures à détacher, feu vert du testeur) : ${contredites.length}${contredites.length ? ` — ${contredites.join(' ; ')}` : ''}`);

    const plan = [], parSet = {}, motifs = {};
    for (const c of simples) {
        const r = categorieProuvee(index, c);
        if (r.categorie) plan.push({ _id: c._id, nomEn: c.nomEn, attaques: (c.attaques || []).map(a => a.nom), sets: c.sets || [], categorie: r.categorie, origines: r.origines, cartesAuxMemesAttaques: r.cartesAuxMemesAttaques, enPlus: r.enPlus });
        else { const m = r.raison.replace(/ \(.*\)$/, ''); motifs[m] = (motifs[m] || 0) + 1; }
        for (const s of c.sets || []) { const x = parSet[s] || (parSet[s] = { simplesSansCategorie: 0, remplies: 0, resteesVides: 0, motifs: {} }); x.simplesSansCategorie++; if (r.categorie) x.remplies++; else { x.resteesVides++; const m = r.raison.replace(/ \(.*\)$/, ''); x.motifs[m] = (x.motifs[m] || 0) + 1; } }
    }
    const parCat = plan.reduce((o, p) => (o[p.categorie] = (o[p.categorie] || 0) + 1, o), {});
    const parEnPlus = plan.reduce((o, p) => (o[p.enPlus] = (o[p.enPlus] || 0) + 1, o), {});
    console.log(`PLAN : ${plan.length} remplies ${JSON.stringify(parCat)} · ${simples.length - plan.length} restées vides ${JSON.stringify(motifs)}`);
    console.log(`   entrées des crochets que la carte d'origine ne couvre pas (talent, attaque GX) : ${JSON.stringify(parEnPlus)}`);
    for (const [s, x] of Object.entries(parSet).sort((a, b) => b[1].simplesSansCategorie - a[1].simplesSansCategorie)) console.log(`   ${s.padEnd(54)} ${String(x.simplesSansCategorie).padStart(4)} sans catégorie · remplies ${String(x.remplies).padStart(4)} · vides ${String(x.resteesVides).padStart(4)}`);
    const dossier = path.join(__dirname, 'collecte-cartes', 'rapports');
    fs.mkdirSync(dossier, { recursive: true });
    const rapport = path.join(dossier, `categorie-fiches-simples-${new Date().toISOString().slice(0, 10)}${ECRIRE ? '-ecrit' : '-simulation'}.json`);
    fs.writeFileSync(rapport, JSON.stringify({ le: new Date(), regle: REGLE, calibration: { origines: origines.length, parle, faux }, epreuve: { produits: epreuve, nomContreditParLaCarte: epNomContredit, jointuresAContreCategorie: contredites, dresseursEnergies: epNonPokemon, parle: epParle, parleSurDresseursEnergies: epNonPokemonParle, faux: epFaux }, simplesSansCategorie: simples.length, remplies: plan.length, motifs, parSet, plan }, null, 1));
    console.log(`→ ${path.relative(__dirname, rapport)}`);

    if (!ECRIRE) { console.log(`simulation : rien d'écrit (pour poser, sous lot-additif.js : --ecrire --attendu=${plan.length}${contredites.length ? ` --contredites=${contredites.length}, après avoir regardé les ${contredites.length} jointures à contre-catégorie ci-dessus` : ''})`); await fermer(); return; }
    const refus = refusEcriture({ parle, faux, epParle, epFaux, aRemplir: plan.length, attendu: ATTENDU, contredites: contredites.length, contreditesAnnoncees: CONTREDITES });
    if (refus) { console.error(`🔴 ${refus} : rien ne s'écrit`); await fermer(); process.exit(1); }
    const le = new Date();
    let ecrites = 0;
    for (let i = 0; i < plan.length; i += 500) {
        const ops = plan.slice(i, i + 500).map(p => ({ updateOne: {
            filter: { _id: p._id, ficheSimple: { $exists: true }, $or: [{ categorie: { $exists: false } }, { categorie: null }] },
            update: { $set: { categorie: p.categorie, categoriePreuve: { source: 'carte-origine', regle: REGLE, origines: p.origines, cartesAuxMemesAttaques: p.cartesAuxMemesAttaques, entreesEnPlus: p.enPlus, le } } } } }));
        ecrites += (await C.bulkWrite(ops, { ordered: false })).modifiedCount;
    }
    const relu = await C.countDocuments({ ficheSimple: { $exists: true }, 'categoriePreuve.source': 'carte-origine' });
    const sansApres = await C.countDocuments({ ficheSimple: { $exists: true }, $or: [{ categorie: { $exists: false } }, { categorie: null }] });
    console.log(`ÉCRIT : ${ecrites} sur ${plan.length} prévues · relu : ${relu} fiches simples portent categoriePreuve.source = carte-origine · fiches simples sans catégorie ${simples.length} → ${sansApres}`);
    await fermer();
    if (ecrites !== plan.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
