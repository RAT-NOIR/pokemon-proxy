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

// `decision-api` : une décision de l'API elle-même (hors du jugement à l'œil du catalogue), toujours écrite AVEC sa raison (ex. 576911, Pikachu V-UNION : « V-UNION, pièce assemblée ») ; c'est un masqué.
const VERDICTS = Object.freeze(['identique', 'different', 'illisible', 'fiche-fausse', 'decision-api']);
const CLASSE_DU_VERDICT = Object.freeze({ identique: 'emprunt', different: 'sans-visuel', illisible: 'sans-visuel', 'fiche-fausse': 'sans-visuel', 'decision-api': 'sans-visuel' });
const RAISON_MAX = 200, ANNEE_MIN = 2026, ANNEE_MAX = 2030;
const CLASSES = Object.freeze(['emprunt', 'sans-visuel']);
const TAILLE_MAX = 1048576, PRODUITS_MAX = 5000, DECISION_MAX = 2000;
const CLES_FICHIER = Object.freeze(['decision', 'source', 'le', 'listeLe', 'sha256Source', 'produits']);
const objetSimple = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const entierPositif = x => Number.isSafeInteger(x) && x > 0;
const refus = raison => ({ ok: false, raison });
// Les dates sont jugées AU CALENDRIER (jamais par un Date qui « corrige » 2026-02-30 en mars) et bornées à ANNEE_MIN..ANNEE_MAX : on relit les composantes après construction, elles doivent être celles reçues.
function composantesValides(a, mo, j, h = 0, mi = 0, s = 0) {
    if (a < ANNEE_MIN || a > ANNEE_MAX || h > 23 || mi > 59 || s > 59) return false;
    const d = new Date(Date.UTC(a, mo - 1, j, h, mi, s));
    return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j;
}
const dateValide = s => { const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null; return m !== null && composantesValides(+m[1], +m[2], +m[3]); };
const instantValide = s => { const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(s) : null; return m !== null && composantesValides(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]); };

/** JSON.parse qui REFUSE une clé dupliquée (le dernier ne gagne pas en silence) ; une clé `__proto__` devient une clé propre (la liste blanche des clés la refuse). Lève une CleDupliquee (champ `cle`) ou une SyntaxError. */
class CleDupliquee extends Error { constructor(cle) { super('clé dupliquée'); this.cle = cle; } }
function parserSansDoublon(texte) {
    let i = 0;
    const blancs = () => { while (i < texte.length && ' \t\n\r'.includes(texte[i])) i++; };
    const chaine = () => { const debut = i; i++; while (i < texte.length && texte[i] !== '"') i += texte[i] === '\\' ? 2 : 1; if (i >= texte.length) throw new SyntaxError('chaîne non fermée'); i++; return JSON.parse(texte.slice(debut, i)); };
    const valeur = () => {
        blancs(); const c = texte[i];
        if (c === '{') {
            i++; const o = {}; const vus = new Set(); blancs();
            if (texte[i] === '}') { i++; return o; }
            for (;;) {
                blancs(); if (texte[i] !== '"') throw new SyntaxError('clé attendue');
                const k = chaine(); if (vus.has(k)) throw new CleDupliquee(k); vus.add(k);
                blancs(); if (texte[i] !== ':') throw new SyntaxError(': attendu'); i++;
                Object.defineProperty(o, k, { value: valeur(), enumerable: true, writable: true, configurable: true });
                blancs(); if (texte[i] === ',') { i++; continue; } if (texte[i] === '}') { i++; return o; } throw new SyntaxError(', ou } attendu');
            }
        }
        if (c === '[') {
            i++; const a = []; blancs(); if (texte[i] === ']') { i++; return a; }
            for (;;) { a.push(valeur()); blancs(); if (texte[i] === ',') { i++; continue; } if (texte[i] === ']') { i++; return a; } throw new SyntaxError(', ou ] attendu'); }
        }
        if (c === '"') return chaine();
        const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(texte.slice(i, i + 40));
        if (!m) throw new SyntaxError('valeur illisible'); i += m[0].length; return JSON.parse(m[0]);
    };
    const v = valeur(); blancs(); if (i !== texte.length) throw new SyntaxError('texte après la valeur'); return v;
}

/**
 * Lit et JUGE le fichier. @returns {{ ok: true, decision, le, source, listeLe, sha256Source, sha256, produits: [{ idProduct, verdict }], classes: Map<idProduct, 'emprunt'|'sans-visuel'>, comptes } | { ok: false, raison }}
 * Autorisé : un objet portant `decision` (texte non vide), `le` (date AAAA-MM-JJ de la copie), `listeLe` (instant ISO UTC de la liste source), `sha256Source` (64 hexadécimaux minuscules : l'empreinte du fichier du catalogue),
 * `produits` (tableau NON VIDE de { idProduct: entier > 0, verdict: un des VERDICTS }, sans doublon d'idProduct) et, facultatif, `source` (texte). Toute autre clé, à n'importe quel niveau, est refusée. Ne lève jamais.
 */
function lireFichierJumbos(chemin, { sha256Attendu = null } = {}) {
    // I1 (relecture) : la copie est ÉPINGLÉE — `sha256Attendu` (64 hexadécimaux minuscules) est comparé à l'empreinte des octets LUS ; un écart (une copie éditée en gardant la forme) refuse. Absent : pas de comparaison (la CLI l'exige).
    if (sha256Attendu !== null && (typeof sha256Attendu !== 'string' || !/^[0-9a-f]{64}$/.test(sha256Attendu))) return refus('`sha256Attendu` doit être une empreinte SHA-256 (64 hexadécimaux minuscules)');
    if (typeof chemin !== 'string' || !chemin.trim()) return refus('aucun fichier nommé');
    let st; try { st = fs.statSync(chemin); } catch { return refus('le fichier est introuvable ou illisible'); }
    if (!st.isFile()) return refus('ce n\'est pas un fichier');
    if (st.size === 0) return refus('le fichier est vide');
    if (st.size > TAILLE_MAX) return refus(`le fichier dépasse ${TAILLE_MAX} octets`);
    let octets; try { octets = fs.readFileSync(chemin); } catch { return refus('le fichier est introuvable ou illisible'); }
    const sha256 = crypto.createHash('sha256').update(octets).digest('hex');
    if (sha256Attendu !== null && sha256 !== sha256Attendu) return refus(`l'empreinte de la copie (${sha256}) n'est pas l'empreinte attendue (${sha256Attendu}) : la copie a été modifiée, ou ce n'est pas celle qui a été consignée`);
    let j; try { j = parserSansDoublon(octets.toString('utf8')); } catch (e) { return refus(e instanceof CleDupliquee ? `clé JSON dupliquée « ${String(e.cle).slice(0, 40)} » (le dernier ne gagne pas en silence)` : 'le fichier n\'est pas du JSON lisible'); }
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
        for (const k of Object.keys(p)) if (k !== 'idProduct' && k !== 'verdict' && k !== 'raison') return refus(`${ou} : clé inconnue « ${String(k).slice(0, 40)} »`);
        if (!entierPositif(p.idProduct)) return refus(`${ou} : idProduct doit être un entier > 0`);
        if (typeof p.verdict !== 'string' || !VERDICTS.includes(p.verdict)) return refus(`${ou} : verdict hors de la liste fermée (${VERDICTS.join(', ')})`);
        if (p.raison !== undefined && (typeof p.raison !== 'string' || p.raison.length > RAISON_MAX)) return refus(`${ou} : \`raison\`, quand elle est présente, doit être un texte de ${RAISON_MAX} caractères au plus`);
        if (p.verdict === 'decision-api' && (typeof p.raison !== 'string' || !p.raison.trim())) return refus(`${ou} : le verdict decision-api exige sa \`raison\` (texte non vide)`);
        if (classes.has(p.idProduct)) return refus(`${ou} : idProduct ${p.idProduct} en double`);
        classes.set(p.idProduct, CLASSE_DU_VERDICT[p.verdict]); produits.push({ idProduct: p.idProduct, verdict: p.verdict, ...(p.raison !== undefined ? { raison: p.raison } : {}) }); parVerdict[p.verdict]++;
    }
    const comptes = { emprunt: [...classes.values()].filter(c => c === 'emprunt').length, sansVisuel: [...classes.values()].filter(c => c === 'sans-visuel').length, parVerdict };
    return { ok: true, decision: j.decision, le: j.le, source: j.source ?? null, listeLe: j.listeLe, sha256Source: j.sha256Source, sha256, produits, classes, comptes };
}

/**
 * I1 : l'empreinte déclarée de la liste du catalogue (`sha256Source`) face au fichier source nommé par `source`, quand il est lisible. @returns { etat: 'compare' | 'ecart' | 'non-compare', sha256? }
 * 'non-compare' : pas de source lisible (un chemin de documentation, un fichier absent) — dit, jamais passé sous silence ; 'ecart' : le fichier source n'est pas celui dont l'empreinte est déclarée (la CLI refuse).
 */
function comparerSource(lecture) {
    if (!lecture || !lecture.ok || typeof lecture.source !== 'string' || !lecture.source.trim()) return { etat: 'non-compare' };
    let octets; try { if (!fs.statSync(lecture.source).isFile()) return { etat: 'non-compare' }; octets = fs.readFileSync(lecture.source); } catch { return { etat: 'non-compare' }; }
    const sha256 = crypto.createHash('sha256').update(octets).digest('hex');
    return { etat: sha256 === lecture.sha256Source ? 'compare' : 'ecart', sha256 };
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

module.exports = { VERDICTS, CLASSES, CLASSE_DU_VERDICT, lireFichierJumbos, jugerClasses, comparerSource };
