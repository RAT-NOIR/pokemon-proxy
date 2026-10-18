'use strict';
// PHOTOS-MULTIPLES (7d) — le MAGASIN des photos reçues AVANT le scan (POST /api/photo), et la façon dont la chaîne les reçoit.
// 🔑 EN MÉMOIRE SEULEMENT : ce fichier n'importe ni la base, ni le disque, ni le réseau (un banc le prouve). Une photo, de sa réception à sa libération, vit 120 s AU PLUS :
//   · SERVICE_S = 30 s : une photo n'est SERVIE (`prendre`) que dans les 30 s qui suivent son dépôt ; une photo non servie est RETIRÉE à cette échéance exacte, par SON PROPRE minuteur (unref) — pas au prochain balayage ;
//   · SCAN_MAX_S = 90 s : le scan est borné à 90 s (la borne de l'extension) ; une photo servie est LIBÉRÉE à la fin de la réponse (`libererPhotos`) ;
//   · 30 + 90 = 120 = VIE_MAX_S. Un banc lit les trois constantes et échoue si la somme dépasse : allonger l'une sans l'autre se voit.
// Liée à SON porteur, SERT UNE FOIS (`prendre` la retire). Bornes PAR PORTEUR (contrat 7d) : au plus 8 photos et 8 Mio au total ; au-delà, la PLUS ANCIENNE est oubliée. Une borne globale (64 Mio, toutes les photos de tous les porteurs)
// protège le processus : la plus ancienne du service est alors oubliée (phase 1 : administrateur seul ; à resserrer par porteur AVANT la phase 2). Aucune photo n'est journalisée ; aucun octet ne figure dans une erreur.
// Les identifiants sont tirés par crypto.randomBytes : 32 hexadécimaux, non devinables.
const crypto = require('crypto');

const SERVICE_S = 30, SCAN_MAX_S = 90, VIE_MAX_S = 120;
const PHOTOS_MAX = 8, MIO = 1024 * 1024, OCTETS_MAX = 8 * MIO, PHOTO_OCTETS_MAX = 2 * MIO, GLOBAL_OCTETS_MAX = 64 * MIO;

/** @param {{ horloge?: () => number, serviceMs?: number }} [o] — `horloge` et `serviceMs` : injectables par les bancs (millisecondes). */
function creerPhotosRecues({ horloge = Date.now, serviceMs = SERVICE_S * 1000 } = {}) {
    const parPorteur = new Map();                       // cle de porteur -> [{ photoId, index, octets, modele, expireA, n, minuteur }] (ordre de dépôt : la plus ancienne en tête)
    let ordre = 0;
    const taillePhoto = p => p.octets.length + (p.modele ? p.modele.length : 0);          // la photo ET sa version réduite pour le modèle : les deux sont en mémoire, les deux comptent dans les bornes
    const total = l => l.reduce((s, p) => s + taillePhoto(p), 0);
    const oublier = (cle, l) => { if (!l.length) parPorteur.delete(cle); };
    const arreterMinuteur = p => { if (p.minuteur) { clearTimeout(p.minuteur); p.minuteur = null; } };
    function retirer(cle, p) {                           // retire UNE photo (et son minuteur) du magasin, par identité
        const l = parPorteur.get(cle); if (!l) return;
        const i = l.indexOf(p); if (i >= 0) l.splice(i, 1);
        arreterMinuteur(p); oublier(cle, l);
    }
    function purgerExpirees() {
        const maintenant = horloge();
        for (const [cle, l] of [...parPorteur]) for (const p of [...l]) if (p.expireA <= maintenant) retirer(cle, p);
    }
    /** Retient une photo ; rend son identifiant. `modele` (facultatif) : la version réduite (800 px) que reçoit le modèle ; sans elle, `octets` sert aux deux usages.
     *  Lève { code: 'trop-grosse' } au-delà de 2 Mio (la route l'a déjà refusée avant : ceinture et bretelles). */
    function deposer(cle, index, octets, modele) {
        if (!Buffer.isBuffer(octets) || octets.length === 0) throw Object.assign(new Error('photo'), { code: 'format' });
        if (octets.length > PHOTO_OCTETS_MAX) throw Object.assign(new Error('photo'), { code: 'trop-grosse' });
        purgerExpirees();
        const photoId = crypto.randomBytes(16).toString('hex');
        let l = parPorteur.get(cle); if (!l) { l = []; parPorteur.set(cle, l); }
        const p = { photoId, index, octets, modele: Buffer.isBuffer(modele) && modele.length ? modele : null, expireA: horloge() + serviceMs, n: ++ordre, minuteur: null };
        p.minuteur = setTimeout(() => retirer(cle, p), serviceMs); p.minuteur.unref();          // l'échéance exacte : la photo non servie est retirée par elle-même
        l.push(p);
        while (l.length > PHOTOS_MAX || total(l) > OCTETS_MAX) { const vieille = l.shift(); arreterMinuteur(vieille); }          // la plus ancienne de CE porteur est oubliée
        let globale = 0; for (const x of parPorteur.values()) globale += total(x);
        while (globale > GLOBAL_OCTETS_MAX) {                                                  // la plus ancienne du SERVICE
            let cibleCle = null, cibleN = Infinity;
            for (const [k, x] of parPorteur) if (x.length && x[0].n < cibleN) { cibleN = x[0].n; cibleCle = k; }
            if (cibleCle === null) break;
            const x = parPorteur.get(cibleCle), vieille = x.shift(); globale -= taillePhoto(vieille); arreterMinuteur(vieille); oublier(cibleCle, x);
        }
        return photoId;
    }
    /** Rend { index, octets, modele } et RETIRE la photo (elle ne sert qu'une fois), ou null : inconnue, expirée (30 s), ou d'un autre porteur (alors elle n'est PAS touchée). */
    function prendre(cle, photoId) {
        const l = parPorteur.get(cle); if (!l) return null;
        const p = l.find(x => x.photoId === photoId); if (!p) return null;
        retirer(cle, p);
        return p.expireA > horloge() ? { index: p.index, octets: p.octets, modele: p.modele } : null;
    }
    function taille(cle) { purgerExpirees(); const l = parPorteur.get(cle) || []; return { photos: l.length, octets: total(l) }; }
    /** Le nombre de photos retenues pour un porteur, SANS purge à l'accès (le banc prouve par là que le minuteur seul suffit). */
    function compter(cle) { return (parPorteur.get(cle) || []).length; }
    function arreter() { for (const l of parPorteur.values()) for (const p of l) arreterMinuteur(p); parPorteur.clear(); }
    return { deposer, prendre, taille, compter, arreter };
}
Object.assign(creerPhotosRecues, { SERVICE_S, SCAN_MAX_S, VIE_MAX_S, PHOTOS_MAX, OCTETS_MAX, PHOTO_OCTETS_MAX, GLOBAL_OCTETS_MAX });

let parDefaut = null;
/** Le magasin du processus (un seul : les routes /api/photo et /api/identifier le partagent). Un banc injecte le sien par `deps.photosRecues`. */
const magasin = (deps) => (deps && deps.photosRecues && typeof deps.photosRecues.deposer === 'function' ? deps.photosRecues : (parDefaut || (parDefaut = creerPhotosRecues())));

/** Les images que la CHAÎNE reçoit (le modèle, le lot, la règle G, la détection du banc) : si des photos ont été REÇUES pour ce scan, leurs OCTETS (`data:`, dans l'ordre des index) et rien d'autre — aucune URL, donc
 *  aucun téléchargement chez Vinted par aucun maillon ; sinon les URLs de l'annonce, comme aujourd'hui. */
function imagesDeLaChaine(entree) {
    const recues = entree && Array.isArray(entree.photosRecues) ? entree.photosRecues : [];
    if (!recues.length) return entree ? entree.imageUrls : [];
    // Ce que reçoit le MODÈLE : la version réduite à 800 px au plus de grand côté (la définition f800 que Vinted sert aujourd'hui), jamais la photo du banc (1 600 px). Encodée en base64 UNE fois par scan (mémorisée sur la photo).
    return [...recues].sort((a, b) => a.index - b.index).map(p => p.dataUrl || (p.dataUrl = `data:image/jpeg;base64,${(p.modele || p.octets).toString('base64')}`));
}

/** LIBÈRE les octets d'un scan à la fin de la réponse (I-2) : le Buffer de chaque photo, sa version réduite, son `dataUrl` mémorisé, `photosRecues` et `imageOctets` de l'entrée. Après cet appel, plus rien de ce module ni de
 *  `req.entree` ne référence la photo d'un utilisateur. Seule exception, nommée : la tâche du banc de l'ADMINISTRATEUR (banc/photo-admin.js) a pris sa propre référence à l'index 0 avant la réponse. */
function libererPhotos(entree) {
    if (!entree) return;
    if (Array.isArray(entree.photosRecues)) for (const p of entree.photosRecues) { p.octets = null; p.modele = null; p.dataUrl = null; }
    if ('photosRecues' in entree) entree.photosRecues = [];
    if ('imageOctets' in entree) entree.imageOctets = null;
}

module.exports = { creerPhotosRecues, magasin, imagesDeLaChaine, libererPhotos };
