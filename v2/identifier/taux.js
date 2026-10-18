'use strict';
// B1b.6 — taux de change du jour (fichier de référence de la BCE) et règle de verdict.
// Principe (§5 Q17) : le fichier donne « 1 EUR = X devise » ; versEUR = 1 / X, arrondi à 6 décimales.
// Rien ici ne s'arme tout seul : rafraichirTaux() et amorcerTaux() ne sont appelées que par le déclencheur (taux-declencheur.js) que monter() ne branche que si V2_TAUX_BCE=1.
const { col: colDefaut } = require('../db');

const URL_BCE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const HEURE_LECTURE_PARIS = 16;       // la BCE publie vers 16 h CET : pas de lecture avant 16 h 00 heure de Paris
const AGE_MAX_JOURS = 7;              // au-delà, aucun verdict (versEUR null)
const { ECART_TENDANCE_MAX } = require('./fiabilite-prix');
// F4-PRIX (e) : `ecartTendanceMax` = la part de la moyenne (7 ou 30 jours) au-delà de laquelle la tendance ne dit plus le marché ; le prix n'est alors pas présenté comme sûr et le verdict n'est jamais certain.
const REGLE = Object.freeze({ bonneAffaireSous: -30, cherAuDela: 15, ecartTendanceMax: ECART_TENDANCE_MAX });
const MARQUE = '__lu';                // document de `taux` { devise: '__lu', date: <jour Paris> } : « lu aujourd'hui ? oui » (unique par jour)

const arrondi6 = x => Math.round(x * 1e6) / 1e6;
const journalDefaut = m => { try { console.warn(`[taux] ${m}`); } catch { /* journal muet */ } };
const forme = d => /^[A-Za-z]{3}$/.test(d);
const codeErr = e => (e && (e.code || e.name)) || 'erreur';   // B8 : jamais e.message au journal ni dans `raison` (un chemin de fichier, une URL, une erreur de pilote)

// Jour civil et heure à Paris (l'heure d'été se gère seule)
function parisDe(maintenant) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
        .formatToParts(maintenant).map(x => [x.type, x.value]));
    return { jour: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour) };
}
const joursEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Pure, ne lève jamais : un XML tronqué ne donne que les <Cube …/> complets, et rien du tout sans date complète.
function lireTauxBCE(xml, { journal = journalDefaut } = {}) {
    const vide = { date: null, taux: {} };
    try {
        if (typeof xml !== 'string') return vide;
        const m = /<Cube\s+time\s*=\s*(['"])(\d{4}-\d{2}-\d{2})\1\s*>/.exec(xml);
        if (!m) return vide;
        const date = m[2];
        if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return vide;
        const taux = {};
        const re = /<Cube\s+currency\s*=\s*(['"])([^'"]*)\1\s+rate\s*=\s*(['"])([^'"]*)\3\s*\/>/g;
        const apres = xml.slice(m.index + m[0].length);
        let c;
        while ((c = re.exec(apres))) {
            const devise = c[2].trim().toUpperCase(), x = Number(c[4]);
            if (!forme(devise)) { journal(`devise ignorée : code illisible « ${c[2]} »`); continue; }
            if (!(Number.isFinite(x) && x > 0)) { journal(`devise ignorée : ${devise} a un taux inutilisable « ${c[4]} »`); continue; }
            taux[devise] = x;
        }
        return Object.keys(taux).length ? { date, taux } : vide;
    } catch (e) { try { journal(`lecture du fichier de taux impossible : ${codeErr(e)}`); } catch { /* muet */ } return vide; }
}

const NUL = () => ({ versEUR: null, tauxDate: null });
// { versEUR, tauxDate } ; EUR sans lire la base ; taux absent, devise inconnue ou taux de plus de 7 jours => versEUR null. Ne lève jamais.
async function versEUR(devise, { maintenant = new Date(), col = null, journal = journalDefaut } = {}) {
    try {
        if (typeof devise !== 'string' || !forme(devise.trim())) return NUL();
        const d = devise.trim().toUpperCase();
        if (d === 'EUR') return { versEUR: 1, tauxDate: null };
        const { jour } = parisDe(maintenant);
        const c = col || colDefaut('taux');
        const doc = await c.find({ devise: d, date: { $lte: jour } }).sort({ date: -1 }).limit(1).next();
        if (!doc || !(Number.isFinite(doc.rate) && doc.rate > 0) || typeof doc.date !== 'string') return NUL();
        if (joursEntre(doc.date, jour) > AGE_MAX_JOURS) return NUL();
        return { versEUR: arrondi6(1 / doc.rate), tauxDate: doc.date };
    } catch (e) { try { journal(`lecture du taux de ${devise} impossible : ${codeErr(e)}`); } catch { /* muet */ } return NUL(); }
}

async function regleVerdict(devise, opts = {}) { return { ...REGLE, ...(await versEUR(devise, opts)) }; }

// Réessai BORNÉ (CLAUDE.md §38). Marque du jour { devise:'__lu', date:jour, essais, dernierEssaiLe, ok } ; jamais avant 16 h 00 Paris.
// Un essai n'est permis que si ok !== true, essais < 3 et dernier essai il y a au moins 1 h ; le pas (compter l'essai) est UN updateOne
// conditionnel, atomique : deux appels concurrents n'obtiennent pas tous deux le droit de lire. Un succès pose ok:true et clôt le jour ;
// un échec garde la marque (compteur d'essais) : une BCE en panne coûte au plus 3 requêtes par jour.
const ESSAIS_MAX = 3, PAUSE_ENTRE_ESSAIS_MS = 3600 * 1000;
async function rafraichirTaux({ fetch: lire = globalThis.fetch, maintenant = new Date(), col = null, journal = journalDefaut } = {}) {
    try {
        const { jour, heure } = parisDe(maintenant);
        if (heure < HEURE_LECTURE_PARIS) return { lu: false, raison: 'avant 16 h 00 Paris' };
        const c = col || colDefaut('taux');
        try { await c.insertOne({ devise: MARQUE, date: jour, essais: 0, dernierEssaiLe: null, ok: false }); }
        catch (e) { if (!(e && e.code === 11000)) throw e; }          // la marque du jour existe déjà : on tente de prendre un essai dessus
        const pris = await c.updateOne(
            { devise: MARQUE, date: jour, ok: { $ne: true }, essais: { $lt: ESSAIS_MAX }, $or: [{ dernierEssaiLe: null }, { dernierEssaiLe: { $lte: new Date(maintenant.getTime() - PAUSE_ENTRE_ESSAIS_MS) } }] },
            { $inc: { essais: 1 }, $set: { dernierEssaiLe: maintenant } });
        if (!pris || pris.modifiedCount !== 1) return { lu: false, essaiRefuse: true, raison: 'pas d\'essai permis aujourd\'hui (déjà lu, pause de 1 h, ou 3 essais faits)' };
        try {
            const r = await lireEtStocker({ lire, maintenant, col: c, journal });
            // Le jour n'est clos que si le fichier est celui du jour de Paris : celui de la veille, servi entre 16 h 00 et la publication, laisse la marque ouverte (réessai permis après la pause).
            if (r.date === jour) await c.updateOne({ devise: MARQUE, date: jour }, { $set: { ok: true } });
            return { ...r, requete: true };
        } catch (e) { try { journal(`rafraîchissement des taux échoué : ${codeErr(e)}`); } catch { /* muet */ } return { lu: false, requete: Boolean(e && e.requeteParti), raison: codeErr(e) }; }
    } catch (e) { try { journal(`rafraîchissement des taux impossible : ${codeErr(e)}`); } catch { /* muet */ } return { lu: false, raison: codeErr(e) }; }
}

// La lecture elle-même (une seule source : URL_BCE) et l'écriture des taux ; lève en cas d'échec (le code, jamais l'URL ni le message). Journal : la date lue et le nombre de devises.
// Un fichier non plausible n'est JAMAIS écrit : date future (par rapport au jour de Paris), aucune devise valable (les devises au taux non numérique ou ≤ 0 sont ignorées une à une par lireTauxBCE).
// Les erreurs levées après le départ de la requête portent `requeteParti` (le déclencheur ne compte une tentative que si une requête est partie).
async function lireEtStocker({ lire, maintenant, col, journal }) {
    const marque = e => Object.assign(e, { requeteParti: true });
    let r;
    try { r = await lire(URL_BCE, { headers: { accept: 'application/xml' }, signal: AbortSignal.timeout(15000) }); } catch (e) { throw marque(e instanceof Error ? e : new Error('x')); }
    if (!r || !r.ok) throw marque(Object.assign(new Error('réponse HTTP'), { code: `taux-http-${r && r.status}` }));
    let texte;
    try { texte = await r.text(); } catch (e) { throw marque(e instanceof Error ? e : new Error('x')); }
    const { date, taux } = lireTauxBCE(texte, { journal });
    if (!date) throw marque(Object.assign(new Error('aucun taux lisible dans le fichier'), { code: 'taux-aucun-taux-lisible' }));
    if (date > parisDe(maintenant).jour) throw marque(Object.assign(new Error('date future'), { code: 'taux-date-future' }));
    for (const [devise, x] of Object.entries(taux)) await col.updateOne({ devise, date }, { $set: { devise, date, rate: x, luLe: maintenant } }, { upsert: true });
    try { journal(`taux de la BCE lus : date ${date}, ${Object.keys(taux).length} devises`); } catch { /* muet */ }
    return { lu: true, date, devises: Object.keys(taux).length };
}

// Lecture de DÉMARRAGE (la « graine » d'un service neuf ou réveillé) : si aucun taux n'est en base, ou si le plus récent est plus vieux que AGE_MAX_JOURS, une lecture tout de suite,
// à n'importe quelle heure (la BCE sert alors le dernier fichier publié). Elle ne touche pas à la marque du jour : la lecture de 16 h reste due. Ne lève jamais.
const RAISON_RECENT = 'taux récent en base';
async function amorcerTaux({ fetch: lire = globalThis.fetch, maintenant = new Date(), col = null, journal = journalDefaut } = {}) {
    try {
        const { jour } = parisDe(maintenant);
        const c = col || colDefaut('taux');
        const dernier = await c.find({ devise: { $ne: MARQUE }, date: { $type: 'string', $lte: jour } }).sort({ date: -1 }).limit(1).next();   // une date future (jamais écrite par ce code) ne compte pas comme « récent »
        if (dernier && joursEntre(dernier.date, jour) <= AGE_MAX_JOURS) return { lu: false, requete: false, raison: RAISON_RECENT };
        return { ...(await lireEtStocker({ lire, maintenant, col: c, journal })), requete: true };
    } catch (e) { try { journal(`lecture de démarrage des taux échouée : ${codeErr(e)}`); } catch { /* muet */ } return { lu: false, requete: Boolean(e && e.requeteParti), raison: codeErr(e) }; }
}

module.exports = { lireTauxBCE, versEUR, regleVerdict, rafraichirTaux, amorcerTaux, parisDe, joursEntre, MARQUE, RAISON_RECENT, URL_BCE, REGLE, AGE_MAX_JOURS, HEURE_LECTURE_PARIS };
