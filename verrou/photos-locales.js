// ============================================================
// LE JEU DE PHOTOS FIXE DU VERROU — Vinted n'est JAMAIS contacté (décision du testeur, 2026-10-04)
// ============================================================
// « Coupe le téléchargement. Le verrou travaille sur un jeu de photos fixe, conservé en local, et ne contacte jamais Vinted. »
//
// L'OCCURRENCE : le départage par l'image (departage-image.js) télécharge la photo de l'annonce par `fetch`, et rien dans le verrou
// n'interceptait `fetch` — le faux réseau ne patche qu'axios. Trois processus touchaient donc Vinted à chaque passage : la pré-passe
// de l'extraction (verrou-charges.js), le serveur de l'enregistreur, et le serveur rejoué par verrou-avant-push.js. Les photos du
// journal y répondent de plus en plus souvent 404 : une cellule du verrou dépendait de l'état d'un site tiers.
//
// CE QUE CE MODULE FAIT, ET RIEN D'AUTRE : il remplace `globalThis.fetch` dans le processus qui l'installe. Une URL d'un hôte de
// photos (la liste de departage-image.js, HOTES_PHOTO_AUTORISES) est servie depuis `verrou/photos/` si elle est dans le jeu ; hors
// du jeu, elle reçoit un 404 LOCAL — ce que Vinted rend aujourd'hui pour la plupart, et surtout une réponse DÉTERMINISTE : le même
// jeu rend la même sortie, à l'extraction comme au rejeu. Tout autre `fetch` passe inchangé (le faux réseau garde ses règles).
// Le jeu se constitue UNE fois, sans réseau, par verrou/constituer-photos.js ; il n'est pas commité (photos d'annonces).
// 🔑 Une photo dont l'empreinte ne correspond plus à l'index LÈVE : un fichier changé sous le même nom serait un autre jeu.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DOSSIER = path.join(__dirname, 'photos');
const INDEX = path.join(DOSSIER, 'index.json');
// la même liste que departage-image.js (HOTES_PHOTO_AUTORISES) : les seuls hôtes que la chaîne télécharge
const HOTES_PHOTO = [/(^|\.)vinted\.net$/i];

function lireIndex() {
    if (!fs.existsSync(INDEX)) return { photos: {}, absent: true };
    const j = JSON.parse(fs.readFileSync(INDEX, 'utf8').replace(/^﻿/, ''));
    if (!j || typeof j.photos !== 'object') throw new Error(`${INDEX} illisible : champ « photos » absent`);
    return j;
}

/** L'empreinte du JEU (les URL et les sha256, triés) : deux extractions sur deux jeux différents ne se comparent pas. */
function empreinteJeu(photos) {
    const h = crypto.createHash('sha256');
    for (const u of Object.keys(photos).sort()) h.update(`${u}\t${photos[u].sha256}\n`);
    return h.digest('hex').slice(0, 16);
}

function installer({ journal = console, etiquette = 'photos-locales' } = {}) {
    const idx = lireIndex();
    const photos = idx.photos;
    const original = globalThis.fetch;
    const servies = new Set(), refusees = new Set();
    globalThis.fetch = async function (entree, options) {
        const url = typeof entree === 'string' ? entree : (entree?.url ?? String(entree));
        let hote = null;
        try { hote = new URL(url).hostname; } catch (_) { hote = null; }
        if (!hote || !HOTES_PHOTO.some(re => re.test(hote))) return original(entree, options);
        const p = photos[url];
        if (!p) {
            refusees.add(url);
            journal.log(`🔒 [${etiquette}] PHOTO-HORS-JEU ${url.slice(0, 100)} — 404 local, Vinted n'est pas contacté`);
            return new Response(null, { status: 404, statusText: 'photo hors du jeu fixe du verrou' });
        }
        const buf = fs.readFileSync(path.join(DOSSIER, p.fichier));
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        if (sha !== p.sha256) throw new Error(`[${etiquette}] ${p.fichier} : empreinte ${sha.slice(0, 12)} ≠ index ${String(p.sha256).slice(0, 12)} — le jeu fixe a changé`);
        servies.add(url);
        return new Response(buf, { status: 200, headers: { 'content-type': p.type || 'application/octet-stream', 'content-length': String(buf.length) } });
    };
    const n = Object.keys(photos).length;
    const empreinte = empreinteJeu(photos);
    journal.log(`🔒 [${etiquette}] jeu de photos fixe : ${n} photo(s)${idx.absent ? ' (index ABSENT : toute photo rend 404)' : ''} · empreinte ${empreinte} · Vinted jamais contacté`);
    return { n, empreinte, aPhoto: url => Object.prototype.hasOwnProperty.call(photos, url), servies, refusees };
}

module.exports = { installer, lireIndex, empreinteJeu, DOSSIER, INDEX, HOTES_PHOTO };
