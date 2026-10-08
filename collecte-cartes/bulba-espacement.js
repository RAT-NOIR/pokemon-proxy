// ============================================================
// BULBAPEDIA — SONDE UNIQUE ET RÉESSAI ESPACÉ (décision 5 du testeur, 2026-10-08)
// « On ne contourne rien, on réessaie avec un espacement plus long. »
// ============================================================
// ÉTEINT : rien ici n'est branché au worker. Bulbapedia reste dans SOURCES_SUSPENDUES (sources-en-service.js) ; l'allumer est une
// décision du testeur (un commit sur CE fichier-là, puis push et redéploiement). Ce module ne fabrique que la machine d'état.
//
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (§51) : une requête ne part QUE si (1) l'essai est allumé explicitement, (2) l'état se lit,
// (3) il n'y a pas de suspension en cours, (4) la cadence d'essai est écoulée. Tout le reste — état illisible, champ manquant — bloque.
// Et un seul verdict continue : SERVI. DEFI et AUTRE (429, 5xx, réseau, redirection, robots) suspendent, sans réessai immédiat.
//
// Ce que ce module ne fait JAMAIS : changer d'en-têtes pour passer un défi, suivre une redirection, boucler, passer par la file de
// bulba.js ou prendre le verrou `bulbapedia/__collecteur__` (un worker peut le tenir : la sonde est une requête directe et isolée).

const { UA } = require('./bulba');
const { autoriseParRobots, delaiDesRobots } = require('./tpc');

const HOTE = 'https://bulbapedia.bulbagarden.net';
const CHEMIN_API = '/w/api.php';
const ID_ETAT = 'alerte/source-bloquee/bulbapedia';   // lu par file-a-l-arret.js (alertes `source-bloquee/`) : la suspension se voit

const HEURE = 3600 * 1000, JOUR = 24 * HEURE;
// CADENCE : 60 s entre deux requêtes d'un essai (12 fois les 5 s de bulba.js, qui tenait Crawl-delay: 5 relevé le 2026-09-12). §73 : le défi est
// tombé au PREMIER essai d'une journée de 3 requêtes, aucun 429 — la cadence n'était pas la cause, donc la raccourcir ne servirait à rien ;
// la rallonger ne coûte rien et dit au serveur qu'on n'est pas un aspirateur. Et jamais moins que le Crawl-delay que robots.txt demande.
const CADENCE_ESSAI_MS = 60 * 1000;
// SUSPENSION APRÈS DÉFI : 7 jours. Un défi n'est pas une limite de débit qui se lève en minutes : c'est une décision du site (ou de son CDN)
// sur CE client. Réessayer à l'heure répète la requête qui a déjà reçu non ; une fois par semaine coûte une requête et laisse le temps à
// une règle de bascule. Le premier défi consigné (2026-10-04) n'a, au 2026-10-08, jamais été relu : sept jours restent courts.
const SUSPENSION_DEFI_MS = 7 * JOUR;
// SUSPENSION APRÈS AUTRE (429, 5xx, réseau, redirection, robots illisible) : 24 h. Plus court qu'un défi parce que ce sont des états souvent
// passagers (§29), mais jamais de réessai rapide : « insister sur un serveur qui dit indisponible n'est pas un débit, c'est une charge ».
const SUSPENSION_AUTRE_MS = 1 * JOUR;

const DEFI_PAGE = /just a moment|checking your browser|cf-chl|challenge-platform|attention required|enable javascript and cookies/i;

/** Jugement d'UNE réponse. `rep` = { status, headers: {get}, texte } ou null. */
function verdictDe(rep) {
    if (!rep || typeof rep.status !== 'number') return { verdict: 'AUTRE', motif: 'aucune réponse exploitable' };
    const h = k => (rep.headers && typeof rep.headers.get === 'function' ? rep.headers.get(k) : null);
    const resume = `HTTP ${rep.status}, server=${h('server') ?? '∅'}, cf-mitigated=${h('cf-mitigated') ?? '∅'}, cf-ray=${h('cf-ray') ? 'présent' : '∅'}, retry-after=${h('retry-after') ?? '∅'}`;
    const texte = typeof rep.texte === 'string' ? rep.texte.slice(0, 5000) : '';
    if (/challenge/i.test(h('cf-mitigated') || '') || DEFI_PAGE.test(texte)) return { verdict: 'DEFI', motif: `défi anti-robot (${resume})`, retryAfterS: Number(h('retry-after')) || null };
    if (rep.status !== 200) return { verdict: 'AUTRE', motif: `HTTP ${rep.status} (${resume})`, retryAfterS: Number(h('retry-after')) || null };
    // 200 : la sonde lit robots.txt (une seule requête) — l'API doit y être permise pour notre agent, sinon on ne vient pas.
    if (!autoriseParRobots(texte, CHEMIN_API, UA)) return { verdict: 'AUTRE', motif: `robots.txt interdit ${CHEMIN_API} (${resume})` };
    return { verdict: 'SERVI', motif: `200 sans défi (${resume})`, crawlDelayS: delaiDesRobots(texte, UA) };
}

/** Le client direct : UNE requête vers robots.txt, en-tête User-Agent seul, redirection jamais suivie, ni file ni verrou. */
function fabriquerClientDirect(fetchImpl = fetch) {
    return async () => {
        const r = await fetchImpl(`${HOTE}/robots.txt`, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(45000) });
        return { status: r.status, headers: r.headers, texte: await r.text() };
    };
}

/**
 * La machine d'état. `magasin` = { lire(): doc|null, ecrire(doc) }. `allume` doit être EXACTEMENT true.
 * Rend { envoye, verdict?, raison? } ; ne lève que si l'écriture d'une suspension échoue (le dire plutôt que laisser repartir).
 */
function fabriquerEssaiEspace({ client, magasin, maintenant = Date.now, allume = false }) {
    let enVol = false;
    async function essayer() {
        if (allume !== true) return { envoye: false, raison: 'éteint (décision du testeur requise)' };
        if (enVol) return { envoye: false, raison: 'un essai est déjà en cours' };
        enVol = true;
        try {
            const now = maintenant();
            let etat;
            try { etat = await magasin.lire(); } catch (e) { return { envoye: false, raison: `état illisible (${e.message}) : on ne peut pas conclure` }; }
            if (etat && etat.active === true) {
                if (!Number.isFinite(etat.jusqua)) return { envoye: false, raison: 'suspendu, échéance illisible : on ne peut pas conclure' };
                if (now < etat.jusqua) return { envoye: false, raison: `suspendu jusqu'à ${new Date(etat.jusqua).toISOString()} (${etat.motif})` };
            }
            if (etat && Number.isFinite(etat.dernierEssai) && now < etat.dernierEssai + (etat.cadenceMs || CADENCE_ESSAI_MS))
                return { envoye: false, raison: 'cadence d\'essai non écoulée' };
            if (etat && !Number.isFinite(etat.dernierEssai) && etat.active === false) return { envoye: false, raison: 'état sans date d\'essai : on ne peut pas conclure' };

            let v;
            try { v = verdictDe(await client()); } catch (e) { v = { verdict: 'AUTRE', motif: `erreur réseau : ${e.code || e.message}` }; }

            if (v.verdict === 'SERVI') {
                const cadenceMs = Math.max(CADENCE_ESSAI_MS, (v.crawlDelayS || 0) * 1000);
                await magasin.ecrire({ _id: ID_ETAT, active: false, dernierEssai: now, cadenceMs, verdict: 'SERVI', motif: v.motif, constateLe: now });
                return { envoye: true, verdict: 'SERVI', motif: v.motif };
            }
            const base = v.verdict === 'DEFI' ? SUSPENSION_DEFI_MS : SUSPENSION_AUTRE_MS;
            const duree = Math.max(base, (v.retryAfterS || 0) * 1000);
            const depuis = etat && etat.active === true && Number.isFinite(etat.depuis) ? etat.depuis : now;
            await magasin.ecrire({ _id: ID_ETAT, active: true, depuis, dernierEssai: now, jusqua: now + duree, verdict: v.verdict, motif: v.motif, constateLe: now });
            return { envoye: true, verdict: v.verdict, motif: v.motif, jusqua: now + duree };
        } finally { enVol = false; }
    }
    return { essayer };
}

/** Adaptateur Mongo (collection `collecte_images_etat`, base `cartes`) : une façade fine, testable par une fausse collection. */
function magasinMongo(collection) {
    return {
        lire: () => collection.findOne({ _id: ID_ETAT }),
        ecrire: ({ _id, ...champs }) => collection.updateOne({ _id: ID_ETAT }, { $set: champs }, { upsert: true })
    };
}

module.exports = { UA, HOTE, ID_ETAT, CADENCE_ESSAI_MS, SUSPENSION_DEFI_MS, SUSPENSION_AUTRE_MS, verdictDe, fabriquerClientDirect, fabriquerEssaiEspace, magasinMongo };
