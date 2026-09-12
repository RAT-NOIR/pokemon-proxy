// ============================================================
// BULBAPEDIA — api.php, UNE requête toutes les 5 s, jamais en parallèle
// ============================================================
// `robots.txt` relu le 2026-09-12 : `/wiki/` permis, `/w/` interdit seulement sur `action=history` et
// `oldid=` → `api.php` est permis, `Crawl-delay: 5`. Les Archives (archives.bulbagarden.net)
// interdisent tout `/w/` : on ne touche JAMAIS à leur api.php ; les URL de fichiers se demandent ici,
// par `prop=imageinfo` (dépôt partagé).
//
// Le débit est tenu par une FILE : chaque appel attend la fin du précédent plus le délai. Deux
// appelants concurrents ne peuvent donc pas doubler la cadence — c'est ce qui distingue un
// collecteur d'un aspirateur. `maxlag=5` : si le serveur est en retard, on attend et on réessaie,
// trois fois au plus.

const axios = require('axios');

const API = 'https://bulbapedia.bulbagarden.net/w/api.php';
const UA = 'rat-market-collecte/0.1 (https://rat-market.fr ; collecte texte, contact via le site) axios';
const DELAI_MS = 5000;
const REESSAIS_MAXLAG = 3;

let _derniere = 0;          // horodatage du DÉBUT de la dernière requête
let _file = Promise.resolve();
let _compte = 0;

const dodo = ms => new Promise(r => setTimeout(r, ms));

/** Requête sérialisée et espacée. Rend le JSON, lève sur erreur API (sauf maxlag, réessayé). */
function api(params) {
    const tache = _file.then(async () => {
        for (let essai = 0; essai < REESSAIS_MAXLAG; essai++) {
            const attente = _derniere + DELAI_MS - Date.now();
            if (attente > 0) await dodo(attente);
            _derniere = Date.now();
            _compte++;
            const r = await axios.get(API, {
                params: { format: 'json', formatversion: 2, maxlag: 5, ...params },
                headers: { 'User-Agent': UA, 'Api-User-Agent': UA },
                timeout: 60000
            });
            const err = r.data?.error;
            if (err?.code === 'maxlag') {
                const retry = Number(r.headers['retry-after']) || 5;
                console.warn(`   ⏳ maxlag (${err.info}) — attente ${retry} s`);
                await dodo(retry * 1000);
                continue;
            }
            if (err) throw new Error(`api.php ${err.code}: ${err.info}`);
            return r.data;
        }
        throw new Error('maxlag persistant après ' + REESSAIS_MAXLAG + ' essais');
    });
    _file = tache.catch(() => { });
    return tache;
}

const compteRequetes = () => _compte;

/**
 * Liens sortants (espace principal) d'une page, avec continuation. Titres tels que liés (AVANT
 * redirection) — c'est voulu : le motif de titres s'applique aux titres liés par la Setlist.
 */
async function liensDe(titre) {
    const titres = [];
    let cont = {};
    do {
        const d = await api({ action: 'query', prop: 'links', titles: titre, plnamespace: 0, pllimit: 'max', redirects: 1, ...cont });
        const pg = d.query?.pages?.[0];
        if (!pg || pg.missing) throw new Error(`page « ${titre} » absente`);
        for (const l of pg.links || []) titres.push(l.title);
        cont = d.continue || {};
    } while (cont.plcontinue);
    return titres;
}

/**
 * Wikitext de pages, par lots de 50, redirections SUIVIES. Rend { pages: [{pageid, title, revid,
 * content}], redirections: Map<from, to>, manquantes: [titres] }.
 */
async function revisionsDe(titres) {
    const pages = [], manquantes = [];
    const redirections = new Map();
    for (let i = 0; i < titres.length; i += 50) {
        const lot = titres.slice(i, i + 50);
        const d = await api({ action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: lot.join('|'), redirects: 1 });
        for (const r of d.query?.redirects || []) redirections.set(r.from, r.to);
        for (const pg of d.query?.pages || []) {
            if (pg.missing) { manquantes.push(pg.title); continue; }
            const rev = pg.revisions?.[0];
            if (!rev) { manquantes.push(pg.title); continue; }
            pages.push({ pageid: pg.pageid, title: pg.title, revid: rev.revid, content: rev.slots?.main?.content ?? '' });
        }
    }
    return { pages, redirections, manquantes };
}

/** imageinfo (url, taille) de fichiers, par lots de 50. Pour le collecteur d'IMAGES, plus tard. */
async function imageinfoDe(fichiers) {
    const infos = new Map();
    for (let i = 0; i < fichiers.length; i += 50) {
        const lot = fichiers.slice(i, i + 50);
        const d = await api({ action: 'query', prop: 'imageinfo', titles: lot.join('|'), iiprop: 'url|size|mime|sha1' });
        for (const pg of d.query?.pages || []) infos.set(pg.title, pg.imageinfo?.[0] ?? null);
    }
    return infos;
}

module.exports = { api, liensDe, revisionsDe, imageinfoDe, compteRequetes, UA, DELAI_MS };
