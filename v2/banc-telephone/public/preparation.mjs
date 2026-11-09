// ============================================================
// LA PRÉPARATION DU PREMIER SCAN : cache durable des octets (modèle de 113 Mo, moteur .wasm de 14 Mo), garde de la préparation en arrière-plan, petites statistiques — logique pure, injectable, sans DOM
// ============================================================
// Pourquoi (RAPPORT-PREMIER-SCAN.md) : sur PC, sous un débit imposé à l'API, la « création de session » passe de 1,2 s à 12–16 s : c'est le TÉLÉCHARGEMENT du .wasm d'ORT (14 Mo) servi par l'API, que ORT va chercher
// lui-même à l'intérieur de InferenceSession.create (cause ÉTABLIE sur PC ; sur iPhone, HYPOTHÈSE compatible avec les 15,5 s relevées, non séparée de la compilation). Ce module range le modèle et le moteur dans Cache Storage (durable, jamais retéléchargés tant
// que leur contenu est reconnu) et laisse la page les demander en parallèle dès son ouverture.
// Règles :
//   · un échec du cache ne coûte jamais qu'un téléchargement : cache absent, open/match qui lèvent, quota dépassé à l'écriture, entrée de la mauvaise taille ou refusée par le vérificateur ⇒ réseau ;
//   · une entrée n'est JAMAIS crue sur parole : le vérificateur de l'appelant (sha256 du modèle) rejoue à chaque lecture, et une entrée refusée est SUPPRIMÉE ;
//   · le corps réseau est dédoublé (tee) vers le cache : un seul exemplaire des octets côté JS (le tableau préalloué à la taille annoncée), le cache écrit en flux ;
//   · les phases sont REELLES (surPhase : cache-lecture, telechargement, verification) ; la progression donne des octets reçus sur un total, jamais un pourcentage inventé.
export const NOM_CACHE = 'rm-banc-telephone-v1';
export const ETATS_CACHE = Object.freeze(['touche', 'manque', 'indisponible', 'corrompu', 'perime']);
export const ECRITURE_MAX_MS = 15000;     // attente de la fin de l'écriture au cache, une fois les octets reçus ; au-delà : « echec » (l'entrée reste ou non : jamais crue sans vérification)

const erreur = detail => Object.assign(new Error(detail), { detail });

/** Remplit UN tableau préalloué à `total` octets depuis un flux (ni arrayBuffer() ni copie). Lève { detail } si le flux porte plus ou moins que `total`. surProgres(recu, total) à chaque morceau. */
export async function lireCorps(corps, total, surProgres = null) {
    const tampon = new Uint8Array(total); let recu = 0;
    const lecteur = corps.getReader();
    for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        if (recu + value.length > total) { try { await lecteur.cancel(); } catch { /* flux déjà fermé */ } throw erreur('telechargement-modele : plus d\'octets que annonce'); }
        tampon.set(value, recu); recu += value.length;
        if (surProgres) { try { surProgres(recu, total); } catch { /* l'affichage ne casse pas la lecture */ } }
    }
    if (recu !== total) throw erreur(`telechargement-modele : ${recu} octets recus sur ${total}`);
    return tampon;
}

const delai = ms => new Promise(r => setTimeout(() => r('echec'), ms));

/**
 * Des octets, par le cache durable puis le réseau. Dépendances toutes injectables :
 *   revalider({ etag }) : (async, facultatif) 'valide' | 'change' | 'inconnu' — le serveur dit si le fichier rangé est périmé (l'étiquette du serveur est rangée avec l'entrée) ; 'change' ⇒ entrée retirée, réseau ·
 *   cle : l'adresse (clé du cache) · reseau() : (async) une Response réseau, qui LÈVE comme l'appelant l'entend (cette fonction ne classe pas les erreurs réseau) · caches : Cache Storage ou absent ·
 *   octetsAttendus : la taille connue (0 si inconnue : on se fie à Content-Length) · verifier(octets) : (async) true si le contenu est le bon (défaut : oui) · surProgres(recu, total) · surPhase(nom, 'debut'|'fin') · maintenant()
 * Rend { octets, source: 'cache'|'reseau', cache: 'touche'|'manque'|'indisponible'|'corrompu'|'perime', ecriture: 'ok'|'echec'|'sans', verifie, ms: { cacheLecture, reseau, verif } }.
 * `verifie` est false si le contenu REÇU du réseau est refusé par verifier (l'entrée est alors retirée du cache) : l'appelant lève.
 */
export async function chargerOctets({ cle, reseau, caches, nomCache = NOM_CACHE, octetsAttendus = 0, verifier = async () => true, revalider = null, attendreEcriture = true, surProgres = null, surPhase = () => {}, maintenant = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), delaiEcritureMs = ECRITURE_MAX_MS }) {
    const phase = (nom, etat) => { try { surPhase(nom, etat); } catch { /* sans effet */ } };
    const ms = { cacheLecture: null, reseau: null, verif: null };
    let cache = null, etat = 'indisponible';
    try { if (caches && typeof caches.open === 'function') { cache = await caches.open(nomCache); etat = 'manque'; } } catch { cache = null; etat = 'indisponible'; }
    const retirer = async () => { try { if (cache) await cache.delete(cle); } catch { /* sans effet */ } };
    // `sha` : le sha256 que le SERVEUR a publié pour ces octets (X-Rm-Sha256) — lu sur la réponse réseau, ou sur l'entrée du cache qui l'a rangé ; null si le fichier n'en publie pas (le modèle : son sha est dans la page)
    const verifierOctets = async (octets, sha = null) => { phase('verification', 'debut'); const t = maintenant(); let ok = false; try { ok = (await verifier(octets, { sha })) === true; } catch { ok = false; } ms.verif = maintenant() - t; phase('verification', 'fin'); return ok; };

    if (cache) {
        try {
            const entree = await cache.match(cle);
            if (entree && entree.ok && entree.body) {
                const total = Number(entree.headers.get('content-length')) || 0;
                let perime = false;
                if (total && (!octetsAttendus || total === octetsAttendus)) {
                    // la revalidation (le serveur dit-il que ce fichier a changé ?) tourne PENDANT la lecture du cache : elle ne coûte pas un aller-retour de plus. Sans réponse (hors ligne) : on garde le cache.
                    const shaRange = entree.headers.get('x-rm-sha256');
                    const reval = revalider ? Promise.resolve().then(() => revalider({ etag: entree.headers.get('x-rm-etag'), sha: shaRange })).then(v => v, () => 'inconnu') : Promise.resolve('inconnu');
                    phase('cache-lecture', 'debut'); const t = maintenant();
                    let octets = null; try { octets = await lireCorps(entree.body, total, surProgres); } catch { octets = null; }
                    ms.cacheLecture = maintenant() - t; phase('cache-lecture', 'fin');
                    perime = (await reval) === 'change';
                    if (octets && !perime && await verifierOctets(octets, shaRange)) return { octets, source: 'cache', cache: 'touche', ecriture: 'sans', finEcriture: Promise.resolve('sans'), verifie: true, ms };
                }
                etat = perime ? 'perime' : 'corrompu'; await retirer();     // une entrée périmée, de la mauvaise taille, illisible ou refusée : retirée, le réseau la remplace
            }
        } catch { etat = 'indisponible'; cache = null; }
    }

    phase('telechargement', 'debut'); const t0 = maintenant();
    const rep = await reseau();                                  // peut lever : l'appelant a ses propres codes d'erreur
    // fetch DÉCOMPRESSE : Content-Length est la taille du corps compressé ; l'API dit la taille décompressée dans X-Rm-Octets (le modèle, servi par R2 sans encodage, n'en a pas : Content-Length fait foi)
    const total = Number(rep.headers.get('x-rm-octets')) || Number(rep.headers.get('content-length')) || octetsAttendus;
    if (!total) throw erreur('telechargement-modele : taille inconnue');
    let corps = rep.body, ecriture = null, sorti = 'sans', erreurEcriture = null;
    if (cache) {
        try {
            const [pourNous, pourLeCache] = rep.body.tee(); corps = pourNous;
            const entetes = { 'content-length': String(total), 'content-type': 'application/octet-stream' }; const etiquette = rep.headers.get('etag'); if (etiquette) entetes['x-rm-etag'] = etiquette;
            const shaServeur = rep.headers.get('x-rm-sha256'); if (shaServeur) entetes['x-rm-sha256'] = shaServeur;
            ecriture = cache.put(cle, new Response(pourLeCache, { status: 200, headers: entetes })).then(() => 'ok', e => { erreurEcriture = `${(e && e.name) || 'erreur'}:${(e && e.message) || ''}`.replace(/[^\x20-\x7E]/g, '?').slice(0, 100); return 'echec'; });
        } catch { corps = rep.body; ecriture = null; }
    }
    const octets = await lireCorps(corps, total, surProgres);
    ms.reseau = maintenant() - t0; phase('telechargement', 'fin');
    const verifie = await verifierOctets(octets, rep.headers.get('x-rm-sha256'));
    const finir = () => Promise.race([ecriture, delai(delaiEcritureMs)]);
    if (!verifie) { if (ecriture) { phase('ecriture-cache', 'debut'); await finir(); phase('ecriture-cache', 'fin'); } await retirer(); return { octets, source: 'reseau', cache: etat, ecriture: 'sans', finEcriture: Promise.resolve('sans'), erreurEcriture, verifie, ms }; }
    if (!ecriture) return { octets, source: 'reseau', cache: etat, ecriture: 'sans', finEcriture: Promise.resolve('sans'), erreurEcriture, verifie, ms };
    if (!attendreEcriture) {
        // la session peut commencer tout de suite : l'écriture du cache continue ; `finEcriture` dit « ok » ou « echec » quand elle est finie (erreurEcriture est alors renseignée)
        return { octets, source: 'reseau', cache: etat, ecriture: 'en-cours', finEcriture: finir().then(r => { sorti = r; return r; }), get erreurEcriture() { return erreurEcriture; }, verifie, ms };
    }
    phase('ecriture-cache', 'debut'); sorti = await finir(); phase('ecriture-cache', 'fin');       // l'attente est DITE : l'écran ne reste pas sur « 113 / 113 Mo » pendant l'écriture
    return { octets, source: 'reseau', cache: etat, ecriture: sorti, finEcriture: Promise.resolve(sorti), erreurEcriture, verifie, ms };
}

/** Retire des clés du cache (après un échec de session dont les octets venaient du cache : le prochain essai repart du réseau). Ne lève jamais. */
export async function retirerEntrees({ caches, nomCache = NOM_CACHE, cles = [] }) {
    try {
        if (!caches || typeof caches.open !== 'function') return;
        const cache = await caches.open(nomCache);
        for (const c of cles) { try { await cache.delete(c); } catch { /* sans effet */ } }
    } catch { /* sans effet */ }
}

/** La page prépare-t-elle seule, dès son ouverture ? { auto, raison }. Écrite par ce qui REFUSE précisément (rien d'autre ne bloque) : `?prep=0`, une préparation précédente jamais finie (onglet tué : marqueur « en-cours »), moins de 2 Go déclarés. */
export function peutPreparerSeul({ marqueur, deviceMemory, recherche, saveData } = {}) {
    let prep = null; try { prep = typeof recherche === 'string' ? new URLSearchParams(recherche).get('prep') : null; } catch { prep = null; }
    if (prep === '0') return { auto: false, raison: 'demande' };
    // le marqueur : seuls « absent » et « ferme » (page cachée ou quittée avec une session prête) autorisent ; « en-cours » / « pret » restés tels quels = l'onglet est mort VISIBLE (mémoire ?) ; « echec » ne se relance pas seul
    // (un échec déterministe, par exemple le CORS du bucket, recommencerait à chaque ouverture) ; tout autre mot est inconnu et bloque
    if (marqueur === 'en-cours' || marqueur === 'pret') return { auto: false, raison: 'interrompue' };
    if (marqueur === 'echec') return { auto: false, raison: 'echec' };
    if (!(marqueur === null || marqueur === undefined || marqueur === 'ferme')) return { auto: false, raison: 'inconnu' };
    if (saveData === true) return { auto: false, raison: 'data-economie' };       // 113 Mo ne partent pas sans geste quand le navigateur demande d'économiser les données
    // la mémoire de l'appareil : ABSENTE (Safari/iOS ne la donne pas) autorise — décision de l'éditeur : la préparation à l'ouverture se mesure sur iPhone, et le marqueur protège après un onglet tué ;
    // présente, elle doit être un nombre fini d'au moins 2 (Go) ; toute autre valeur bloque
    if (!(deviceMemory === undefined || deviceMemory === null || (typeof deviceMemory === 'number' && Number.isFinite(deviceMemory) && deviceMemory >= 2))) return { auto: false, raison: 'memoire-faible' };
    return { auto: true, raison: 'ok' };
}

export const mediane = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
export const p95 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] : null; };
