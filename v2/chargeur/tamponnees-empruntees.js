'use strict';
// TAMPONNÉES-EMPRUNTÉES — la LISTE FERMÉE de l'admission (D) (decision.js), telle que la construction de l'archive la reçoit : UN fichier, dont l'empreinte SHA-256 est ÉPINGLÉE par l'appelant (comme la liste des JUMBO).
// Garde écrite par ce qu'elle AUTORISE : tout ce qui n'est pas exactement la forme prévue est refusé, avec sa raison, et la construction s'arrête.
//   { decision: texte, le: 'AAAA-MM-JJ', produits: [{ idProduct: entier > 0, preuve: texte non vide }] } — rien d'autre, aucun idProduct en double, 5 000 lignes au plus, 1 Mio au plus.
// La preuve de chaque ligne est celle de v2/mesures/preuve-emprunt.js (la preuve STRICTE à l'image) : elle voyage dans la liste, jamais dans l'archive.
const fs = require('fs');
const crypto = require('crypto');

const TAILLE_MAX = 1048576, PRODUITS_MAX = 5000, TEXTE_MAX = 2000, PREUVE_MAX = 600;
const CLES = Object.freeze(['decision', 'le', 'produits']), CLES_LIGNE = Object.freeze(['idProduct', 'preuve']);
const refus = raison => ({ ok: false, raison });
const objetSimple = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const texte = (x, max) => typeof x === 'string' && x.trim() !== '' && x.length <= max;
const dateValide = s => { const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null; if (!m) return false; const [a, mo, j] = [+m[1], +m[2], +m[3]]; const d = new Date(Date.UTC(a, mo - 1, j)); return a >= 2026 && a <= 2030 && d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j; };

/** @returns {{ ok: true, produits: Set<number>, sha256, decision, le, preuves: Map } | { ok: false, raison }} — ne lève jamais. `sha256Attendu` est OBLIGATOIRE (64 hexadécimaux minuscules). */
function lireFichierTamponnees(chemin, { sha256Attendu } = {}) {
    if (typeof sha256Attendu !== 'string' || !/^[0-9a-f]{64}$/.test(sha256Attendu)) return refus('l\'empreinte de la copie doit être épinglée (64 hexadécimaux minuscules) : une liste dont on ne connaît pas l\'empreinte n\'est pas reconnue');
    if (typeof chemin !== 'string' || !chemin.trim()) return refus('aucun fichier nommé');
    let st; try { st = fs.statSync(chemin); } catch { return refus('le fichier est introuvable ou illisible'); }
    if (!st.isFile()) return refus('ce n\'est pas un fichier');
    if (st.size === 0 || st.size > TAILLE_MAX) return refus(`le fichier est vide ou dépasse ${TAILLE_MAX} octets`);
    let octets; try { octets = fs.readFileSync(chemin); } catch { return refus('le fichier est illisible'); }
    const sha256 = crypto.createHash('sha256').update(octets).digest('hex');
    if (sha256 !== sha256Attendu) return refus(`l'empreinte du fichier (${sha256}) n'est pas celle qui est épinglée : la liste est périmée ou modifiée`);
    let j; try { j = JSON.parse(octets.toString('utf8')); } catch { return refus('le fichier n\'est pas du JSON lisible'); }
    if (!objetSimple(j)) return refus('la liste doit être un objet { decision, le, produits }');
    const inconnues = Object.keys(j).filter(k => !CLES.includes(k));
    if (inconnues.length) return refus(`clé(s) non prévue(s) : ${inconnues.join(', ')}`);
    if (!texte(j.decision, TEXTE_MAX)) return refus('`decision` : un texte non vide est attendu');
    if (!dateValide(j.le)) return refus('`le` : une date AAAA-MM-JJ valide (2026 à 2030) est attendue');
    if (!Array.isArray(j.produits) || j.produits.length === 0) return refus('`produits` : un tableau non vide est attendu');
    if (j.produits.length > PRODUITS_MAX) return refus(`plus de ${PRODUITS_MAX} lignes`);
    const produits = new Set(), preuves = new Map();
    for (let i = 0; i < j.produits.length; i++) {
        const l = j.produits[i], ou = `ligne ${i}`;
        if (!objetSimple(l)) return refus(`${ou} : un objet { idProduct, preuve } est attendu`);
        const en_trop = Object.keys(l).filter(k => !CLES_LIGNE.includes(k)); if (en_trop.length) return refus(`${ou} : clé(s) non prévue(s) : ${en_trop.join(', ')}`);
        if (!Number.isSafeInteger(l.idProduct) || l.idProduct <= 0) return refus(`${ou} : idProduct doit être un entier > 0`);
        if (!texte(l.preuve, PREUVE_MAX)) return refus(`${ou} : la preuve (un texte non vide, ${PREUVE_MAX} caractères au plus) est obligatoire`);
        if (produits.has(l.idProduct)) return refus(`${ou} : idProduct ${l.idProduct} en double`);
        produits.add(l.idProduct); preuves.set(l.idProduct, l.preuve);
    }
    return { ok: true, produits, preuves, sha256, decision: j.decision, le: j.le };
}

/**
 * La CIBLE de la liste : l'ESSAI seulement. Écrite par ce qu'elle autorise : `V2_CIBLE` doit valoir exactement « essai » ; avec un dépôt, le bucket visé (V2_VISUELS_R2_BUCKET) doit être EXACTEMENT celui que
 * V2_VISUELS_ESSAI_BUCKET nomme (les deux non vides). Tout le reste, y compris une variable absente, est refusé.
 * @returns {{ ok: true } | { ok: false, raison }}
 */
function cibleEstEssai(env, { deposer = false } = {}) {
    if (!env || env.V2_CIBLE !== 'essai') return refus('la liste des tamponnées empruntées ne sert qu\'à l\'ESSAI : V2_CIBLE doit valoir exactement « essai »');
    if (deposer) {
        const vise = typeof env.V2_VISUELS_R2_BUCKET === 'string' ? env.V2_VISUELS_R2_BUCKET.trim() : '', essai = typeof env.V2_VISUELS_ESSAI_BUCKET === 'string' ? env.V2_VISUELS_ESSAI_BUCKET.trim() : '';
        if (!vise || !essai || vise !== essai) return refus('avec --deposer, le bucket visé (V2_VISUELS_R2_BUCKET) doit être celui de l\'essai nommé par V2_VISUELS_ESSAI_BUCKET : l\'un manque ou ils diffèrent, je ne peux pas conclure que la cible est l\'essai');
    }
    return { ok: true };
}

module.exports = { lireFichierTamponnees, cibleEstEssai, TAILLE_MAX, PRODUITS_MAX };
