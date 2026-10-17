'use strict';
// PHOTOS-MULTIPLES (7d) — le MAGASIN des photos reçues AVANT le scan (POST /api/photo), et la façon dont la chaîne les reçoit.
// 🔑 EN MÉMOIRE SEULEMENT : ce fichier n'importe ni la base, ni le disque, ni le réseau (un banc le prouve). Une photo y vit 120 s au plus, liée à SON porteur, et SERT UNE FOIS (`prendre` la retire).
// Bornes PAR PORTEUR (contrat 7d) : au plus 8 photos et 8 Mio au total ; au-delà, la PLUS ANCIENNE est oubliée. Une borne globale (64 Mio, toutes les photos de tous les porteurs) protège le processus le jour où la phase 2
// ouvrira la route à tous : la plus ancienne du service est alors oubliée. Aucune photo n'est journalisée ; aucun octet ne figure dans une erreur.
// Les identifiants sont tirés par crypto.randomBytes : 32 hexadécimaux, non devinables.
const crypto = require('crypto');

const TTL_S = 120, PHOTOS_MAX = 8, MIO = 1024 * 1024, OCTETS_MAX = 8 * MIO, PHOTO_OCTETS_MAX = 2 * MIO, GLOBAL_OCTETS_MAX = 64 * MIO;
const BALAYAGE_MS = 30 * 1000;

/** @param {{ horloge?: () => number }} [o] — `horloge` : injectable par les bancs (millisecondes). */
function creerPhotosRecues({ horloge = Date.now } = {}) {
    const parPorteur = new Map();                       // cle de porteur -> [{ photoId, index, octets, expireA, n }] (ordre de dépôt : la plus ancienne en tête)
    let ordre = 0, minuteur = null;
    const total = l => l.reduce((s, p) => s + p.octets.length, 0);
    const oublier = (cle, l) => { if (!l.length) parPorteur.delete(cle); };
    function purgerExpirees() {
        const maintenant = horloge();
        for (const [cle, l] of parPorteur) { for (let i = l.length - 1; i >= 0; i--) if (l[i].expireA <= maintenant) l.splice(i, 1); oublier(cle, l); }
    }
    function armerBalayage() {
        if (minuteur) return;
        minuteur = setInterval(() => { purgerExpirees(); if (!parPorteur.size) { clearInterval(minuteur); minuteur = null; } }, BALAYAGE_MS);
        minuteur.unref();                               // il ne retient jamais le processus
    }
    /** Retient une photo ; rend son identifiant. Lève { code: 'trop-grosse' } au-delà de 2 Mio (la route l'a déjà refusée avant : ceinture et bretelles). */
    function deposer(cle, index, octets) {
        if (!Buffer.isBuffer(octets) || octets.length === 0) throw Object.assign(new Error('photo'), { code: 'format' });
        if (octets.length > PHOTO_OCTETS_MAX) throw Object.assign(new Error('photo'), { code: 'trop-grosse' });
        purgerExpirees();
        const photoId = crypto.randomBytes(16).toString('hex');
        let l = parPorteur.get(cle); if (!l) { l = []; parPorteur.set(cle, l); }
        l.push({ photoId, index, octets, expireA: horloge() + TTL_S * 1000, n: ++ordre });
        while (l.length > PHOTOS_MAX || total(l) > OCTETS_MAX) l.shift();                   // la plus ancienne de CE porteur est oubliée
        let globale = 0; for (const x of parPorteur.values()) globale += total(x);
        while (globale > GLOBAL_OCTETS_MAX) {                                                  // la plus ancienne du SERVICE
            let cibleCle = null, cibleN = Infinity;
            for (const [k, x] of parPorteur) if (x.length && x[0].n < cibleN) { cibleN = x[0].n; cibleCle = k; }
            if (cibleCle === null) break;
            const x = parPorteur.get(cibleCle); globale -= x[0].octets.length; x.shift(); oublier(cibleCle, x);
        }
        armerBalayage();
        return photoId;
    }
    /** Rend { index, octets } et RETIRE la photo (elle ne sert qu'une fois), ou null : inconnue, expirée, ou d'un autre porteur (alors elle n'est PAS touchée). */
    function prendre(cle, photoId) {
        const l = parPorteur.get(cle); if (!l) return null;
        const i = l.findIndex(p => p.photoId === photoId); if (i < 0) return null;
        const [p] = l.splice(i, 1); oublier(cle, l);
        return p.expireA > horloge() ? { index: p.index, octets: p.octets } : null;
    }
    function taille(cle) { purgerExpirees(); const l = parPorteur.get(cle) || []; return { photos: l.length, octets: total(l) }; }
    function arreter() { if (minuteur) { clearInterval(minuteur); minuteur = null; } parPorteur.clear(); }
    return { deposer, prendre, taille, arreter };
}
Object.assign(creerPhotosRecues, { TTL_S, PHOTOS_MAX, OCTETS_MAX, PHOTO_OCTETS_MAX, GLOBAL_OCTETS_MAX });

let parDefaut = null;
/** Le magasin du processus (un seul : les routes /api/photo et /api/identifier le partagent). Un banc injecte le sien par `deps.photosRecues`. */
const magasin = (deps) => (deps && deps.photosRecues && typeof deps.photosRecues.deposer === 'function' ? deps.photosRecues : (parDefaut || (parDefaut = creerPhotosRecues())));

/** Les images que la CHAÎNE reçoit (le modèle, le lot, la règle G, la détection du banc) : si des photos ont été REÇUES pour ce scan, leurs OCTETS (`data:`, dans l'ordre des index) et rien d'autre — aucune URL, donc
 *  aucun téléchargement chez Vinted par aucun maillon ; sinon les URLs de l'annonce, comme aujourd'hui. */
function imagesDeLaChaine(entree) {
    const recues = entree && Array.isArray(entree.photosRecues) ? entree.photosRecues : [];
    if (!recues.length) return entree ? entree.imageUrls : [];
    return [...recues].sort((a, b) => a.index - b.index).map(p => `data:image/jpeg;base64,${p.octets.toString('base64')}`);
}

module.exports = { creerPhotosRecues, magasin, imagesDeLaChaine };
