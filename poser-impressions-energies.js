// ============================================================
// L'IMPRESSION DU SET QUI MANQUE À UNE CARTE — les Énergies de base de certains sets (lot POP2, 2026-10-13)
// ============================================================
//   node poser-impressions-energies.js --produits=574294,574295,725310 --tcgdex=<…/cards-database/data>                 (simulation : rien n'est écrit)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-impressions-energies.js --produits=… --tcgdex=… --attendu=3 --ecrire
//
// LE CAS : Evolving Skies « Darkness Energy » n°236, « Metal Energy » n°237, Obsidian Flames « Basic Fire Energy » n°230. Leur ligne de jointure existe
// (« Basic Darkness Energy », preuve setlist+nom), mais la CARTE n'a aucune impression du set : Bulbapedia ne liste pas ces énergies dans la Setlist de leur
// set. Sans impression « Evolving Skies », la collecte d'images TCGdex (swsh7-236) n'a rien à joindre (`aucune-impression-du-set`) et le site ne sait pas
// quelle fiche servir. Variante de poser-impressions-par-numero.js : même marque de conservation (`source: 'numero-cardmarket'`, impressions-posees.js), même
// géométrie d'impression, MÊME règle de comparaison des numéros (mesurer-fiches-melangees.numeroComparable — importée, pas recopiée).
// DEUX SOURCES INDÉPENDANTES, sinon rien : (1) le numéro APPRIS de Cardmarket (numeros_cartes.numero) ; (2) TCGdex, qui NOMME le produit
// (`thirdParty.cardmarket` du fichier de la carte, clone local) dans un set de CETTE expansion, au même numéro, sous le même nom (« Basic » en tête mis à part).
// REFUS (une garde s'écrit par ce qu'elle autorise) : carte ou set inconnu · set sans nom d'expansion unique · numéro non entier · TCGdex muet, ailleurs, à un
// autre numéro ou sous un autre nom · deux sets de la carte au même nom d'expansion · un autre produit de la carte dans le set à un autre numéro · un numeroFiche
// déjà posé et différent. Une carte qui a DÉJÀ une impression du set n'est jamais touchée (`deja`).
// ADDITIF : un $push gardé par un filtre (jamais deux fois) et un numeroFiche posé seulement là où il est nul. Aucune image, aucun appel réseau.
const { numeroComparable } = require('./mesurer-fiches-melangees');
const { SOURCES_POSEES_APRES } = require('./collecte-cartes/impressions-posees');

const SOURCE = 'numero-cardmarket';
const PREUVE = 'tcgdex-nomme-le-produit+numero-cardmarket';
if (!SOURCES_POSEES_APRES.includes(SOURCE)) throw new Error(`${SOURCE} n'est plus une source conservée par impressions-posees.js : un --reparser effacerait ces impressions`);
const SOURCE_NUMERO_FICHE = 'poser-impressions-energies (2026-10-13)';

const plat = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^basic\s+/, '').replace(/[^a-z0-9]/g, '');

/**
 * @param {object} o
 * @param {{carteId, idProduct, idExpansion, slugSet, numeroFiche}[]} o.lignes   lignes cartes_produits
 * @param {Map<number, object>} o.cartes      carteId -> { _id, nomEn, sets, impressions }
 * @param {Map<string, object>} o.sets        slugSet -> { _id, tirage, region, bulba:{expansion} }
 * @param {Map<number, string>} o.numeros     idProduct -> numéro appris de Cardmarket (numeros_cartes.numero)
 * @param {{parProduit: Map, setsParExpansion: Map}} o.clone   lireClone()
 * @param {(setId: string, localId: string) => string|null} o.nomClone   le nom anglais de la carte TCGdex
 * @param {number[]|null} o.produits  liste fermée des produits visés (null = balayage de toutes les lignes)
 */
function planifier({ lignes, cartes, sets, numeros, clone, nomClone, produits = null }) {
    const visees = produits ? new Set(produits) : null;
    const operations = [], refus = [], deja = [];
    const refuser = (l, raison) => refus.push({ idProduct: l.idProduct, carteId: l.carteId, raison });
    const aImprimer = new Set();        // `carteId|expansion|numéro` : une seule impression par carte, même avec deux lignes
    const candidates = lignes.filter(l => !visees || visees.has(l.idProduct));
    for (const l of candidates) {
        const carte = cartes.get(l.carteId);
        if (!carte) { refuser(l, `carte ${l.carteId} introuvable`); continue; }
        const set = sets.get(l.slugSet);
        if (!set) { refuser(l, `set ${l.slugSet} inconnu`); continue; }
        const tirage = set.tirage ?? set.region;
        const noms = [].concat(set.bulba?.expansion ?? []).filter(e => typeof e === 'string' && e);
        if (!tirage || noms.length !== 1) { refuser(l, `le set ${l.slugSet} n'a pas UN nom d'expansion (${noms.length}) : l'impression n'aurait pas de clé`); continue; }
        const E = noms[0];
        if ((carte.impressions || []).some(i => i && i.tirage === tirage && i.expansion === E)) { deja.push({ idProduct: l.idProduct, carteId: l.carteId }); continue; }
        const numero = numeros.get(l.idProduct);
        if (numero == null) { refuser(l, 'le produit n\'a pas de numéro Cardmarket appris'); continue; }
        if (!/^\d+$/.test(String(numero).trim())) { refuser(l, `le numéro Cardmarket « ${numero} » n'est pas un entier : cette voie ne pose que des numéros simples`); continue; }
        const n = String(numero).trim();
        // ── la seconde source : TCGdex nomme CE produit, dans un set de CETTE expansion
        const nommes = clone.parProduit.get(l.idProduct) || [];
        if (!nommes.length) { refuser(l, 'TCGdex ne nomme pas ce produit (thirdParty.cardmarket absent du clone)'); continue; }
        const setsTcgdex = new Set(clone.setsParExpansion.get(l.idExpansion) || []);
        const dedans = nommes.filter(x => setsTcgdex.has(x.setId));
        if (!dedans.length) { refuser(l, `TCGdex ne nomme pas ce produit dans un set de l'expansion ${l.idExpansion} (il le nomme dans ${[...new Set(nommes.map(x => x.setId))].join(', ')})`); continue; }
        const memeNumero = dedans.filter(x => numeroComparable(x.localId) === numeroComparable(n));
        if (!memeNumero.length) { refuser(l, `numéro : Cardmarket ${n}, TCGdex ${[...new Set(dedans.map(x => x.localId))].join('/')} — deux sources en désaccord`); continue; }
        const cibles = [...new Set(memeNumero.map(x => `${x.setId}|${x.localId}`))];
        if (cibles.length !== 1) { refuser(l, `TCGdex nomme ce produit à ${cibles.length} cartes au numéro ${n} : on ne choisit pas`); continue; }
        const [setId, localId] = cibles[0].split('|');
        const nomT = nomClone(setId, localId);
        if (!nomT || plat(nomT) !== plat(carte.nomEn)) { refuser(l, `nom : TCGdex ${setId}-${localId} « ${nomT} », la carte « ${carte.nomEn} »`); continue; }
        // ── la clé de l'impression doit être SANS AMBIGUÏTÉ côté site : un seul set de la carte porte ce nom d'expansion
        const memeNom = (carte.sets || []).filter(s => { const x = sets.get(s); return x && (x.tirage ?? x.region) === tirage && [].concat(x.bulba?.expansion ?? []).includes(E); });
        if (memeNom.length > 1) { refuser(l, `${memeNom.length} sets de la carte portent le nom d'expansion « ${E} » (${memeNom.join(', ')}) : l'impression s'afficherait dans chacun`); continue; }
        // ── un autre produit de la carte, dans ce set, à un autre numéro : la fiche se scinderait
        const autre = lignes.find(x => x.carteId === l.carteId && x.slugSet === l.slugSet && x.idProduct !== l.idProduct && numeros.get(x.idProduct) != null && numeroComparable(numeros.get(x.idProduct)) !== numeroComparable(n));
        if (autre) { refuser(l, `le produit ${autre.idProduct} de la même carte, dans le même set, est au numéro ${numeros.get(autre.idProduct)} : une seule impression ne les range pas tous`); continue; }
        if (l.numeroFiche != null && l.numeroFiche !== '' && numeroComparable(l.numeroFiche) !== numeroComparable(n)) { refuser(l, `la ligne porte déjà numeroFiche « ${l.numeroFiche} » (≠ ${n}) : jamais écrasé`); continue; }
        const cle = `${l.carteId}|${E}|${numeroComparable(n)}`;
        const premiere = !aImprimer.has(cle);
        aImprimer.add(cle);
        operations.push({
            carteId: l.carteId, idProduct: l.idProduct, slugSet: l.slugSet, numeroFiche: n, tcgdex: `${setId}-${localId}`,
            impression: premiere ? { tirage, expansion: E, numero: n, total: null, deck: null, rarete: null, source: SOURCE, preuveNumero: `Cardmarket idProduct ${l.idProduct} n°${n} (numeros_cartes) ; TCGdex ${setId}-${localId} « ${nomT} » nomme ce produit (thirdParty.cardmarket) au même numéro` } : null
        });
    }
    return { operations, refus, deja, balayage: !visees };
}

/** --attendu=N : le nombre de lignes du plan, mesuré en simulation. Absent ou différent : rien ne s'écrit. */
function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire (le nombre mesuré en simulation)' };
    if (plan.operations.length !== attendu) return { ok: false, raison: `le plan compte ${plan.operations.length} ligne(s), attendu ${attendu}` };
    return { ok: true };
}

/** Les deux écritures d'une opération, avec leur filtre : additives, jamais deux fois, jamais un numeroFiche existant écrasé. */
function operationsVersMongo(op) {
    return {
        impression: op.impression ? {
            filtre: { _id: op.carteId, impressions: { $not: { $elemMatch: { tirage: op.impression.tirage, expansion: op.impression.expansion } } } },
            maj: { $push: { impressions: op.impression } }
        } : null,
        ligne: { filtre: { carteId: op.carteId, idProduct: op.idProduct, numeroFiche: { $in: [null, ''] } }, maj: { $set: { numeroFiche: op.numeroFiche, numeroFicheSource: SOURCE_NUMERO_FICHE } } }
    };
}

async function ecrireOperations(db, operations) {
    let impressions = 0, lignes = 0;
    for (const op of operations) {
        const m = operationsVersMongo(op);
        if (m.impression) impressions += (await db.collection('cartes').updateOne(m.impression.filtre, m.impression.maj)).modifiedCount;
        lignes += (await db.collection('cartes_produits').updateOne(m.ligne.filtre, m.ligne.maj)).modifiedCount;
    }
    return { impressions, lignes };
}

async function executer({ argv, ouvrirConnexions }) {
    const fs = require('fs');
    const AUTORISES = [/^--produits=[\d,]+$/, /^--tcgdex=.+$/, /^--attendu=\d+$/, /^--ecrire$/, /^--balayer$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    if (inconnus.length || !arg('tcgdex') || (!arg('produits') && !argv.includes('--balayer'))) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}--produits=<idProduct,…> (ou --balayer) et --tcgdex=<dossier data du clone> obligatoires`); return 2; }
    const ECRIRE = argv.includes('--ecrire');
    return await (async () => {
        const { lireClone } = require('./collecte-cartes/variantes-tcgdex');
        const path = require('path');
        const clone = lireClone(arg('tcgdex'));
        // le nom d'une carte TCGdex : lu dans son fichier du clone (analyserCarte ne l'extrait pas)
        const dossiers = new Map();
        for (const serie of fs.readdirSync(arg('tcgdex'))) { const ds = path.join(arg('tcgdex'), serie); if (!fs.statSync(ds).isDirectory()) continue; for (const f of fs.readdirSync(ds)) { if (!f.endsWith('.ts')) continue; const id = /^\tid:\s*["']([^"']+)["']/m.exec(fs.readFileSync(path.join(ds, f), 'utf8'))?.[1]; if (id) dossiers.set(id, path.join(ds, f.replace(/\.ts$/, ''))); } }
        const nomClone = (setId, localId) => { const d = dossiers.get(setId); if (!d) return null; const p = path.join(d, `${localId}.ts`); if (!fs.existsSync(p)) return null; return /^\t\ten:\s*"((?:[^"\\]|\\.)*)"/m.exec(fs.readFileSync(p, 'utf8'))?.[1] ?? null; };
        const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
        try {
            const produits = arg('produits') ? arg('produits').split(',').map(Number) : null;
            const lignes = await cx.db.collection('cartes_produits').find(produits ? { idProduct: { $in: produits } } : {}, { projection: { carteId: 1, idProduct: 1, idExpansion: 1, slugSet: 1, numeroFiche: 1 } }).toArray();
            const cartes = new Map((await cx.db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, sets: 1, impressions: 1 } }).toArray()).map(c => [c._id, c]));
            const setsDocs = new Map((await cx.db.collection('sets').find({}, { projection: { tirage: 1, region: 1, idExpansion: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
            const numeros = new Map((await prod.db.collection('numeros_cartes').find(produits ? { idProduct: { $in: produits } } : {}, { projection: { idProduct: 1, numero: 1 } }).toArray()).map(n => [n.idProduct, n.numero]));
            // les autres produits de ces cartes dans leurs sets (garde « fiche scindée ») : leurs lignes et leurs numéros
            const voisines = produits ? await cx.db.collection('cartes_produits').find({ carteId: { $in: [...cartes.keys()] } }, { projection: { carteId: 1, idProduct: 1, idExpansion: 1, slugSet: 1, numeroFiche: 1 } }).toArray() : lignes;
            if (produits) for (const n of await prod.db.collection('numeros_cartes').find({ idProduct: { $in: voisines.map(v => v.idProduct) } }, { projection: { idProduct: 1, numero: 1 } }).toArray()) numeros.set(n.idProduct, n.numero);
            console.log(`   ${lignes.length} ligne(s) lues · ${cartes.size} carte(s) · clone TCGdex ${clone.nSets} sets, ${clone.nCartes} cartes`);
            const plan = planifier({ lignes: voisines, cartes, sets: setsDocs, numeros, clone, nomClone, produits });
            for (const o of plan.operations) console.log(`   + produit ${o.idProduct} -> carte ${o.carteId} · ${o.impression ? `impression « ${o.impression.expansion} » n°${o.impression.numero}` : '(impression déjà prévue pour cette carte)'} · numeroFiche ${o.numeroFiche} · TCGdex ${o.tcgdex}`);
            for (const r of plan.refus) console.log(`   - REFUS produit ${r.idProduct} (carte ${r.carteId}) : ${r.raison}`);
            for (const d of plan.deja) console.log(`   = déjà une impression du set : produit ${d.idProduct} (carte ${d.carteId})`);
            console.log(`\n   PLAN : ${plan.operations.length} ligne(s), ${plan.operations.filter(o => o.impression).length} impression(s) à poser · ${plan.refus.length} refus · ${plan.deja.length} déjà${plan.balayage ? ' (BALAYAGE de toutes les lignes)' : ''}`);
            if (!ECRIRE) { console.log('   (simulation — lot-additif.js … -- node poser-impressions-energies.js … --attendu=N --ecrire)'); return; }
            const v = verifierAttendu(plan, arg('attendu') === undefined ? undefined : Number(arg('attendu')));
            if (!v.ok) { console.error(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); process.exitCode = 1; return; }
            if (plan.balayage) { console.error('❌ ARRÊT : le balayage ne s\'écrit pas — nommer les produits (--produits=…)'); process.exitCode = 1; return; }
            const r = await ecrireOperations(cx.db, plan.operations);
            const relues = await cx.db.collection('cartes').countDocuments({ _id: { $in: plan.operations.map(o => o.carteId) }, impressions: { $elemMatch: { source: SOURCE } } });
            console.log(`\n   ✅ impressions posées ${r.impressions}/${plan.operations.filter(o => o.impression).length} · lignes numérotées ${r.lignes}/${plan.operations.length} · relu : ${relues} carte(s) portent une impression « ${SOURCE} »`);
            if (r.impressions !== plan.operations.filter(o => o.impression).length) process.exitCode = 1;
        } finally { await fermer(); }
    })().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}

module.exports = { planifier, verifierAttendu, operationsVersMongo, ecrireOperations, executer, SOURCE, PREUVE };

if (require.main === module) {
    require('dotenv').config();
    executer({ argv: process.argv.slice(2), ouvrirConnexions: require('./collecte-cartes/garde').ouvrirConnexions }).then(c => { if (c) process.exitCode = c; });
}
