// ============================================================
// LA PRÉPARATION DU PREMIER SCAN : cache durable des octets (modèle de 113 Mo, moteur .wasm de 14 Mo), garde de la préparation en arrière-plan, petites statistiques — logique pure, injectable, sans DOM
// ============================================================
// Pourquoi (mesure, RAPPORT-PREMIER-SCAN.md) : sur la page de banc, ~15 s de « création de session » étaient en réalité le TÉLÉCHARGEMENT du .wasm d'ORT (14 Mo) servi par l'API, que ORT va chercher
// lui-même à l'intérieur de InferenceSession.create ; le graphe et la compilation en prennent ~1 s. Ce module range le modèle et le moteur dans Cache Storage (durable, jamais retéléchargés tant
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
export async function chargerOctets({ cle, reseau, caches, nomCache = NOM_CACHE, octetsAttendus = 0, verifier = async () => true, revalider = null, surProgres = null, surPhase = () => {}, maintenant = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), delaiEcritureMs = ECRITURE_MAX_MS }) {
    const phase = (nom, etat) => { try { surPhase(nom, etat); } catch { /* sans effet */ } };
    const ms = { cacheLecture: null, reseau: null, verif: null };
    let cache = null, etat = 'indisponible';
    try { if (caches && typeof caches.open === 'function') { cache = await caches.open(nomCache); etat = 'manque'; } } catch { cache = null; etat = 'indisponible'; }
    const retirer = async () => { try { if (cache) await cache.delete(cle); } catch { /* sans effet */ } };
    const verifierOctets = async octets => { phase('verification', 'debut'); const t = maintenant(); let ok = false; try { ok = (await verifier(octets)) === true; } catch { ok = false; } ms.verif = maintenant() - t; phase('verification', 'fin'); return ok; };

    if (cache) {
        try {
            const entree = await cache.match(cle);
            if (entree && entree.ok && entree.body) {
                const total = Number(entree.headers.get('content-length')) || 0;
                let perime = false;
                if (total && (!octetsAttendus || total === octetsAttendus)) {
                    // la revalidation (le serveur dit-il que ce fichier a changé ?) tourne PENDANT la lecture du cache : elle ne coûte pas un aller-retour de plus. Sans réponse (hors ligne) : on garde le cache.
                    const reval = revalider ? Promise.resolve().then(() => revalider({ etag: entree.headers.get('x-rm-etag') })).then(v => v, () => 'inconnu') : Promise.resolve('inconnu');
                    phase('cache-lecture', 'debut'); const t = maintenant();
                    let octets = null; try { octets = await lireCorps(entree.body, total, surProgres); } catch { octets = null; }
                    ms.cacheLecture = maintenant() - t; phase('cache-lecture', 'fin');
                    perime = (await reval) === 'change';
                    if (octets && !perime && await verifierOctets(octets)) return { octets, source: 'cache', cache: 'touche', ecriture: 'sans', verifie: true, ms };
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
            ecriture = cache.put(cle, new Response(pourLeCache, { status: 200, headers: entetes })).then(() => 'ok', e => { erreurEcriture = `${(e && e.name) || 'erreur'}:${(e && e.message) || ''}`.replace(/[^\x20-\x7E]/g, '?').slice(0, 100); return 'echec'; });
        } catch { corps = rep.body; ecriture = null; }
    }
    const octets = await lireCorps(corps, total, surProgres);
    ms.reseau = maintenant() - t0; phase('telechargement', 'fin');
    const verifie = await verifierOctets(octets);
    if (ecriture) { sorti = await Promise.race([ecriture, delai(delaiEcritureMs)]); }
    if (!verifie) { if (ecriture) await Promise.race([ecriture, delai(delaiEcritureMs)]); await retirer(); sorti = 'sans'; }
    return { octets, source: 'reseau', cache: etat, ecriture: cache ? sorti : 'sans', erreurEcriture, verifie, ms };
}

/** La page prépare-t-elle seule, dès son ouverture ? { auto, raison }. Écrite par ce qui REFUSE précisément (rien d'autre ne bloque) : `?prep=0`, une préparation précédente jamais finie (onglet tué : marqueur « en-cours »), moins de 2 Go déclarés. */
export function peutPreparerSeul({ marqueur, deviceMemory, recherche }) {
    let prep = null; try { prep = typeof recherche === 'string' ? new URLSearchParams(recherche).get('prep') : null; } catch { prep = null; }
    if (prep === '0') return { auto: false, raison: 'demande' };
    if (marqueur === 'en-cours' || marqueur === 'pret') return { auto: false, raison: 'interrompue' };   // « ferme » est écrit quand la page est cachée ou quittée : un marqueur resté « en-cours » ou « pret » = l'onglet est mort VISIBLE (mémoire ?)
    if (typeof deviceMemory === 'number' && Number.isFinite(deviceMemory) && deviceMemory < 2) return { auto: false, raison: 'memoire-faible' };
    return { auto: true, raison: 'ok' };
}

export const mediane = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
export const p95 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] : null; };
