'use strict';
// PHOTO-EXTENSION — l'analyseur JSON GLOBAL de l'API. Avant : `express.json()` (100 ko pour toutes les routes). Une image en base64 (jusqu'à 2 Mio décodés, soit ~2,7 Mio) ne tient pas dans 100 ko.
// Écrit par ce qu'il AUTORISE : la limite large (4 Mio) ne s'applique QU'À un `POST /api/identifier` portant un en-tête `Authorization: Bearer <jeton>` (le scan v2 de l'extension). Tout le reste —
// une autre route, une autre méthode, une requête sans Bearer (la route héritée, un robot) — garde la limite d'avant (100 ko) : la surface de lecture de gros corps non authentifiés ne grandit pas
// au-delà d'un en-tête à écrire, et reste derrière les limiteurs de l'IP (la lecture se fait avant eux : c'est le coût accepté, 4 Mio au plus par requête, un corps plus grand = 413).
// Le chemin est jugé comme Express le route : sans casse, sans barre finale.
const express = require('express');

const LIMITE_SCAN_OCTETS = 4 * 1024 * 1024;
const BEARER = /^Bearer \S+$/;
const estScanV2 = (req) => req.method === 'POST' && String(req.path || '').toLowerCase().replace(/\/+$/, '') === '/api/identifier' && BEARER.test(String((req.headers && req.headers.authorization) || ''));

function json() {
    const petit = express.json(), grand = express.json({ limit: LIMITE_SCAN_OCTETS });
    return (req, res, next) => (estScanV2(req) ? grand : petit)(req, res, next);
}

module.exports = { json, estScanV2, LIMITE_SCAN_OCTETS };
