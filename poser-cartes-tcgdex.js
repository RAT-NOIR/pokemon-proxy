// ============================================================
// LES PRODUITS « SANS CARTE » QUE TCGDEX DÉSIGNE — joindre à la carte déjà en base, sinon une fiche TCGdex (2026-10-07)
// ============================================================
//   node poser-cartes-tcgdex.js --clone=<clone tcgdex/cards-database> --export=<products_singles_*.json>        (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-cartes-tcgdex.js --clone=… --export=… \
//        --attendu=pont:N,impression:N,fiche:N --ecrire
//
// 🔑 LA DEMANDE (testeur, 2026-10-07) : « TCGdex : feu vert pour les 247 textes sûrs et les 122 images, sous la garde ». Les 247 sont des
// produits Cardmarket d'un set QUI EXISTE chez nous, restés « produit-sans-carte » à la jointure, et que TCGdex désigne : par l'idProduct
// que TCGdex écrit sur la variante (`variants[].thirdParty.cardmarket`), ou par (set TCGdex relié, numéro appris) avec un témoin.
// Mesuré avant d'écrire (sonde du 2026-10-07) : une bonne part de ces cartes EST déjà en base — Pichu HGSS 28, l'Énergie Combat de Neo
// Genesis 106 — avec l'impression de ce set à ce numéro, et aucune ligne ne les joint au produit. On joint d'abord ce qui est là ; on ne
// fabrique une fiche que pour ce qui n'y est pas.
//
// LES RÈGLES, ÉCRITES AVANT LA MESURE, PAR CE QU'ELLES AUTORISENT :
// • LA DÉSIGNATION TCGdex d'un produit p : (1) une seule carte du clone porte l'idProduct de p, ou (2) sans elle, le numéro appris de p
//   dans un set TCGdex relié à l'expansion de p, une seule carte à ce numéro dont le TÉMOIN est d'accord. Dans les deux cas :
//   · le set TCGdex de la carte est RELIÉ à l'expansion de p (votes des idProduct de ses cartes, ou thirdParty du set) — un idProduct
//     posé par TCGdex sur la carte d'un AUTRE set (Great Tusk ex de Paldean Fates → la promo SVP 072) ne désigne pas la carte de ce set ;
//   · le témoin : le nom anglais de TCGdex (data) a une clé de nom commune avec le produit (clesNom, la règle de la jointure : « Basic
//     Fighting Energy » = « Fighting Energy »), ou, sans nom anglais (data-asia), un n° de Pokédex commun. Muet ou contre : refus.
// • LE SET chez nous : le seul set dont `idExpansion` porte l'expansion de p, avec `bulba.expansion` (le nom des impressions).
// • GESTE « pont » : UNE carte de notre base porte, en preuve d'illustrateur, l'identifiant TCGdex de la carte désignée (le pont du site,
//   poser-idproduct-tcgdex.mjs), ET cette carte a l'impression du set (tirage du set, son nom d'expansion) au numéro du produit, ET son
//   nom a une clé commune avec celui du produit. → une ligne `cartes_produits`, preuve `tcgdex+pont`.
// • GESTE « impression » : pas de pont, mais UNE carte de notre base (une page, pas une fiche simple) porte l'impression du set au numéro
//   du produit, et son nom a une clé commune avec celui du produit. Deux sources : TCGdex et notre page. → preuve `tcgdex+impression`.
//   Une impression à ce numéro tenue par une carte d'un AUTRE nom : contradiction, refus.
// • GESTE « fiche » : AUCUNE carte de notre base ne tient ce numéro dans ce set → une fiche TCGdex, comme une fiche simple
//   (creer-sets-sans-page.js) : `_id` négatif, `ficheSimple` dit d'où vient chaque champ, une impression (tirage du set, nom d'expansion,
//   numéro), l'illustrateur de TCGdex avec sa preuve. Nom et attaques : ceux de TCGdex en anglais (data) ; sans anglais (data-asia),
//   ceux du produit Cardmarket. Une fiche par (set, nom, numéro). À ENRICHIR : la page réelle la remplacera (ses lignes seront repointées).
// • Jamais : un produit qui a déjà une ligne ; un produit exclu par un reste de détachement (fiche contredite, nom ambigu…) ; une carte de
//   code ; un produit dont le set chez nous est double ou sans nom d'expansion. AUCUNE image ici : le worker est le seul collecteur.
// Les cartes s'écrivent AVANT les lignes (une panne entre les deux ne laisse pas une ligne dont la carte ignore le set).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
// la ligne de commande n'est lue que si ce fichier est LANCÉ (poser-par-nom-tcgdex.js l'importe pour lireClone et nomDuProduit)
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
let CLONE, EXPORT, ECRIRE, ATTENDU;
if (require.main === module) {
    const AUTORISES = [/^--clone=.+$/, /^--export=.+\.json$/, /^--attendu=[a-z]+:\d+(,[a-z]+:\d+)*$/, /^--ecrire$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --clone=, --export=, --attendu=pont:N,impression:N,fiche:N, --ecrire`); process.exit(2); }
    CLONE = arg('clone'); EXPORT = arg('export'); ECRIRE = process.argv.includes('--ecrire');
    ATTENDU = arg('attendu') ? Object.fromEntries(arg('attendu').split(',').map(x => { const [k, v] = x.split(':'); return [k, Number(v)]; })) : null;
    if (!CLONE || !fs.existsSync(path.join(CLONE, 'data')) || !EXPORT) { console.error('❌ --clone=<clone tcgdex/cards-database> et --export=<products_singles_*.json> requis'); process.exit(2); }
    if (ECRIRE && !ATTENDU) { console.error('❌ --ecrire exige --attendu=pont:N,impression:N,fiche:N (les comptes du plan, relus)'); process.exit(2); }
}
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { decomposerNomCardmarket, estCarteCode, cleNumero, clesNom, nomJointDe } = require('./collecte-cartes/jointure');
const DEX = JSON.parse(fs.readFileSync(path.join(__dirname, 'pokedex-dexids.json'), 'utf8'));
const cleDex = s => String(s || '').toLowerCase().replace(/[^a-z0-9δ]+/g, '');
const RESTES_EXCLUS = new Set(['fiche-contredite-par-le-nom', 'fiche-contredite-par-la-metacarte', 'fiche-contredite-par-les-attaques', 'produit-vers-plusieurs-cartes', 'nom-ambigu', 'carte-sans-nom', 'idproduct-contredit-par-tcgdex']);
const ROUTE = 'tcgdex:2026-10-07';

/** Le clone : les sets (dossier → id) et les cartes (nom anglais, Pokédex, idProduct, illustrateur, attaques anglaises). */
function lireClone(clone) {
    const sets = new Map(), cartes = [];
    const chaine = (t, cle) => t.match(new RegExp(`\\b${cle}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`))?.[1] ?? null;
    for (const racine of ['data', 'data-asia']) (function marcher(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { marcher(p); continue; }
            if (!e.name.endsWith('.ts')) continue;
            const t = fs.readFileSync(p, 'utf8');
            if (/const \w+: Set = /.test(t)) { sets.set(path.join(d, path.basename(e.name, '.ts')), { racine, id: chaine(t, 'id'), exp: Number(t.match(/thirdParty\s*:\s*\{[^}]*cardmarket\s*:\s*(\d+)/)?.[1]) || null }); continue; }
            if (!/const card: Card = /.test(t)) continue;
            const bloc = t.match(/\bname\s*:\s*\{([^}]*)\}/)?.[1] ?? '';
            const en = bloc.match(/\ben\s*:\s*["'`]([^"'`]+)/)?.[1] ?? null;
            const dex = (t.match(/dexId\s*:\s*\[([\d,\s]+)\]/)?.[1] ?? '').split(',').map(Number).filter(Boolean);
            const attaques = [...(t.match(/attacks\s*:\s*\[([\s\S]*?)\n\t\]/)?.[1] ?? '').matchAll(/name\s*:\s*\{[^}]*?\ben\s*:\s*["'`]([^"'`]+)/g)].map(m => m[1]);
            cartes.push({ dossier: d, racine, localId: path.basename(e.name, '.ts'), en, dex, attaques, illustrateur: chaine(t, 'illustrator'), rarete: chaine(t, 'rarity'),
                ids: [...new Set([...t.matchAll(/cardmarket\s*:\s*(\d+)/g)].map(m => Number(m[1])))] });
        }
    })(path.join(clone, racine));
    for (const c of cartes) c.tcgdexId = sets.get(c.dossier)?.id ? `${sets.get(c.dossier).id}-${c.localId}` : null;
    return { sets, cartes };
}
const nomDuProduit = p => (decomposerNomCardmarket(p.name ?? '').nom || String(p.name ?? '').split(' [')[0]).trim();
/** Le numéro d'une impression sans ce que la page y colle : une position entre parenthèses, un commentaire de wikitext. */
const numeroNu = n => String(n ?? '').replace(/<!--[\s\S]*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
const memeNom = (a, b) => { const A = clesNom(a); return clesNom(b).some(k => A.includes(k)); };

/**
 * Le cœur, pur : la décision pour un produit. ctx : { lie(exp) → Set de dossiers TCGdex, parId, parDossier, setDe(exp) → [sets],
 * pont(tcgdexId) → [cartes], tenues(tirage, expansion, cle) → [cartes] }. Rend { geste, … } ou { refus }.
 */
function decider(p, ctx) {
    const nom = nomDuProduit(p);
    const sets = ctx.setDe(p.idExpansion);
    if (sets.length !== 1) return { refus: sets.length ? `${sets.length} sets portent l'expansion ${p.idExpansion}` : `aucun set ne porte l'expansion ${p.idExpansion}` };
    const S = sets[0], T = S.tirage ?? S.region, E = [].concat(S.bulba?.expansion ?? []).filter(x => typeof x === 'string');
    if (!E.length) return { refus: `le set ${S._id} n'a pas de nom d'expansion (bulba.expansion)` };
    const lies = ctx.lie(p.idExpansion);
    // la désignation
    let carte = null, voie;
    const parId = ctx.parId.get(p.idProduct) || [];
    if (parId.length > 1) return { refus: `${parId.length} cartes TCGdex portent l'idProduct ${p.idProduct}` };
    if (parId.length === 1) { carte = parId[0]; voie = 'idProduct'; }
    else {
        if (!p.numero) return { refus: 'aucune carte TCGdex ne porte l\'idProduct, et le numéro n\'est pas appris' };
        const cands = [...lies].flatMap(d => (ctx.parDossier.get(d) || []).filter(c => cleNumero(c.localId) === cleNumero(p.numero)));
        if (!cands.length) return { refus: `aucune carte TCGdex au n°${p.numero} dans les sets reliés` };
        carte = cands.length === 1 ? cands[0] : null; voie = 'set+numéro';
        if (!carte) {
            const ok = cands.filter(c => temoin(c, nom) === 'oui');
            if (ok.length !== 1) return { refus: `${cands.length} cartes TCGdex au n°${p.numero}, ${ok.length} du nom du produit` };
            carte = ok[0];
        }
    }
    if (!lies.has(carte.dossier)) return { refus: `la carte TCGdex ${carte.tcgdexId} est d'un set que rien ne relie à l'expansion ${p.idExpansion}` };
    const t = temoin(carte, nom);
    if (t !== 'oui') return { refus: `témoin ${t === 'muet' ? 'MUET (ni nom anglais ni Pokédex comparable)' : `CONTRE (« ${carte.en ?? carte.dex.join('/')} » / « ${nom} »)`} — ${carte.tcgdexId}` };
    // le numéro du produit dans ce set : le numéro appris, sinon celui de TCGdex (désignation par l'idProduct)
    const num = p.numero ?? carte.localId;
    if (p.numero && cleNumero(p.numero) !== cleNumero(carte.localId)) return { refus: `numéro appris ${p.numero} ≠ numéro TCGdex ${carte.localId} (${carte.tcgdexId})` };
    // les gestes
    const pont = carte.tcgdexId ? ctx.pont(carte.tcgdexId) : [];
    const tenues = E.flatMap(e => ctx.tenues(T, e, cleNumero(num)));
    const uniq = xs => [...new Map(xs.map(c => [c._id, c])).values()];
    const tenuesU = uniq(tenues);
    const base = { S, T, E, carteTcgdex: carte, voie, num, nom };
    if (pont.length > 1) return { refus: `le pont ${carte.tcgdexId} mène à ${pont.length} cartes de la base` };
    if (pont.length === 1) {
        const C = pont[0];
        const imp = (C.impressions || []).find(i => i && i.tirage === T && E.includes(i.expansion) && cleNumero(numeroNu(i.numero)) === cleNumero(num));
        if (!imp) return { refus: `pont vers ${C._id} « ${C.nomEn} », qui n'a pas l'impression ${T} « ${E[0]} » n°${num}` };
        if (!memeNom(nomJointDe(C), nom)) return { refus: `pont vers ${C._id} « ${C.nomEn} » : nom différent de « ${nom} »` };
        if (tenuesU.some(x => x._id !== C._id)) return { refus: `n°${num} tenu aussi par ${tenuesU.filter(x => x._id !== C._id).map(x => x._id).join(', ')}` };
        return { ...base, geste: 'pont', C, numeroFiche: imp.numero };
    }
    if (tenuesU.length > 1) return { refus: `n°${num} tenu par ${tenuesU.length} cartes (${tenuesU.map(x => x._id).join(', ')})` };
    if (tenuesU.length === 1) {
        const C = tenuesU[0];
        if (C.ficheSimple) return { refus: `n°${num} tenu par une fiche simple (${C._id}) : rien à départager` };
        if (!memeNom(nomJointDe(C), nom)) return { refus: `n°${num} tenu par ${C._id} « ${C.nomEn} » : contradiction de nom avec « ${nom} »` };
        const imp = C.impressions.find(i => i && i.tirage === T && E.includes(i.expansion) && cleNumero(numeroNu(i.numero)) === cleNumero(num));
        return { ...base, geste: 'impression', C, numeroFiche: imp.numero };
    }
    if (E.length !== 1) return { refus: `le set ${S._id} porte ${E.length} noms d'expansion : la fiche n'aurait pas d'impression unique` };
    return { ...base, geste: 'fiche', numeroFiche: String(num) };
}
function temoin(carte, nom) {
    if (carte.en) return memeNom(carte.en, nom) ? 'oui' : 'non';
    const d = DEX[cleDex(nom)] ?? null;
    if (carte.dex.length && d) return carte.dex.some(x => d.includes(x)) ? 'oui' : 'non';
    return 'muet';
}

module.exports = { decider, lireClone, temoin, nomDuProduit, numeroNu };

if (require.main === module) (async () => {
    const { sets: setsT, cartes: cartesT } = lireClone(CLONE);
    const E = JSON.parse(fs.readFileSync(EXPORT, 'utf8')).products;
    if (!cartesT.length || !E?.length) throw new Error(`clone ${cartesT.length} cartes · export ${E?.length} produits : rien à lire`);
    const expDe = new Map(E.map(p => [p.idProduct, p.idExpansion]));
    // le lien set TCGdex ↔ expansion : votes des idProduct de ses cartes, plus le thirdParty du set (la règle de la sonde v2)
    const lies = new Map(); const lier = (exp, d) => (lies.get(exp) || lies.set(exp, new Set()).get(exp)).add(d);
    for (const c of cartesT) for (const id of c.ids) { const e = expDe.get(id); if (e) lier(e, c.dossier); }
    for (const [d, s] of setsT) if (s.exp) lier(s.exp, d);
    const parId = new Map(); for (const c of cartesT) for (const id of c.ids) (parId.get(id) || parId.set(id, []).get(id)).push(c);
    const parDossier = new Map(); for (const c of cartesT) (parDossier.get(c.dossier) || parDossier.set(c.dossier, []).get(c.dossier)).push(c);

    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const lignes = await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1 } });
    const joints = new Set(lignes.map(l => l.idProduct));
    const restes = await lireMongo(cx.db.collection('restes'), {}, { nom: 'restes', projection: { idProduct: 1, type: 1 } });
    const typesDe = new Map(); for (const r of restes) (typesDe.get(r.idProduct) || typesDe.set(r.idProduct, new Set()).get(r.idProduct)).add(r.type);
    const population = E.filter(p => !estCarteCode(p.name ?? '') && !joints.has(p.idProduct) && typesDe.get(p.idProduct)?.has('produit-sans-carte') && ![...typesDe.get(p.idProduct)].some(t => RESTES_EXCLUS.has(t)));
    const nums = new Map((await prod.db.collection('numeros_cartes').find({ idProduct: { $in: population.map(p => p.idProduct) } }, { projection: { idProduct: 1, numero: 1, slug: 1, slugSet: 1 } }).toArray()).map(n => [n.idProduct, n]));
    const metaDe = new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: population.map(p => p.idProduct) } }, { projection: { idProduct: 1, idMetacard: 1 } }).toArray()).map(x => [x.idProduct, x.idMetacard ?? null]));
    const setsB = await lireMongo(cx.db.collection('sets'), {}, { nom: 'sets', projection: { idExpansion: 1, tirage: 1, region: 1, 'bulba.expansion': 1, code: 1 } });
    const setDe = new Map(); for (const s of setsB) for (const e of [].concat(s.idExpansion ?? [])) (setDe.get(e) || setDe.set(e, []).get(e)).push(s);
    const cartesB = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, niveau: 1, sets: 1, ficheSimple: 1, impressions: 1, liens: 1 } });
    const pont = new Map(), tenues = new Map();
    for (const c of cartesB) for (const i of c.impressions || []) {
        if (!i) continue;
        const id = /TCGdex ([a-z0-9]+(?:\.[0-9]+)?[a-z]*-[A-Za-z0-9%]+)/i.exec(i.illustrateurPreuve ?? '')?.[1];
        if (id) (pont.get(id) || pont.set(id, new Map()).get(id)).set(c._id, c);
        // (relecture du 2026-10-07) le numéro tel que NOS pages l'écrivent peut porter une position ou un reste de wikitext (« SWSH139 (Top
        // Left) » des V-UNION, « 102<!-- ») : sans le retirer, la carte n'était pas vue et une fiche TCGdex en DOUBLE naissait (6 le 2026-10-07)
        if (i.tirage && typeof i.expansion === 'string' && i.numero) { const k = `${i.tirage}|${i.expansion}|${cleNumero(numeroNu(i.numero))}`; (tenues.get(k) || tenues.set(k, new Map()).get(k)).set(c._id, c); }
    }
    const ctx = { lie: e => lies.get(e) || new Set(), parId, parDossier, setDe: e => setDe.get(e) || [], pont: id => [...(pont.get(id)?.values() ?? [])], tenues: (t, e, k) => [...(tenues.get(`${t}|${e}|${k}`)?.values() ?? [])] };
    console.log(`DÉNOMINATEUR : clone ${cartesT.length} cartes / ${setsT.size} sets · ${lies.size} expansions reliées · base ${cartesB.length} cartes, ${pont.size} identifiants TCGdex en pont · export ${E.length} produits → sans ligne, reste « produit-sans-carte », non exclus : ${population.length} (numéro appris ${nums.size})`);
    const decisions = population.map(p => ({ p, n: nums.get(p.idProduct), ...decider({ ...p, numero: nums.get(p.idProduct)?.numero ?? null }, ctx) }));
    const par = g => decisions.filter(d => d.geste === g);
    const refus = decisions.filter(d => d.refus);
    const motif = r => r.replace(/\d{3,}/g, '#').replace(/« [^»]*»/g, '«…»').replace(/n°\S+/g, 'n°…').replace(/\([^)]*\)/g, '(…)');
    const parMotif = {}; for (const d of refus) parMotif[motif(d.refus)] = (parMotif[motif(d.refus)] || 0) + 1;
    console.log(`GESTES : pont ${par('pont').length} · impression ${par('impression').length} · fiche ${par('fiche').length} · refus ${refus.length}`);
    for (const [m, n] of Object.entries(parMotif).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`   ✗ ${String(n).padStart(5)}  ${m}`);
    const parTir = g => { const t = {}; for (const d of par(g)) t[d.T] = (t[d.T] || 0) + 1; return JSON.stringify(t); };
    console.log(`   par tirage : pont ${parTir('pont')} · impression ${parTir('impression')} · fiche ${parTir('fiche')}`);
    // les fiches : une par (set, nom, numéro)
    const fiches = new Map();
    for (const d of par('fiche')) {
        const nomFiche = d.carteTcgdex.en ?? d.nom;
        const k = `${d.S._id}|${clesNom(nomFiche)[0]}|${cleNumero(d.num)}`;
        (fiches.get(k) || fiches.set(k, { S: d.S, T: d.T, E: d.E[0], nom: nomFiche, num: d.num, carteTcgdex: d.carteTcgdex, produits: [], attaques: d.carteTcgdex.en ? d.carteTcgdex.attaques : (decomposerNomCardmarket(d.p.name).attaques || []) }).get(k)).produits.push(d);
    }
    for (const f of fiches.values()) f.id = -Math.min(...f.produits.map(d => d.p.idProduct));
    const idsPris = new Set(cartesB.map(c => c._id));
    for (const f of fiches.values()) if (idsPris.has(f.id)) throw new Error(`fiche ${f.id} : identifiant déjà pris`);
    console.log(`FICHES TCGdex : ${fiches.size} (pour ${par('fiche').length} produits)`);
    let g = 20261007; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const geste of ['pont', 'impression', 'fiche']) {
        console.log(`--- ${geste} : 8 tirés au sort`);
        for (const d of [...par(geste)].sort(() => hasard() - 0.5).slice(0, 8)) console.log(`   ${d.p.idProduct} « ${d.p.name} » (${d.S._id}, n°${d.num}) → ${d.C ? `${d.C._id} « ${d.C.nomEn} »` : 'fiche'} · TCGdex ${d.carteTcgdex.tcgdexId} « ${d.carteTcgdex.en ?? '—'} » (${d.voie})`);
    }
    fs.writeFileSync(path.join(__dirname, 'mesures', `cartes-tcgdex-plan-2026-10-07.json`), JSON.stringify(decisions.map(d => ({ idProduct: d.p.idProduct, name: d.p.name, idExpansion: d.p.idExpansion, geste: d.geste ?? null, refus: d.refus ?? null, set: d.S?._id ?? null, numero: d.num ?? null, carte: d.C?._id ?? null, tcgdex: d.carteTcgdex?.tcgdexId ?? null, voie: d.voie ?? null })), null, 1));
    if (!ECRIRE) { console.log('(plan seul — --ecrire --attendu=pont:N,impression:N,fiche:N sous lot-additif.js ; décisions dans mesures/cartes-tcgdex-plan-2026-10-07.json)'); await fermer(); return; }
    const compte = { pont: par('pont').length, impression: par('impression').length, fiche: fiches.size };
    if (['pont', 'impression', 'fiche'].some(k => ATTENDU[k] !== compte[k])) { console.error(`❌ ARRÊT : le plan rend ${JSON.stringify(compte)}, attendu ${JSON.stringify(ATTENDU)}`); await fermer(); process.exit(1); }

    const le = new Date(), C = cx.db.collection('cartes'), CP = cx.db.collection('cartes_produits');
    const ligneDe = (d, carteId, preuve, detail) => ({ updateOne: { filter: { _id: `${carteId}|${d.p.idProduct}` }, update: { $setOnInsert: {
        carteId, idProduct: d.p.idProduct, idExpansion: d.p.idExpansion, tirage: d.T, preuve, slug: d.n?.slug ?? null, slugSet: d.n?.slugSet ?? d.S._id, numeroFiche: d.numeroFiche,
        detail, verifieLe: le, route: ROUTE } }, upsert: true } });
    // 1. les cartes déjà là : le set et le produit sur la carte, AVANT la ligne
    const joindre = [...par('pont'), ...par('impression')];
    if (joindre.length) await C.bulkWrite(joindre.map(d => ({ updateOne: { filter: { _id: d.C._id }, update: { $addToSet: { sets: d.S._id, 'liens.idProduct': d.p.idProduct, ...(metaDe.get(d.p.idProduct) != null ? { 'liens.idMetacards': metaDe.get(d.p.idProduct) } : {}) } } } })), { ordered: false });
    const rJ = joindre.length ? await CP.bulkWrite(joindre.map(d => ligneDe(d, d.C._id, d.geste === 'pont' ? 'tcgdex+pont' : 'tcgdex+impression',
        `exp ${d.p.idExpansion} n°${d.num} « ${d.p.name} » → ${d.C._id} « ${d.C.nomEn} » : TCGdex ${d.carteTcgdex.tcgdexId} (${d.voie}${d.carteTcgdex.en ? `, « ${d.carteTcgdex.en} »` : ''}) ${d.geste === 'pont' ? 'porté en preuve par cette carte' : 'et l\'impression de cette carte'} au n°${d.numeroFiche} de « ${d.E.join(' / ')} » (${d.T})`)), { ordered: false }) : { upsertedCount: 0 };
    // 2. les fiches TCGdex
    let nFiches = 0, nLignesF = 0;
    for (const f of fiches.values()) {
        const ids = f.produits.map(d => d.p.idProduct), metas = [...new Set(ids.map(i => metaDe.get(i)).filter(m => m != null))];
        const u = await C.updateOne({ _id: f.id }, { $setOnInsert: {
            nomEn: f.nom, sets: [f.S._id], attaques: f.attaques.map(nom => ({ nom })),
            impressions: [{ tirage: f.T, expansion: f.E, numero: String(f.num), source: 'tcgdex', rarete: f.carteTcgdex.rarete ?? null,
                illustrateur: f.carteTcgdex.illustrateur ?? null, illustrateurPreuve: f.carteTcgdex.illustrateur ? `TCGdex ${f.carteTcgdex.tcgdexId} (fiche TCGdex)` : `TCGdex ${f.carteTcgdex.tcgdexId} ne nomme pas l'illustrateur` }],
            liens: { idProduct: ids, idMetacards: metas },
            ficheSimple: { le, source: 'tcgdex', tcgdexId: f.carteTcgdex.tcgdexId, nomDe: f.carteTcgdex.en ? 'TCGdex (anglais)' : 'export Cardmarket (TCGdex sans nom anglais)',
                motif: 'aucune carte chez nous ne tient ce numéro dans ce set ; TCGdex désigne la carte (idProduct ou numéro + témoin) — fiche TCGdex, à enrichir (la page réelle la remplacera ; ses lignes seront repointées)' }
        } }, { upsert: true });
        nFiches += u.upsertedCount ?? 0;
        const r = await CP.bulkWrite(f.produits.map(d => ligneDe(d, f.id, 'fiche-tcgdex', `fiche TCGdex ${f.carteTcgdex.tcgdexId} « ${f.nom} » n°${f.num} (${d.voie}) : « ${d.p.name} »`)), { ordered: false });
        nLignesF += r.upsertedCount;
    }
    const relu = await CP.countDocuments({ route: ROUTE });
    const attendu = joindre.length + par('fiche').length;
    console.log(`${relu === attendu ? '✅' : '🔴'} lignes posées : jointes ${rJ.upsertedCount} · fiches ${nLignesF} (${nFiches} fiches créées) · RELU ${relu} lignes « ${ROUTE} » (attendu ${attendu})`);
    console.log(`SETS : ${[...new Set(decisions.filter(d => d.geste).map(d => d.S._id))].join(',')}`);
    if (relu !== attendu) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
