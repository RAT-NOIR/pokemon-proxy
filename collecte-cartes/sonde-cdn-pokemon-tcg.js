// ============================================================
// SONDE DU SERVEUR D'IMAGES OFFICIEL — cdn.pokemon-tcg.cn, depuis le worker (décision du testeur, 2026-10-12)
// ============================================================
// « Test du serveur d'images officiel (cdn.pokemon-tcg.cn) depuis le worker : si les images s'y téléchargent, dis-moi ce qu'il faudrait pour
//   obtenir la liste carte → adresse d'image sans passer par pikaqian.com. Aucun navigateur automatisé, aucun identifiant de session, aucun changement d'adresse. »
//
// UNE FOIS, ET LE RÉSULTAT S'ÉCRIT : un document `etat/sonde-cdn-pokemon-tcg` (collecte_images_etat, base `cartes`). Idempotente : la prise est atomique
// (insertOne / findOneAndUpdate sur l'état lu) et tout état hors « en attente d'adresses » ferme la porte — « faite », mais aussi « en cours » (un
// redéploiement en plein milieu laisse l'état ainsi : on ne rejoue pas à l'aveugle, la lecture le dit), « défi », « robots refusé ».
// 🔑 UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (§51) : une adresse n'est demandée que si elle est `https://cdn.pokemon-tcg.cn/<chemin simple>`, sans port, sans
// identifiant, sans requête, sans « .. », ET si le robots.txt de cet hôte (relu d'abord) la permet à notre agent. Robots illisible, défi, 403 : écrit, arrêt.
// CE QUE LA SONDE FAIT : robots.txt, puis AU PLUS 3 images prises dans NOS données (`images.urlOfficielle`, écrite par le collecteur PikaQian depuis le
// champ `we_chat_image_url` des pages), à 10 s d'intervalle, `User-Agent` honnête seul, redirection jamais suivie. Par image : statut HTTP, type, taille
// (en-tête ET octets lus), dimensions, serveur, défi. Elle NE STOCKE PAS l'image (aucun dépôt R2, aucune écriture hors de ce document) et ne la joint à rien.
const P = require('./pikaqian');
const T = require('./tpc');

const HOTE = 'cdn.pokemon-tcg.cn';
const ID_SONDE = 'etat/sonde-cdn-pokemon-tcg';
const NB_MAX = 3;
const INTERVALLE_MS = 10000;                                 // la cadence des sources officielles (tpc.js) : jamais en dessous
const REVERIFIER_ADRESSES_MS = 24 * 3600 * 1000;               // sans adresse en base : on relit la base une fois par jour, jamais le réseau
const OCTETS_MAX = 2 * 1024 * 1024;
const UA = P.UA;
const CHEMIN_OK = /^\/[A-Za-z0-9_.\-/]{1,200}$/;

/** L'adresse est-elle une adresse que la sonde a le droit de demander ? Par ce qu'elle autorise. */
function adresseAutorisee(url) {
    let u; try { u = new URL(String(url)); } catch { return false; }
    // la forme CANONIQUE seulement : `new URL` normalise « .. » et « // » avant tout contrôle de chemin — l'adresse qui change en passant par le parseur n'est pas celle qu'on a jugée
    return u.href === String(url) && u.protocol === 'https:' && u.hostname === HOTE && !u.port && !u.username && !u.password && !u.search && !u.hash && CHEMIN_OK.test(u.pathname) && !u.pathname.includes('..') && !u.pathname.includes('//');
}

/** Le jugement de robots.txt de l'hôte d'images. */
function verdictRobots(rep, chemin = '/cards/x.png') {
    if (!rep || typeof rep.status !== 'number') return { ok: false, etat: 'robots-illisible', motif: 'aucune réponse exploitable' };
    const resume = `HTTP ${rep.status}, server=${rep.server ?? '∅'}, cf-mitigated=${rep.cfMitigated ?? '∅'}`;
    if (P.defi({ status: rep.status, cfMitigated: rep.cfMitigated, texte: rep.texte })) return { ok: false, etat: 'defi', motif: `défi ou refus sur robots.txt (${resume})` };
    if (rep.status === 404 || rep.status === 410) return { ok: true, robots: null, motif: `robots.txt absent (${resume})` };
    if (rep.status !== 200) return { ok: false, etat: 'robots-illisible', motif: `robots.txt illisible (${resume})` };
    const texte = typeof rep.texte === 'string' ? rep.texte : '';
    if (!/^text\/plain/i.test(rep.type || '') || !/^\s*user-agent\s*:/im.test(texte)) return { ok: false, etat: 'robots-illisible', motif: `200 qui n'est pas un robots.txt lisible (${resume})` };
    if (!T.autoriseParRobots(texte, chemin, UA)) return { ok: false, etat: 'robots-refuse', motif: `robots.txt interdit ${chemin} à notre agent (${resume})` };
    const d = T.delaiDesRobots(texte, UA);
    if (d && d > 60) return { ok: false, etat: 'robots-refuse', motif: `robots.txt demande un Crawl-delay de ${d} s (au-delà de 60 s)` };
    return { ok: true, robots: texte, crawlDelayS: d ?? null, motif: `robots.txt servi (${resume})` };
}

// ── LE TRANSPORT : une requête, `User-Agent` seul, redirection jamais suivie, corps borné ─────────────────────────────────────────────────────────────
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        let r;
        try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: binaire ? 'image/*;q=0.9,*/*;q=0.5' : 'text/plain,*/*;q=0.5' }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const h = k => r.headers.get(k);
        const base = { status: r.status, type: h('content-type') || '', server: h('server'), via: h('via'), cfMitigated: h('cf-mitigated'), cfRay: !!h('cf-ray'), contentLength: h('content-length') == null ? null : Number(h('content-length')), location: h('location') };
        if (r.status >= 300 && r.status < 400) return { ...base, corps: null, texte: null };
        const corps = await P.lireBorne(r, binaire ? OCTETS_MAX : 256 * 1024, url);
        return { ...base, corps: binaire && r.ok && /^image\//i.test(base.type) ? corps : null, texte: binaire && r.ok && /^image\//i.test(base.type) ? null : corps.toString('utf8') };
    }
};
async function mesurerAvecSharp(buffer) {
    const m = await require('sharp')(buffer).metadata();
    return { largeur: m.width ?? null, hauteur: m.height ?? null, format: m.format ?? null };
}

/**
 * @param {object} o  `E` : la collection `collecte_images_etat` ; `trouverAdresses()` : jusqu'à 3 adresses (déjà filtrées) ; le reste n'existe que pour le banc
 */
function fabriquerSonde({ E, trouverAdresses, transport = transportFetch, pause = ms => new Promise(r => setTimeout(r, ms)), maintenant = Date.now, mesurer = mesurerAvecSharp } = {}) {
    let enVol = false;
    const maj = (champs) => E.updateOne({ _id: ID_SONDE }, { $set: champs });
    async function executer() {
        if (enVol) return { envoye: false, raison: 'une sonde est déjà en cours dans ce processus' };
        enVol = true;
        try {
            const now = maintenant();
            let doc;
            try { doc = await E.findOne({ _id: ID_SONDE }); } catch (e) { return { envoye: false, raison: `état illisible (${e.message}) : on ne peut pas conclure` }; }
            if (doc != null) {
                if (doc.etat !== 'en-attente-adresses') return { envoye: false, raison: `déjà ${doc.etat} : une seule sonde` };
                if (!Number.isFinite(doc.reverifierApres)) return { envoye: false, raison: 'échéance illisible : on ne peut pas conclure' };
                if (now < doc.reverifierApres) return { envoye: false, raison: `aucune adresse en base, base relue après le ${new Date(doc.reverifierApres).toISOString()}` };
            }
            let adresses;
            try { adresses = (await trouverAdresses()).filter(adresseAutorisee).slice(0, NB_MAX); } catch (e) { return { envoye: false, raison: `adresses illisibles (${e.message}) : aucune requête` }; }
            if (!adresses.length) {
                // aucune requête : seulement l'état, relu dans 24 h
                if (doc == null) { try { await E.insertOne({ _id: ID_SONDE, etat: 'en-attente-adresses', verifieLe: now, reverifierApres: now + REVERIFIER_ADRESSES_MS, adressesDisponibles: 0 }); } catch { /* prise par un autre processus */ } }
                else await maj({ verifieLe: now, reverifierApres: now + REVERIFIER_ADRESSES_MS, adressesDisponibles: 0 });
                return { envoye: false, raison: 'aucune adresse cdn.pokemon-tcg.cn dans nos données', adressesDisponibles: 0 };
            }
            // PRISE ATOMIQUE : un seul processus passe
            const entree = { etat: 'en-cours', debute: now, adresses, adressesDisponibles: adresses.length, resultats: [] };
            try {
                if (doc == null) await E.insertOne({ _id: ID_SONDE, ...entree });
                else { const r = await E.findOneAndUpdate({ _id: ID_SONDE, etat: 'en-attente-adresses' }, { $set: entree }); const pris = r && typeof r === 'object' && 'value' in r && 'ok' in r ? r.value : r; if (!pris) return { envoye: false, raison: 'sonde prise par un autre processus' }; }
            } catch (e) { return { envoye: false, raison: `sonde prise par un autre processus (${e.message})` }; }

            const fin = async (etat, motif, extra = {}) => { await maj({ etat, motif, fini: maintenant(), ...extra }); return { envoye: true, etat, motif }; };
            // ---- 1. robots.txt de l'hôte ----
            let rb;
            try { rb = await transport.get(`https://${HOTE}/robots.txt`); } catch (e) { return fin('robots-illisible', `robots.txt : ${e.message}`, { requetes: 1 }); }
            const V = verdictRobots(rb, new URL(adresses[0]).pathname);
            await maj({ robots: { statut: rb.status, type: rb.type, serveur: rb.server ?? null, cfMitigated: rb.cfMitigated ?? null, via: rb.via ?? null, verdict: V.ok ? 'ok' : V.etat, motif: V.motif } });
            if (!V.ok) return fin(V.etat, V.motif, { requetes: 1 });
            // ---- 2. au plus 3 images, à 10 s ----
            const resultats = [];
            let requetes = 1;
            for (const url of adresses) {
                if (V.robots != null && !T.autoriseParRobots(V.robots, new URL(url).pathname, UA)) { resultats.push({ url, ecarte: 'robots.txt interdit ce chemin' }); continue; }
                await pause(Math.max(INTERVALLE_MS, (V.crawlDelayS || 0) * 1000));
                requetes++;
                const debut = maintenant();
                const res = { url };
                try {
                    const r = await transport.get(url, { binaire: true });
                    Object.assign(res, { statut: r.status, type: r.type || null, octetsEntete: r.contentLength ?? null, serveur: r.server ?? null, via: r.via ?? null, cfMitigated: r.cfMitigated ?? null, cfRay: !!r.cfRay });
                    if (r.location) res.location = r.location;                // une redirection est notée, jamais suivie
                    if (r.corps) {
                        res.octets = r.corps.length;
                        try { Object.assign(res, await mesurer(r.corps)); } catch (e) { res.erreurMesure = e.message; }
                    }
                    if (P.defi({ status: r.status, cfMitigated: r.cfMitigated, texte: r.texte })) res.defi = true;
                } catch (e) { res.erreur = e.message; }
                res.ms = maintenant() - debut;
                resultats.push(res);
                await maj({ resultats, requetes });
                if (res.defi) return fin('defi', `blocage sur ${url} (HTTP ${res.statut}) : on s'arrête`, { resultats, requetes });
            }
            const lues = resultats.filter(x => x.statut === 200 && x.octets > 0);
            return fin('faite', `${resultats.length} image(s) demandée(s) sur ${adresses.length} adresse(s) : ${lues.length} téléchargée(s) (HTTP 200, octets lus), non stockées`, { resultats, requetes, telechargees: lues.length });
        } finally { enVol = false; }
    }
    return { executer };
}

/** Les adresses officielles que NOUS avons, dans l'ordre stable des `_id` : `images.urlOfficielle`, écrite par le collecteur PikaQian (champ `we_chat_image_url`). */
async function adressesDeNosDonnees(db, n = NB_MAX) {
    const docs = await db.collection('images').find({ source: P.SOURCE, urlOfficielle: { $type: 'string' } }).project({ urlOfficielle: 1 }).sort({ _id: 1 }).limit(200).toArray();
    return [...new Set(docs.map(d => d.urlOfficielle))].filter(adresseAutorisee).slice(0, n);
}

/** Ce que le worker appelle à chaque tour. */
async function tacheDuWorker(db, { journal = console, fetchImpl, maintenant = Date.now } = {}) {
    const E = db.collection('collecte_images_etat');
    const sonde = fabriquerSonde({ E, trouverAdresses: () => adressesDeNosDonnees(db), maintenant });
    const r = await sonde.executer();
    if (r.envoye) journal.log(`🔎 sonde cdn.pokemon-tcg.cn → ${r.etat} (${r.motif})`);
    return r;
}

/** Le texte que l'outil de lecture imprime. */
function formater(doc) {
    if (!doc) return `sonde cdn.pokemon-tcg.cn : jamais lancée (aucun document ${ID_SONDE})`;
    const L = [`sonde cdn.pokemon-tcg.cn : ${doc.etat}${doc.motif ? ` — ${doc.motif}` : ''}`];
    if (doc.debute) L.push(`   lancée le ${new Date(doc.debute).toISOString()}${doc.fini ? `, finie le ${new Date(doc.fini).toISOString()}` : ' — NON FINIE (en cours, ou interrompue par un redéploiement : elle ne se rejoue pas toute seule)'} · requêtes ${doc.requetes ?? '?'}`);
    if (doc.etat === 'en-attente-adresses') L.push(`   aucune adresse cdn.pokemon-tcg.cn dans nos données (images.urlOfficielle) ; base relue après le ${doc.reverifierApres ? new Date(doc.reverifierApres).toISOString() : '?'}`);
    if (doc.robots) L.push(`   robots.txt : HTTP ${doc.robots.statut}, ${doc.robots.type || '∅'}, serveur ${doc.robots.serveur ?? '∅'}, cf-mitigated ${doc.robots.cfMitigated ?? '∅'} → ${doc.robots.verdict}`);
    if (doc.adressesDisponibles != null && doc.adressesDisponibles < NB_MAX && doc.etat !== 'en-attente-adresses') L.push(`   ${doc.adressesDisponibles} adresse(s) disponible(s) dans nos données (sur ${NB_MAX} voulues)`);
    for (const r of doc.resultats || []) {
        if (r.ecarte) { L.push(`   - ${r.url} : écartée (${r.ecarte})`); continue; }
        L.push(`   - ${r.url} : ${r.erreur ? `ERREUR ${r.erreur}` : `HTTP ${r.statut}, ${r.type ?? '∅'}, ${r.octets ?? 0} octets lus (en-tête ${r.octetsEntete ?? '∅'}), ${r.largeur ?? '?'}×${r.hauteur ?? '?'} ${r.format ?? ''}, serveur ${r.serveur ?? '∅'}, cf-mitigated ${r.cfMitigated ?? '∅'}${r.location ? `, redirection → ${r.location}` : ''}${r.defi ? ', DÉFI' : ''}`}`);
    }
    return L.join('\n');
}

module.exports = { HOTE, ID_SONDE, NB_MAX, INTERVALLE_MS, REVERIFIER_ADRESSES_MS, adresseAutorisee, verdictRobots, fabriquerSonde, adressesDeNosDonnees, tacheDuWorker, formater };
