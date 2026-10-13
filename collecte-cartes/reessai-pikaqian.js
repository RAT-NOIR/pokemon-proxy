// ============================================================
// PIKAQIAN BLOQUÉ — RÉESSAI ESPACÉ DEPUIS LE WORKER (décision du testeur, 2026-10-12)
// ============================================================
// « Réessai espacé depuis le worker (au moins 6 h, puis 24 h), en s'identifiant honnêtement, sans se faire passer pour un navigateur.
//   Trois blocages, et la source est suspendue. » Alerte d'origine : `alerte/source-bloquee/pikaqian`, 2026-10-12 02:14:33 UTC, HTTP 403
//   `cf-mitigated: challenge` sur https://pikaqian.com/robots.txt, 1 requête, 91 unités `pikaqian/<code>` en `refuse-source-bloquee`.
//
// UNE SEULE MACHINE D'ESPACEMENT (§21 bis) : celle de Bulbapedia (bulba-espacement.js). Ce fichier ne fournit que la POLITIQUE de PikaQian :
// quel état autorise une tentative, et ce que devient l'état après chaque verdict. La garde, la prise atomique et l'écriture sont les siennes.
//
// 🔑 UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (§51) : une requête ne part QUE si l'état se lit en base ET dit « alerte active, 1 ou 2 blocages
// datés, pas suspendue, échéance écoulée ». Pas d'état, état illisible, alerte levée, suspendue, tableau vide, date non finie : aucune requête, et la
// raison le dit.
// 🔑 LES BLOCAGES SE COMPTENT EN BASE, pas en mémoire de processus : un redéploiement ne remet rien à zéro. L'alerte écrite par le collecteur AVANT
// ce fichier n'a pas de tableau : elle EST le blocage n°1 (sa date `depuis`, l'adresse lue dans son motif, son statut).
// 🔑 LE CALENDRIER : tentative au plus tôt 6 h après le blocage n°1 ; si elle échoue sur un défi (blocage n°2), au plus tôt 24 h après ; si celle-là
// échoue (blocage n°3), la source est SUSPENDUE — plus aucune tentative, jusqu'à une décision du testeur (lisible par file-a-l-arret.js).
// Une réponse qui n'est pas un défi (5xx, coupure, redirection, robots illisible) ne compte PAS comme blocage mais n'autorise aucun réessai avant 24 h.
//
// L'IDENTIFICATION : une requête vers robots.txt, en-tête `User-Agent` seul (celui du dépôt : nom + contact, jamais un navigateur), redirection
// jamais suivie. Rien d'autre : ni changement d'adresse, ni navigateur automatisé, ni identifiant de session (collecte-cartes/bulba-espacement.js).
// La tentative ne prend pas le verrou global de pikaqian : tant que l'alerte est active, aucune unité n'envoie de requête (collecterSet refuse
// avant) — la cadence se compte donc chez la source, et la tentative est la seule requête.
const B = require('./bulba-espacement');
const T = require('./tpc');
const P = require('./pikaqian');
const { estPassive, motifPassif } = require('./source-passive');

const HEURE = 3600 * 1000;
const DELAIS_MS = Object.freeze([6 * HEURE, 24 * HEURE]);       // après le blocage n°1 puis n°2
const BLOCAGES_MAX = 3;                                           // au 3e : suspendue
const ESSAI_MIN_MS = 6 * HEURE;                                   // jamais deux tentatives à moins de 6 h (une prise sans réponse compte)
const APRES_AUTRE_MS = 24 * HEURE;
const CRAWL_DELAY_MAX_S = 60;                                     // le plafond du client (pikaqian.js)
const ID_ETAT = P.ID_ALERTE;
const URL_ROBOTS = `https://${P.HOTE_PAGES}/robots.txt`;
const CHEMIN_TEST = '/sets/cs1bc';                                // un chemin que le collecteur demande réellement : robots.txt doit nous le permettre
const UA = P.UA;

const enMs = v => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : NaN);

/** Les blocages DATÉS de l'état, ou null s'ils ne se lisent pas. Une alerte sans tableau (écrite par le collecteur) est le blocage n°1. */
function blocagesDe(etat) {
    if (!etat || typeof etat !== 'object' || Array.isArray(etat)) return null;
    if ('blocages' in etat) {
        if (!Array.isArray(etat.blocages)) return null;
        const sortie = [];
        for (const b of etat.blocages) {
            if (!b || typeof b !== 'object') return null;
            const le = enMs(b.le);
            if (!Number.isFinite(le)) return null;
            sortie.push({ le, url: b.url ?? null, status: b.status ?? null, motif: b.motif ?? null, origine: b.origine ?? null });
        }
        return sortie;
    }
    // une alerte ancienne n'est un BLOCAGE que si elle porte le statut d'une réponse : la fermeture par retrait n'en a pas (et porte `retrait: true`)
    if (etat.active !== true || etat.retrait === true || !Number.isFinite(etat.status)) return null;
    const le = enMs(etat.depuis);
    if (!Number.isFinite(le)) return null;
    return [{ le, url: /https:\/\/\S+?(?=\s|$)/.exec(String(etat.motif ?? ''))?.[0] ?? null, status: etat.status ?? null, motif: etat.motif ?? null, origine: 'ancien' }];
}

const POLITIQUE = Object.freeze({
    sansEtat: false,                                              // pas d'état en base : rien à retenter, pas de requête
    autoriser(etat, now) {
        if (!etat || typeof etat !== 'object' || Array.isArray(etat) || typeof etat.active !== 'boolean') return { ok: false, raison: 'état illisible (active non booléen) : on ne peut pas conclure' };
        if (etat.active === false) return { ok: false, raison: 'alerte levée : rien à retenter' };
        // une source RETIRÉE par décision (retirer-visuels-pikaqian.js) ne se retente JAMAIS, quel que soit le reste de l'état
        if (etat.retrait === true) return { ok: false, raison: 'source retirée par décision (retrait: true) : jamais retentée' };
        const bl = blocagesDe(etat);
        if (!bl || !bl.length) return { ok: false, raison: 'alerte active sans blocage daté lisible : on ne peut pas conclure' };
        if (etat.suspendue === true || bl.length >= BLOCAGES_MAX) return { ok: false, raison: `SUSPENDUE (${bl.length} blocages, dernier le ${new Date(Math.max(...bl.map(b => b.le))).toISOString()}) : plus aucune tentative sans décision du testeur` };
        if (etat.pasAvant != null && !Number.isFinite(etat.pasAvant)) return { ok: false, raison: 'échéance illisible : on ne peut pas conclure' };
        if (etat.dernierEssai != null && !Number.isFinite(enMs(etat.dernierEssai))) return { ok: false, raison: 'date du dernier essai illisible : on ne peut pas conclure' };
        let plusTot = Math.max(...bl.map(b => b.le)) + DELAIS_MS[bl.length - 1];
        if (Number.isFinite(etat.pasAvant)) plusTot = Math.max(plusTot, etat.pasAvant);
        if (Number.isFinite(enMs(etat.dernierEssai))) plusTot = Math.max(plusTot, enMs(etat.dernierEssai) + ESSAI_MIN_MS);
        if (now < plusTot) return { ok: false, raison: `blocage n°${bl.length} : prochaine tentative au plus tôt le ${new Date(plusTot).toISOString()}` };
        return { ok: true };
    },
    apres(v, etat, now) {
        const bl = blocagesDe(etat) ?? [];
        const retardMs = (v.retryAfterS || 0) * 1000;
        const commun = { dernierEssai: now, verdict: v.verdict, motif: v.motif, constateLe: now };
        if (v.verdict === 'SERVI') {
            // 🔴 le compte SURVIT à la levée : robots.txt servi ne prouve pas que les pages le sont. Il ne revient à zéro que par `reinitialiserBlocages`
            // (une collecte réellement réussie : page lue ET image téléchargée), sinon la boucle robots OK → pages bloquées ne suspendrait jamais.
            return { doc: { ...commun, active: false, suspendue: false, blocages: bl, pasAvant: null, levee: now }, retour: { envoye: true, verdict: 'SERVI', motif: v.motif } };
        }
        if (v.verdict === 'DEFI') {
            const tous = [...bl, { le: now, url: URL_ROBOTS, status: v.status ?? null, motif: v.motif, origine: 'worker' }];
            const suspendue = tous.length >= BLOCAGES_MAX;
            const pasAvant = suspendue ? null : now + Math.max(DELAIS_MS[tous.length - 1], retardMs);
            return { doc: { ...commun, active: true, suspendue, blocages: tous, pasAvant, status: v.status ?? null }, retour: { envoye: true, verdict: 'DEFI', motif: v.motif, blocages: tous.length, suspendue, pasAvant } };
        }
        const pasAvant = now + Math.max(APRES_AUTRE_MS, retardMs);
        return { doc: { ...commun, active: true, suspendue: false, blocages: bl, pasAvant }, retour: { envoye: true, verdict: 'AUTRE', motif: v.motif, blocages: bl.length, suspendue: false, pasAvant } };
    }
});

/** Jugement d'UNE réponse à robots.txt. `rep` = { status, headers: {get}, texte } ou null. SERVI seulement sur ce qui prouve que le site nous sert. */
function verdictDe(rep) {
    if (!rep || typeof rep.status !== 'number') return { verdict: 'AUTRE', motif: 'aucune réponse exploitable' };
    const h = k => (rep.headers && typeof rep.headers.get === 'function' ? rep.headers.get(k) : null);
    const texte = typeof rep.texte === 'string' ? rep.texte : '';
    const resume = `HTTP ${rep.status}, server=${h('server') ?? '∅'}, cf-mitigated=${h('cf-mitigated') ?? '∅'}, retry-after=${h('retry-after') ?? '∅'}`;
    const retryAfterS = Number(h('retry-after')) || null;
    // la MÊME définition d'un blocage que le client du collecteur : 403, 429, cf-mitigated, page de défi
    if (P.defi({ status: rep.status, cfMitigated: h('cf-mitigated'), texte })) return { verdict: 'DEFI', motif: `défi anti-robot (${resume}) sur ${URL_ROBOTS}`, status: rep.status, retryAfterS };
    if (rep.status === 404 || rep.status === 410) return { verdict: 'SERVI', motif: `robots.txt absent (${resume}), aucun défi` };
    if (rep.status !== 200) return { verdict: 'AUTRE', motif: `HTTP ${rep.status} (${resume})`, status: rep.status, retryAfterS };
    if (!/^text\/plain/i.test(h('content-type') || '') || !/^\s*user-agent\s*:/im.test(texte)) return { verdict: 'AUTRE', motif: `200 qui n'est pas un robots.txt lisible (${resume})` };
    if (!T.autoriseParRobots(texte, CHEMIN_TEST, UA)) return { verdict: 'AUTRE', motif: `robots.txt interdit ${CHEMIN_TEST} à notre agent (${resume})` };
    const d = T.delaiDesRobots(texte, UA);
    if (d && d > CRAWL_DELAY_MAX_S) return { verdict: 'AUTRE', motif: `robots.txt demande un Crawl-delay de ${d} s (au-delà de ${CRAWL_DELAY_MAX_S} s)` };
    return { verdict: 'SERVI', motif: `200 sans défi (${resume})` };
}

/** Le client direct : UNE requête vers le robots.txt de pikaqian.com, `User-Agent` seul, redirection jamais suivie. */
// 🔴 l'identité envoyée est CELLE DE PIKAQIAN (`P.UA`), la même que celle dont robots.txt est jugé — pas le défaut de Bulbapedia
const fabriquerClientDirect = fetchImpl => B.fabriquerClientDirect(fetchImpl, URL_ROBOTS, UA);

/** La machine de Bulbapedia, avec la politique de PikaQian. `allume` ne vaut que s'il est EXACTEMENT true (défaut : true — décision du testeur). */
// ➖ 2026-10-13 : FERMÉE PAR DÉFAUT (`allume = false`) — PikaQian est passive (source-passive.js), le worker ne retente plus rien. Seuls les bancs
// l'allument, pour garder la machine d'espacement testée ; aucun appelant de production ne passe `allume`.
function fabriquerEssai({ client, magasin, maintenant = Date.now, allume = false, surServi = null }) {
    return B.fabriquerEssaiEspace({ client, magasin, maintenant, allume, politique: POLITIQUE, verdict: verdictDe, id: ID_ETAT, surServi });
}
const magasinMongo = collection => B.magasinMongo(collection, ID_ETAT);

/**
 * Le collecteur a été bloqué (défi ou erreur répétée) : le blocage s'ÉCRIT dans le tableau de l'alerte, avec sa date, son adresse et son statut.
 * 🔴 Un `$set` de `motif`/`constateLe` seul effacerait le compte : celui-ci relit l'alerte, y ajoute, et recalcule l'échéance.
 * `depuis` est posé à CHAQUE transition vers « alerte active » (alerte neuve ou levée), jamais conservé d'une alerte précédente (§65).
 */
async function noterBlocage(collection, { unite = null, motif = null, status = null, url = null, requetes = null, nature = 'defi' } = {}, now = Date.now()) {
    const lu = await collection.findOne({ _id: ID_ETAT });
    // le compte vient du tableau en base, alerte active OU levée (I2) ; une alerte ancienne sans tableau compte comme un blocage
    const avant = lu ? (blocagesDe(lu) ?? []) : [];
    const tous = [...avant, { le: now, url, status, motif, origine: 'collecteur', nature }];
    const suspendue = tous.length >= BLOCAGES_MAX;
    // ➖ 2026-10-13 : plus aucune tentative n'est PROGRAMMÉE (source passive) — le blocage s'écrit, daté, et c'est tout
    const pasAvant = null;
    const depuis = lu?.active === true && lu.depuis ? lu.depuis : new Date(now);   // posée à chaque transition vers « active »
    await collection.updateOne({ _id: ID_ETAT }, { $set: { active: true, depuis, constateLe: new Date(now), motif, status, unite, requetes, suspendue, blocages: tous, pasAvant } }, { upsert: true });
    return { n: tous.length, suspendue, pasAvant };
}

/** Une collecte réellement réussie (page de set lue ET au moins une image téléchargée) remet le compte à zéro — et seulement elle. Sans effet sur une alerte active. */
async function reinitialiserBlocages(collection, now = Date.now()) {
    const lu = await collection.findOne({ _id: ID_ETAT });
    if (!lu || lu.active !== false || !Array.isArray(lu.blocages) || !lu.blocages.length) return { remis: false };
    await collection.updateOne({ _id: ID_ETAT }, { $set: { blocages: [], historiqueBlocages: lu.blocages, reinitialiseLe: now } });
    return { remis: true };
}

/** Les unités pikaqian refusées POUR BLOCAGE repassent en attente, en QUEUE et dans leur ordre ; aucune autre source, aucun autre refus. Idempotent. */
async function remettreEnFile(F, maintenant = new Date()) {
    const filtre = { source: P.SOURCE, etat: 'refuse', resultat: 'refuse-source-bloquee' };
    const dernier = (await F.find({}).sort({ ordre: -1 }).limit(1).toArray())[0]?.ordre ?? 0;
    const unites = await F.find(filtre).sort({ ordre: 1 }).toArray();
    let remises = 0;
    for (const [i, u] of unites.entries()) {
        const r = await F.updateOne({ _id: u._id, ...filtre }, { $set: { etat: 'attente', ordre: dernier + 1 + i, remisEnFileLe: maintenant, remisEnFileMotif: 'réessai espacé réussi : robots.txt de pikaqian.com servi sans défi (collecte-cartes/reessai-pikaqian.js)' }, $unset: { pris: 1, erreur: 1 } });
        remises += r?.modifiedCount ?? 0;
    }
    return { remises, trouvees: unites.length };
}

/**
 * Ce que le worker fait à chaque tour de boucle : la tentative espacée (si l'état l'y autorise) puis la sonde du serveur d'images officiel.
 * Chaque tâche est isolée : une panne de l'une ne coupe pas l'autre, ni la boucle. Rien ne part si pikaqian n'est pas EN SERVICE.
 */
async function passerLesTaches(db, { journal = console, enService = require('./sources-en-service').enService, fetchImpl = fetch, maintenant = Date.now } = {}) {
    // ➖ 2026-10-13 : la source est PASSIVE (decision du testeur) — ni la tentative espacée ni la sonde du CDN ne partent, quoi que dise `enService` (bancs)
    if (estPassive(P.SOURCE) || !enService(P.SOURCE)) { const raison = estPassive(P.SOURCE) ? motifPassif(P.SOURCE) : 'pikaqian n\'est pas en service (sources-en-service.js)'; return { pikaqian: { envoye: false, raison }, sonde: { envoye: false, raison } }; }
    const sortie = {};
    try {
        const E = db.collection('collecte_images_etat'), F = db.collection('file_images');
        const essai = fabriquerEssai({ client: fabriquerClientDirect(fetchImpl), magasin: magasinMongo(E), maintenant, surServi: async ({ now }) => { const r = await remettreEnFile(F, new Date(now)); journal.log(`↩️ pikaqian : ${r.remises} unité(s) refusée(s) pour blocage remise(s) en file.`); } });
        sortie.pikaqian = await essai.essayer();
        if (sortie.pikaqian.envoye) journal.log(`🔎 pikaqian : tentative espacée → ${sortie.pikaqian.verdict} (${sortie.pikaqian.motif})${sortie.pikaqian.suspendue ? ' — SUSPENDUE, plus aucune tentative' : sortie.pikaqian.pasAvant ? ` — prochaine au plus tôt ${new Date(sortie.pikaqian.pasAvant).toISOString()}` : ''}`);
    } catch (e) { sortie.pikaqian = { envoye: false, erreur: e.message }; journal.error(`🔴 pikaqian : réessai espacé en échec — ${e.message}`); }
    try {
        const S = require('./sonde-cdn-pokemon-tcg');
        sortie.sonde = await S.tacheDuWorker(db, { journal, fetchImpl, maintenant });
    } catch (e) { sortie.sonde = { envoye: false, erreur: e.message }; journal.error(`🔴 sonde cdn.pokemon-tcg.cn en échec — ${e.message}`); }
    return sortie;
}

module.exports = { ID_ETAT, URL_ROBOTS, UA, DELAIS_MS, BLOCAGES_MAX, ESSAI_MIN_MS, POLITIQUE, blocagesDe, verdictDe, fabriquerClientDirect, fabriquerEssai, magasinMongo, noterBlocage, reinitialiserBlocages, remettreEnFile, passerLesTaches };
