'use strict';
// GALERIE — les formes admises, écrites par ce qu'elles AUTORISENT (liste fermée, tout le reste est refusé). Aucune dépendance sur une base.
const crypto = require('crypto');

const CATEGORIES = Object.freeze(['methode-michi', 'couleur', 'master-set', 'illustrateur', 'saison', 'japonais', 'vintage']);
const TRIS_PUBLICATIONS = Object.freeze(['tendances', 'top', 'nouveautes']);
const FORMATS_ART = Object.freeze(['1', '2h', '2v', '4']);
const RAPPORT_FORMAT = Object.freeze({ '1': 63 / 88, '2h': 126 / 88, '2v': 63 / 176, '4': 126 / 176 });   // largeur / hauteur : 63 × 88 par pochette
const TOLERANCE_RAPPORT = 0.05;
const MOTIFS = Object.freeze(['droits', 'illustration-officielle', 'scan-de-carte', 'choquant', 'donnees-personnelles', 'harcelement', 'hors-sujet', 'autre']);
const DECISIONS = Object.freeze(['accepter', 'refuser', 'retirer', 'classer']);
const TYPES_IMAGE = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const PSEUDOS_RESERVES = Object.freeze(['admin', 'administrateur', 'administrator', 'moderation', 'moderateur', 'moderator', 'modo', 'mod', 'rat-market', 'ratmarket', 'rat_market', 'support', 'contact',
    'officiel', 'official', 'staff', 'system', 'systeme', 'root', 'null', 'undefined', 'anonyme', 'anonymous', 'api', 'site', 'equipe', 'team', 'aide', 'help', 'cardmarket', 'pokemon', 'nintendo', 'tpc']);
const RE_ID = /^[A-Za-z0-9_-]{16,64}$/;                         // un identifiant opaque (base64url, 128 bits = 22 caractères)
const RE_PSEUDO = /^[a-z0-9_-]{3,20}$/;
const RE_ID_MODERATION = /^(pub|art|sig)\.([A-Za-z0-9_-]{16,64})$/;
const RE_CIBLE = /^(galerie|banque):([A-Za-z0-9_-]{16,64})$/;

const nouvelId = () => crypto.randomBytes(16).toString('base64url');   // 128 bits, 22 caractères
const idValide = s => typeof s === 'string' && RE_ID.test(s);
const objet = b => b !== null && typeof b === 'object' && !Array.isArray(b);
const cles = (o, permises) => Object.keys(o).every(k => permises.includes(k));

/** Un texte libre : texte brut, borné, jamais interprété. null si valide, sinon le `detail`. Ni `data:` (donnée binaire), ni caractère de contrôle (hors saut de ligne si permis). */
function problemeTexte(v, { min = 0, max, lignes = false } = {}) {
    if (typeof v !== 'string') return 'type';
    const s = v.normalize('NFKC');
    if (s.length < min || s.length > max) return 'longueur';
    if (/^\s*data:/i.test(s)) return 'donnee-binaire';
    if (lignes ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/.test(s) : /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(s)) return 'caractere';
    return null;
}
/** Le pseudo normalisé (minuscules), ou { detail }. `@` est refusé par la forme (jamais une adresse). */
function lirePseudo(v) {
    if (typeof v !== 'string' || v.length > 64) return { detail: 'pseudo-invalide' };
    const p = v.normalize('NFKC').trim().toLowerCase();
    if (!RE_PSEUDO.test(p)) return { detail: 'pseudo-invalide' };
    if (PSEUDOS_RESERVES.includes(p.replace(/[-_]/g, '')) || PSEUDOS_RESERVES.includes(p)) return { detail: 'pseudo-reserve' };
    return { pseudo: p };
}
/** Le curseur `suite` : opaque, un décalage. null/absent → 0. { detail } si le curseur est illisible. */
function lireSuite(v) {
    if (v === undefined || v === '') return { o: 0 };
    if (typeof v !== 'string' || v.length > 64) return { detail: 'suite' };
    try { const j = JSON.parse(Buffer.from(v, 'base64url').toString('utf8')); if (objet(j) && Number.isInteger(j.o) && j.o >= 0 && j.o <= 20000) return { o: j.o }; } catch { /* illisible */ }
    return { detail: 'suite' };
}
const ecrireSuite = o => Buffer.from(JSON.stringify({ o }), 'utf8').toString('base64url');
const echapperRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { CATEGORIES, TRIS_PUBLICATIONS, FORMATS_ART, RAPPORT_FORMAT, TOLERANCE_RAPPORT, MOTIFS, DECISIONS, TYPES_IMAGE, PSEUDOS_RESERVES, RE_ID, RE_PSEUDO, RE_ID_MODERATION, RE_CIBLE,
    nouvelId, idValide, objet, cles, problemeTexte, lirePseudo, lireSuite, ecrireSuite, echapperRegex };
