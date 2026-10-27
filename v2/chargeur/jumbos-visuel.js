'use strict';
// JUMBO-VISUEL — la liste du catalogue « JUMBO lus contre le scan de leur fiche », telle que l'API la reçoit : UN fichier (copie datée dans rat-market-travail\api\archives\, avec l'empreinte de la liste source et sa date),
// jugé ici par une garde écrite par ce qu'elle AUTORISE (comme exclusions.js) : tout ce qui n'est pas exactement la forme prévue est refusé, avec sa raison, et la construction de l'archive s'arrête.
// Ce module porte trois choses, et rien d'autre (une seule définition, §21 bis) :
//   · VERDICTS / CLASSES — la liste FERMÉE des verdicts du catalogue et la classe qu'ils donnent ;
//   · lireFichierJumbos(chemin) — la GARDE du fichier ;
//   · jugerClasses(map) — la GARDE de la Map idProduct → classe qui entre dans la décision (decision.js) : un appelant qui ne passe pas par le fichier est jugé de la même façon.
// LES DEUX CLASSES (décision du coordinateur, 27/10) :
//   · 'emprunt'     — le JUMBO est IDENTIQUE à la carte de sa fiche (illustration, texte, numéro) : son visuel est celui de la carte normale, EMPRUNTÉ (colonne des emprunts, exclu des règles d'image) et servi avec le
//                     bandeau JUMBO, SANS mention (CONTRAT-MARQUEURS.md §6) ;
//   · 'sans-visuel' — le JUMBO est DIFFÉRENT (logo de set imprimé, badge, trame holo…), ILLISIBLE ou joint à tort à une autre fiche : le scan de la carte normale n'est PAS le sien, AUCUN visuel ne lui est servi
//                     (colonne des masqués, format 5). Il reste CANDIDAT avec ses marqueurs : le groupe { JUMBO, normale } tient. Jamais une exclusion de l'archive (elle retirerait aussi le produit des partages).
// Un doute (illisible) est traité comme un différent : un visuel absent est honnête, celui d'un autre tirage ne l'est pas.
const fs = require('fs');
const crypto = require('crypto');

const VERDICTS = Object.freeze(['identique', 'different', 'illisible', 'fiche-fausse']);
const CLASSE_DU_VERDICT = Object.freeze({ identique: 'emprunt', different: 'sans-visuel', illisible: 'sans-visuel', 'fiche-fausse': 'sans-visuel' });
const CLASSES = Object.freeze(['emprunt', 'sans-visuel']);
const TAILLE_MAX = 1048576, PRODUITS_MAX = 5000, DECISION_MAX = 2000;
const CLES_FICHIER = Object.freeze(['decision', 'source', 'le', 'listeLe', 'sha256Source', 'produits']);
const objetSimple = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const entierPositif = x => Number.isSafeInteger(x) && x > 0;
const refus = raison => ({ ok: false, raison });
const dateValide = s => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = new Date(`${s}T00:00:00Z`).getTime(); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };      // `toISOString` LÈVE sur une date impossible (2026-13-40) : la garde ne lève jamais
const instantValide = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(s) && !Number.isNaN(Date.parse(s));

/**
 * Lit et JUGE le fichier. @returns {{ ok: true, decision, le, source, listeLe, sha256Source, sha256, produits: [{ idProduct, verdict }], classes: Map<idProduct, 'emprunt'|'sans-visuel'>, comptes } | { ok: false, raison }}
 * Autorisé : un objet portant `decision` (texte non vide), `le` (date AAAA-MM-JJ de la copie), `listeLe` (instant ISO UTC de la liste source), `sha256Source` (64 hexadécimaux minuscules : l'empreinte du fichier du catalogue),
 * `produits` (tableau NON VIDE de { idProduct: entier > 0, verdict: un des VERDICTS }, sans doublon d'idProduct) et, facultatif, `source` (texte). Toute autre clé, à n'importe quel niveau, est refusée. Ne lève jamais.
 */
function lireFichierJumbos(chemin) {
    if (typeof chemin !== 'string' || !chemin.trim()) return refus('aucun fichier nommé');
    let st; try { st = fs.statSync(chemin); } catch { return refus('le fichier est introuvable ou illisible'); }
    if (!st.isFile()) return refus('ce n\'est pas un fichier');
    if (st.size === 0) return refus('le fichier est vide');
    if (st.size > TAILLE_MAX) return refus(`le fichier dépasse ${TAILLE_MAX} octets`);
    let octets; try { octets = fs.readFileSync(chemin); } catch { return refus('le fichier est introuvable ou illisible'); }
    let j; try { j = JSON.parse(octets.toString('utf8')); } catch { return refus('le fichier n\'est pas du JSON lisible'); }
    if (!objetSimple(j)) return refus('le fichier doit être un objet { decision, le, listeLe, sha256Source, produits }');
    for (const k of Object.keys(j)) if (!CLES_FICHIER.includes(k)) return refus(`clé inconnue « ${String(k).slice(0, 40)} » (permises : ${CLES_FICHIER.join(', ')})`);
    if (typeof j.decision !== 'string' || !j.decision.trim()) return refus('`decision` doit être un texte non vide');
    if (j.decision.length > DECISION_MAX) return refus(`\`decision\` dépasse ${DECISION_MAX} caractères`);
    if (j.source !== undefined && typeof j.source !== 'string') return refus('`source`, quand il est présent, doit être un texte');
    if (!dateValide(j.le)) return refus('`le` doit être une date AAAA-MM-JJ valide');
    if (!instantValide(j.listeLe)) return refus('`listeLe` doit être un instant ISO UTC (AAAA-MM-JJThh:mm:ss.sssZ) : la date de la liste source');
    if (typeof j.sha256Source !== 'string' || !/^[0-9a-f]{64}$/.test(j.sha256Source)) return refus('`sha256Source` doit être l\'empreinte SHA-256 (64 hexadécimaux minuscules) du fichier du catalogue');
    if (!Array.isArray(j.produits)) return refus('`produits` doit être un tableau');
    if (j.produits.length === 0) return refus('`produits` est vide : une liste sans produit ne change rien et n\'a pas de raison d\'être');
    if (j.produits.length > PRODUITS_MAX) return refus(`\`produits\` dépasse ${PRODUITS_MAX} éléments`);
    const classes = new Map(), produits = [], parVerdict = Object.fromEntries(VERDICTS.map(v => [v, 0]));
    for (let i = 0; i < j.produits.length; i++) {
        const p = j.produits[i], ou = `produits[${i}]`;
        if (!objetSimple(p)) return refus(`${ou} doit être un objet { idProduct, verdict }`);
        for (const k of Object.keys(p)) if (k !== 'idProduct' && k !== 'verdict') return refus(`${ou} : clé inconnue « ${String(k).slice(0, 40)} »`);
        if (!entierPositif(p.idProduct)) return refus(`${ou} : idProduct doit être un entier > 0`);
        if (typeof p.verdict !== 'string' || !VERDICTS.includes(p.verdict)) return refus(`${ou} : verdict hors de la liste fermée (${VERDICTS.join(', ')})`);
        if (classes.has(p.idProduct)) return refus(`${ou} : idProduct ${p.idProduct} en double`);
        classes.set(p.idProduct, CLASSE_DU_VERDICT[p.verdict]); produits.push({ idProduct: p.idProduct, verdict: p.verdict }); parVerdict[p.verdict]++;
    }
    const comptes = { emprunt: [...classes.values()].filter(c => c === 'emprunt').length, sansVisuel: [...classes.values()].filter(c => c === 'sans-visuel').length, parVerdict };
    return { ok: true, decision: j.decision, le: j.le, source: j.source ?? null, listeLe: j.listeLe, sha256Source: j.sha256Source, sha256: crypto.createHash('sha256').update(octets).digest('hex'), produits, classes, comptes };
}

/** La Map idProduct → classe qui entre dans la décision : null si elle est conforme, sinon le REFUS (texte). Écrite par ce qu'elle autorise : une Map non vide, des entiers > 0, une des deux classes. */
function jugerClasses(classes) {
    if (!(classes instanceof Map)) return 'jumbos : une Map idProduct → classe est attendue';
    if (classes.size === 0) return 'jumbos : la Map est vide (une liste sans produit ne change rien)';
    for (const [id, c] of classes) {
        if (!entierPositif(id)) return 'jumbos : idProduct entier > 0 attendu';
        if (typeof c !== 'string' || !CLASSES.includes(c)) return `jumbos : classe hors de la liste fermée pour ${id} (${CLASSES.join(', ')})`;
    }
    return null;
}

module.exports = { VERDICTS, CLASSES, CLASSE_DU_VERDICT, lireFichierJumbos, jugerClasses };
