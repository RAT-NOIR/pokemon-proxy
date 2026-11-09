// ============================================================
// POSER LE NUMÉRO D'UNE IMAGE — une image sans numéro dans un set fait basculer tout le set en « fiche par document » côté site.
// ============================================================
//   node poser-numero-image.js --cle=<cleR2> --numero=<n>                                         (simulation : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=images,cartes -- node poser-numero-image.js --cle=<cleR2> --numero=<n> --ecrire --attendu=2
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : une seule clé ; le document `images` unique, `etat: 'ok'`, `numero` null ; `preuveLue.lu.numero`
// IDENTIQUE à --numero tel quel ; exactement une entrée `cartes.images` à cette clé, `numero` null ; la carte porte une impression au
// tirage du set avec ce numéro (même cleNumero que la jointure et le site : 148 = 0148) ; --attendu = nombre d'écritures planifiées.
// Écriture : `numero`, `numeroPoseLe`, `numeroPosePreuve` sur le document ET sur l'entrée (positionnel). Aucun autre champ, aucun effacement.
// Réversible : $unset de ces trois champs (numero remis à null).
const AUTORISES = [/^--cle=[^,\s]+$/, /^--numero=\S+$/, /^--ecrire$/, /^--attendu=\d+$/];

function lireArguments(argv) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) return { erreur: `argument inconnu ou invalide : ${inconnus.join(' ')} — autorisés : --cle=<cleR2 unique> --numero=<n> [--ecrire --attendu=N]` };
    const cles = argv.filter(a => a.startsWith('--cle=')), nums = argv.filter(a => a.startsWith('--numero='));
    if (cles.length !== 1 || nums.length !== 1) return { erreur: 'exactement un --cle et un --numero' };
    const att = argv.filter(a => a.startsWith('--attendu='));
    if (att.length > 1 || argv.filter(a => a === '--ecrire').length > 1) return { erreur: 'argument répété' };
    const ecrire = argv.includes('--ecrire');
    if (ecrire && !att.length) return { erreur: '--ecrire exige --attendu=N (le nombre d\'écritures regardé en simulation)' };
    return { cle: cles[0].slice(6), numero: nums[0].slice(9), ecrire, attendu: att.length ? Number(att[0].slice(10)) : undefined };
}

/** Le cœur, pur : { cle, numero, attendu?, ecrire? } + { docs, cartes, set } lus -> { ok, refus[], operations[], ecritures }. */
function planifier({ cle, numero, attendu, ecrire }, { docs, cartes, set }, { cleNumero } = require('./collecte-cartes/jointure')) {
    const refus = [];
    const R = m => { refus.push(m); };
    let d = null, entree = null, carte = null;
    if (!Array.isArray(docs) || docs.length !== 1) R(`document images : ${Array.isArray(docs) ? docs.length : '?'} à cette cleR2, exactement 1 attendu`);
    else {
        d = docs[0];
        if (d.etat !== 'ok') R(`etat du document : ${JSON.stringify(d.etat ?? null)}, « ok » exigé`);
        if (d.numero !== null && d.numero !== undefined) R(`numero du document déjà posé : ${JSON.stringify(d.numero)}`);
        const lu = d.preuveLue?.lu?.numero;
        if (lu === undefined || lu === null || String(lu) === '') R('preuveLue.lu.numero absent');
        else if (String(lu) !== String(numero)) R(`preuveLue.lu.numero ${JSON.stringify(lu)} différent de --numero ${JSON.stringify(numero)}`);
    }
    if (!Array.isArray(cartes) || cartes.length !== 1) R(`carte : ${Array.isArray(cartes) ? cartes.length : '?'} portent cette cleR2, exactement 1 attendue`);
    else {
        carte = cartes[0];
        const es = (carte.images || []).filter(i => i.cleR2 === cle);
        if (es.length !== 1) R(`entrée cartes.images : ${es.length} à cette cleR2, exactement 1 attendue`);
        else if (es[0].numero !== null && es[0].numero !== undefined) R(`entrée cartes.images déjà numérotée : ${JSON.stringify(es[0].numero)}`);
        else entree = es[0];
        if (entree) {
            if (!set) R(`set ${JSON.stringify(entree.set)} introuvable`);
            else {
                const tirage = set.tirage ?? set.region;
                const cn = cleNumero(numero);
                if (!tirage || !cn) R('tirage du set ou numéro inexploitable');
                else if (!(carte.impressions || []).some(i => i.tirage === tirage && i.numero != null && cleNumero(i.numero) === cn))
                    R(`impression : aucune au tirage « ${tirage} » portant le numéro ${numero} sur la carte`);
            }
        }
    }
    const operations = [];
    if (!refus.length) {
        const now = new Date();
        const preuve = { numero: String(d.preuveLue.lu.numero), total: d.preuveLue.lu.total ?? null };
        operations.push({ coll: 'images', filter: { _id: d._id, cleR2: cle, etat: 'ok', numero: null }, update: { $set: { numero, numeroPoseLe: now, numeroPosePreuve: preuve } } });
        operations.push({ coll: 'cartes', filter: { _id: carte._id, images: { $elemMatch: { cleR2: cle, numero: null } } }, update: { $set: { 'images.$.numero': numero, 'images.$.numeroPoseLe': now, 'images.$.numeroPosePreuve': preuve } } });
    }
    if (ecrire && attendu === undefined) R('attendu absent en écriture');
    else if (attendu !== undefined && attendu !== operations.length) R(`attendu ${attendu} différent des ${operations.length} écriture(s) planifiée(s)`);
    if (refus.length) operations.length = 0;
    return { ok: !refus.length, refus, operations, ecritures: operations.length };
}

/** `--ecrire` ne tourne que SOUS lot-additif.js : il pose LOT_ADDITIF_PID = son pid, et la commande en est l'enfant direct. */
function garderSousLot(env, ppid, commande = 'node lot-additif.js --quoi="…" --collections=images,cartes -- node poser-numero-image.js --cle=… --numero=… --ecrire --attendu=2') {
    if (!env || !env.LOT_ADDITIF_PID || env.LOT_ADDITIF_PID !== String(ppid)) throw new Error(`--ecrire refusé hors de lot-additif.js : ${commande} (rien n'est écrit)`);
}

/** Relecture après écriture : le document ET l'entrée portent le numéro posé. */
function releve({ doc, cartes }, { cle, numero }) {
    const entrees = (cartes || []).flatMap(c => (c.images || []).filter(i => i.cleR2 === cle));
    const ok = !!doc && doc.numero === numero && entrees.length === 1 && entrees[0].numero === numero;
    return { ok, detail: `document ${JSON.stringify(doc?.numero ?? null)} · ${entrees.length} entrée(s) ${JSON.stringify(entrees.map(e => e.numero ?? null))}` };
}

module.exports = { lireArguments, planifier, garderSousLot, releve };

if (require.main === module) {
    const a = lireArguments(process.argv.slice(2));
    if (a.erreur) { console.error(`❌ ${a.erreur}`); process.exit(2); }
    const path = require('path');
    const dotenv = require('dotenv');
    dotenv.config({ path: path.join(__dirname, '.env') });
    if (!process.env.MONGODB_CARTES_URI) dotenv.config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env' });
    if (a.ecrire) { try { garderSousLot(process.env, process.ppid); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); } }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    (async () => {
        const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
        const C = cx.db.collection('cartes'), I = cx.db.collection('images'), S = cx.db.collection('sets');
        const lire = async () => {
            const docs = await I.find({ cleR2: a.cle }).toArray();
            const cartes = await C.find({ 'images.cleR2': a.cle }, { projection: { nomEn: 1, images: 1, impressions: 1 } }).toArray();
            const e = cartes.length === 1 ? cartes[0].images.filter(i => i.cleR2 === a.cle) : [];
            const set = e.length === 1 ? await S.findOne({ _id: e[0].set }, { projection: { tirage: 1, region: 1 } }) : null;
            return { docs, cartes, set };
        };
        const m = await lire();
        const plan = planifier(a, m);
        console.log(`${a.cle} --numero=${a.numero} : ${m.docs.length} document(s) images, ${m.cartes.length} carte(s) · set ${m.set ? `${m.set._id} (tirage ${m.set.tirage ?? m.set.region})` : 'inconnu'}`);
        if (!plan.ok) { for (const r of plan.refus) console.error(`❌ REFUS : ${r}`); console.error('rien n\'est écrit'); await fermer(); process.exit(1); }
        console.log(`✓ ${plan.ecritures} écriture(s) planifiée(s) : numero ${JSON.stringify(a.numero)} sur le document images et sur l'entrée cartes.images (preuve ${JSON.stringify(plan.operations[0].update.$set.numeroPosePreuve)})`);
        if (!a.ecrire) { console.log('(simulation seule — --ecrire --attendu=2 sous lot-additif.js)'); await fermer(); return; }
        let modifiees = 0;
        for (const o of plan.operations) modifiees += (await cx.db.collection(o.coll).updateOne(o.filter, o.update)).modifiedCount;
        const r = releve(await lire(), a);
        console.log(`${modifiees === plan.ecritures && r.ok ? '✅' : '🔴'} ${modifiees}/${plan.ecritures} modifiée(s) · RELU : ${r.detail}`);
        if (modifiees !== plan.ecritures || !r.ok) process.exitCode = 1;
        await fermer();
    })().catch(e => { console.error(e); process.exit(1); });
}
