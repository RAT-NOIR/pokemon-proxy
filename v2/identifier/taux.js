'use strict';
// B1b.6 — taux de change du jour (fichier de référence de la BCE) et règle de verdict.
// Principe (§5 Q17) : le fichier donne « 1 EUR = X devise » ; versEUR = 1 / X, arrondi à 6 décimales.
// Rien ici ne s'arme tout seul : rafraichirTaux() n'est appelée que par un déclencheur que monter() ne branche que si V2_TAUX_BCE=1 (autre lot).
const { col: colDefaut } = require('../db');

const URL_BCE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const HEURE_LECTURE_PARIS = 16;       // la BCE publie vers 16 h CET : pas de lecture avant 16 h 00 heure de Paris
const AGE_MAX_JOURS = 7;              // au-delà, aucun verdict (versEUR null)
const REGLE = Object.freeze({ bonneAffaireSous: -30, cherAuDela: 15 });
const MARQUE = '__lu';                // document de `taux` { devise: '__lu', date: <jour Paris> } : « lu aujourd'hui ? oui » (unique par jour)

const arrondi6 = x => Math.round(x * 1e6) / 1e6;
const journalDefaut = m => { try { console.warn(`[taux] ${m}`); } catch { /* journal muet */ } };
const forme = d => /^[A-Za-z]{3}$/.test(d);

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
    } catch (e) { try { journal(`lecture du fichier de taux impossible : ${e.message}`); } catch { /* muet */ } return vide; }
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
    } catch (e) { try { journal(`lecture du taux de ${devise} impossible : ${e.message}`); } catch { /* muet */ } return NUL(); }
}

async function regleVerdict(devise, opts = {}) { return { ...REGLE, ...(await versEUR(devise, opts)) }; }

// AU PLUS une lecture par jour (jour de Paris), jamais avant 16 h 00 Paris. La garde est un document unique par jour : deux déclencheurs
// simultanés n'obtiennent pas tous deux la marque. Un échec (réseau, HTTP, corps sans taux) rend la marque : un échec n'est pas une lecture.
async function rafraichirTaux({ fetch: lire = globalThis.fetch, maintenant = new Date(), col = null, journal = journalDefaut } = {}) {
    let c, jour, marque = false;
    try {
        const p = parisDe(maintenant);
        jour = p.jour;
        if (p.heure < HEURE_LECTURE_PARIS) return { lu: false, raison: 'avant 16 h 00 Paris' };
        c = col || colDefaut('taux');
        try { await c.insertOne({ devise: MARQUE, date: jour, le: maintenant }); marque = true; }
        catch (e) { if (e && e.code === 11000) return { lu: false, raison: 'déjà lu aujourd\'hui' }; throw e; }
        const r = await lire(URL_BCE, { headers: { accept: 'application/xml' }, signal: AbortSignal.timeout(15000) });
        if (!r || !r.ok) throw new Error(`réponse HTTP ${r && r.status}`);
        const { date, taux } = lireTauxBCE(await r.text(), { journal });
        if (!date) throw new Error('aucun taux lisible dans le fichier');
        for (const [devise, x] of Object.entries(taux)) await c.updateOne({ devise, date }, { $set: { devise, date, rate: x, luLe: maintenant } }, { upsert: true });
        return { lu: true, date, devises: Object.keys(taux).length };
    } catch (e) {
        if (marque) { try { await c.deleteOne({ devise: MARQUE, date: jour }); } catch { /* la marque restera : pas de nouvelle lecture ce jour, sans danger */ } }
        try { journal(`rafraîchissement des taux échoué : ${e.message}`); } catch { /* muet */ }
        return { lu: false, raison: e.message };
    }
}

module.exports = { lireTauxBCE, versEUR, regleVerdict, rafraichirTaux, parisDe, URL_BCE, REGLE, AGE_MAX_JOURS, HEURE_LECTURE_PARIS };
