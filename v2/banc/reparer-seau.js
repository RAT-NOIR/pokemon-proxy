'use strict';
// BANC-200 (tour 3, re-relecture I1) — RÉPARER la barrière d'écriture d'un seau dont une requête a été TUÉE entre sa réservation et sa terminaison (déploiement, mémoire, R2 qui pend) : `ecritures > termine` pour toujours, le scellé refuse
// (ECRITURES_EN_VOL) et, un seul seau pouvant être ouvert, tout le banc est gelé.
//   node v2/banc/reparer-seau.js --base=<base> --seau=<id> --attendu=<n> --par=<nom> [--minutes=30]        (variable : MONGODB_ESSAI_URI ; jamais la base `test`)
// 🔑 Écrit par ce qu'il AUTORISE, un seul chemin mène à l'écriture : le seau est OUVERT (jamais un seau scellé) ; l'écart `ecritures - termine` vaut EXACTEMENT --attendu (l'opérateur l'a lu avant : `courant` ou l'erreur du scellé) ; la dernière
// réservation est CONNUE et date de plus de N minutes (30 par défaut : une écriture réelle, même lente, n'en prend pas autant) ; l'opérateur est nommé. Alors UNE `updateOne` conditionnelle sur les valeurs LUES pose `termine = ecritures`.
// Tout autre cas refuse et DIT pourquoi. Chaque tentative laisse sa trace dans `banc_reparations` (qui, quand, seau, écart, valeurs avant et après, résultat), AVANT l'écriture : une réparation sans trace n'existe pas.
// Ce que la réparation ne peut pas savoir : si l'écriture « morte » a laissé un objet orphelin ou une ligne sans photo — le scellé le dira (`ligne-sans-photo`) et `--relire-r2` aussi.
const COL_SEAUX = 'banc_seaux', COL_TRACE = 'banc_reparations';
const FORME_SEAU = /^[0-9a-f]{16}$/;
const MINUTES_DEFAUT = 30;
const erreur = (code, message) => Object.assign(new Error(code), { code, detail: code, texte: message || code });

/**
 * @param {{seauId:string, attendu:number, par:string, minutes?:number, colFn:(n:string)=>any, horloge?:()=>Date}} o
 * @returns {Promise<{seauId:string, ecart:number, avant:{ecritures:number,termine:number}, apres:{ecritures:number,termine:number}}>}
 */
async function reparerSeau({ seauId, attendu, par, minutes = MINUTES_DEFAUT, colFn, horloge = () => new Date() }) {
    if (typeof seauId !== 'string' || !FORME_SEAU.test(seauId)) throw erreur('ENTREE', 'identifiant de seau illisible');
    if (!Number.isSafeInteger(attendu) || attendu < 1) throw erreur('ENTREE', '--attendu : l\'écart lu par l\'opérateur, un entier positif');
    if (typeof par !== 'string' || par.trim().length < 2 || par.length > 60) throw erreur('ENTREE', '--par : le nom de l\'opérateur');
    if (!Number.isSafeInteger(minutes) || minutes < 1) throw erreur('ENTREE', '--minutes : un entier positif');
    if (typeof colFn !== 'function') throw erreur('ENTREE', 'base absente');
    const seaux = colFn(COL_SEAUX);
    const s = await seaux.findOne({ _id: seauId });
    if (!s) throw erreur('SEAU_INCONNU', 'seau inconnu');
    if (s.etat !== 'ouvert') throw erreur('SEAU_NON_OUVERT', `le seau est « ${s.etat} » : un seau scellé n'est jamais réparé`);
    const [ec, te] = [s.ecritures ?? 0, s.termine ?? 0], ecart = ec - te;
    if (ecart < 1) throw erreur('RIEN_A_REPARER', 'aucune écriture en vol');
    if (ecart !== attendu) throw erreur('ATTENDU_DIFFERENT', `l'écart est ${ecart}, pas ${attendu} : relisez le seau avant de réparer`);
    if (!(s.derniereReservation instanceof Date)) throw erreur('RESERVATION_INCONNUE', 'la date de la dernière réservation est inconnue : on ne devine pas l\'âge d\'une écriture');
    const age = horloge().getTime() - s.derniereReservation.getTime();
    if (age < minutes * 60e3) throw erreur('TROP_RECENT', `la dernière réservation date de ${Math.round(age / 1000)} s (moins de ${minutes} min) : l'écriture est peut-être encore vivante`);
    // la trace d'abord : la tentative existe même si la suite échoue
    const trace = { seauId, par: par.trim(), le: horloge(), ecart, attendu, minutes, avant: { ecritures: ec, termine: te }, apres: { ecritures: ec, termine: ec }, derniereReservation: s.derniereReservation, resultat: 'tentative' };
    const ins = await colFn(COL_TRACE).insertOne(trace);
    const filtre = { _id: seauId, etat: 'ouvert', ecritures: ec === 0 ? { $in: [0, null] } : ec, termine: te === 0 ? { $in: [0, null] } : te, derniereReservation: s.derniereReservation };
    const r = await seaux.updateOne(filtre, { $set: { termine: ec } });
    const resultat = r && r.matchedCount === 1 ? 'faite' : 'echec';
    await colFn(COL_TRACE).updateOne({ _id: ins.insertedId }, { $set: { resultat } });
    if (resultat !== 'faite') throw erreur('CONCURRENCE', 'le seau a bougé entre la lecture et l\'écriture : rien n\'a été écrit, relisez-le');
    return { seauId, ecart, avant: trace.avant, apres: trace.apres };
}

// ── la ligne de commande : écrite par ce qu'elle AUTORISE (tout argument inconnu ou répété est refusé AVANT toute connexion)
function analyserArgs(argv) {
    if (!Array.isArray(argv)) return { erreur: 'arguments illisibles' };
    const v = { base: null, seau: null, attendu: null, par: null, minutes: null };
    for (const a of argv) {
        const m = typeof a === 'string' && /^--(base|seau|attendu|par|minutes)=(.+)$/s.exec(a);
        if (!m) return { erreur: `argument non reconnu « ${String(a).slice(0, 30)} »` };
        if (v[m[1]] !== null) return { erreur: `--${m[1]} donné deux fois` };
        v[m[1]] = m[2].trim();
    }
    if (!v.base || v.base.toLowerCase() === 'test') return { erreur: '--base est requise, et la base `test` (production) est refusée' };
    if (!v.seau || !FORME_SEAU.test(v.seau)) return { erreur: '--seau : identifiant de 16 hexadécimaux' };
    if (!/^\d{1,6}$/.test(v.attendu || '') || Number(v.attendu) < 1) return { erreur: '--attendu : l\'écart que vous avez lu, un entier positif' };
    if (!v.par || v.par.length < 2) return { erreur: '--par : votre nom' };
    if (v.minutes !== null && !/^\d{1,5}$/.test(v.minutes)) return { erreur: '--minutes : un entier positif' };
    return { base: v.base, seau: v.seau, attendu: Number(v.attendu), par: v.par, minutes: v.minutes === null ? MINUTES_DEFAUT : Number(v.minutes) };
}
async function connecterEcriture(env, base) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(env.MONGODB_ESSAI_URI, { appName: 'reparer-seau' });
    await client.connect();
    const d = client.db(base);
    const cols = await d.listCollections({ name: COL_SEAUX }, { nameOnly: true }).toArray();
    if (!cols.length) { try { await client.close(); } catch { /* rien */ } throw erreur('BASE-REFUSEE', 'la base nommée ne porte pas de collection banc_seaux'); }
    return { colFn: n => d.collection(n), fermer: () => client.close() };
}
async function lancerCLI(argv, { env = process.env, connecter = connecterEcriture, journal = l => console.log(l), horloge } = {}) {
    const a = analyserArgs(argv);
    if (a.erreur) { console.error(`❌ ARRÊT : ${a.erreur}\n   usage : node v2/banc/reparer-seau.js --base=<base> --seau=<id> --attendu=<n> --par=<nom> [--minutes=30]`); return 1; }
    if (typeof env.MONGODB_ESSAI_URI !== 'string' || !env.MONGODB_ESSAI_URI) { console.error('❌ ARRÊT : MONGODB_ESSAI_URI absente'); return 1; }
    let c = null;
    try {
        c = await connecter(env, a.base);
        const r = await reparerSeau({ seauId: a.seau, attendu: a.attendu, par: a.par, minutes: a.minutes, colFn: c.colFn, ...(horloge ? { horloge } : {}) });
        journal(`seau ${r.seauId} réparé : termine ${r.avant.termine} -> ${r.apres.termine} (écart ${r.ecart}), trace dans banc_reparations`);
        return 0;
    } catch (e) { console.error(`❌ REFUS : ${(e && e.code) || (e && e.name) || 'erreur'} — ${e && e.texte ? e.texte : ''}`); return 1; }
    finally { try { if (c && c.fermer) await c.fermer(); } catch { /* rien */ } }
}

module.exports = { reparerSeau, analyserArgs, lancerCLI, MINUTES_DEFAUT, COL_TRACE };
if (require.main === module) { require('dotenv').config(); lancerCLI(process.argv.slice(2)).then(code => process.exit(code)); }
