'use strict';
// COMPARATEUR des verdicts A (photo entiere) et B (photo reduite) du TEST DE COHERENCE. Module PUR : aucun fichier, aucune verite d'idProduct lue, aucun seuil de decision.
// DEFINITIONS, ecrites avant toute mesure :
//   · issue : 'affirmee' | 'commune' (reponse commune) | 'question' | 'muette' (la regle n'a pas conclu : code ferme) ;
//   · VERDICT IDENTIQUE : meme issue ET, si affirmee, meme idProduct ; si muette, meme code. Deux questions de candidats differents ont la meme issue : le top 3 qui differe est compte A PART ;
//   · SEVERITE (les passages vers ou depuis « affirmee » comptent) : 'affirmee-autre-produit' (les deux affirment, deux produits) > 'depuis-affirmee' (A affirme, B non) > 'vers-affirmee' (B affirme, A non) > 'sans-affirmee' ;
//   · CLASSE de la cause, d'apres le deplacement du quadrilatere de rang 1 (plus grand deplacement d'un coin, en % de la diagonale de la grille 640) : detection >= 3 % (un autre contour) ; cadrage de 0,5 % a moins de 3 %
//     (meme carte, redressement decale) ; decision < 0,5 % (memes pixels a l'encodage pres : vecteurs proches, frontiere d'un seuil) ; autre = pas de quadrilatere comparable (redressee d'un seul cote, ou aucune).
const SEUIL_DETECTION = 3, SEUIL_CADRAGE = 0.5;
const tri = a => [...a].sort((x, y) => x - y);
const meme = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Le verdict dans la forme du comparateur, depuis la decision de la regle G (ou un code ferme de panne). */
function issueDe(d) {
    if (!d || d.muette) return { issue: 'muette', produit: null, candidats: [], code: (d && d.muette) || 'inconnu' };
    if (d.affirme) return { issue: 'affirmee', produit: d.produit, candidats: [d.produit] };
    if (Array.isArray(d.reponseCommune)) return { issue: 'commune', produit: null, candidats: tri(d.reponseCommune) };
    return { issue: 'question', produit: null, candidats: Array.isArray(d.question) ? tri(d.question) : [] };
}

function memeVerdict(a, b) {
    if (a.issue !== b.issue) return false;
    if (a.issue === 'affirmee') return a.produit === b.produit;
    if (a.issue === 'muette') return a.code === b.code;
    return true;
}
const top3Different = (a, b) => !meme(tri(a.candidats || []), tri(b.candidats || []));

function severite(a, b) {
    if (memeVerdict(a, b)) return null;
    if (a.issue === 'affirmee' && b.issue === 'affirmee') return 'affirmee-autre-produit';
    if (a.issue === 'affirmee') return 'depuis-affirmee';
    if (b.issue === 'affirmee') return 'vers-affirmee';
    return 'sans-affirmee';
}

/** Le plus grand deplacement d'un coin, en % de la diagonale de la grille ; arrondi au dixieme. null si un quadrilatere manque. */
function deplacementQuadPct(qa, qb, dim) {
    if (!Array.isArray(qa) || !Array.isArray(qb) || qa.length !== 4 || qb.length !== 4) return null;
    const diag = Math.sqrt(dim[0] * dim[0] + dim[1] * dim[1]);
    return Math.round(1000 * Math.max(...qa.map((p, i) => Math.sqrt((p[0] - qb[i][0]) ** 2 + (p[1] - qb[i][1]) ** 2))) / diag) / 10;
}

function cosinus(u, v) {
    if (!Array.isArray(u) || !Array.isArray(v) || u.length !== v.length || !u.length) return null;
    let s = 0, a = 0, b = 0;
    for (let i = 0; i < u.length; i++) { s += u[i] * v[i]; a += u[i] * u[i]; b += v[i] * v[i]; }
    if (!a || !b) return null;
    return Math.round(1e6 * s / Math.sqrt(a * b)) / 1e6;
}

/** La classe de la cause d'une difference, d'apres les deux enregistrements de photo. */
function classer(ea, eb) {
    const d = (ea.redressee && eb.redressee) ? deplacementQuadPct(ea.quad, eb.quad, ea.dim640 || [640, 640]) : null;
    if (d === null) return 'autre';
    return d >= SEUIL_DETECTION ? 'detection' : d >= SEUIL_CADRAGE ? 'cadrage' : 'decision';
}

const resume = e => ({ issue: e.verdict.issue, produit: e.verdict.produit, candidats: e.verdict.candidats, code: e.verdict.code, score: e.score ?? null, marge: e.marge ?? null, nCandidats: e.nCandidats ?? null, nCartes: e.nCartes ?? null, redressee: e.redressee });

/**
 * @param A, B  listes d'enregistrements { sha256, redressee, nCartes, quad, dim640, emb, verdict, score?, marge?, nCandidats? } : les memes photos des deux cotes (le comparateur refuse sinon).
 */
function comparer(A, B) {
    const cles = l => l.map(e => e.sha256).sort();
    if (A.length !== B.length || !meme(cles(A), cles(B))) throw new Error('les deux listes ne portent pas les memes photos : refus de comparer');
    const parSha = new Map(B.map(e => [e.sha256, e]));
    const differences = [], parSeverite = {}, parClasse = {};
    let top3Differents = 0;
    for (const ea of A) {
        const eb = parSha.get(ea.sha256);
        const sev = severite(ea.verdict, eb.verdict);
        if (sev === null) { if (top3Different(ea.verdict, eb.verdict)) top3Differents++; continue; }
        const classe = classer(ea, eb);
        differences.push({ sha256: ea.sha256, severite: sev, classe, deplacementPct: (ea.redressee && eb.redressee) ? deplacementQuadPct(ea.quad, eb.quad, ea.dim640 || [640, 640]) : null, cosinus: cosinus(ea.emb, eb.emb), a: resume(ea), b: resume(eb) });
        parSeverite[sev] = (parSeverite[sev] || 0) + 1; parClasse[classe] = (parClasse[classe] || 0) + 1;
    }
    return { total: A.length, identiques: A.length - differences.length, differences, parSeverite, parClasse, top3Differents };
}

module.exports = { issueDe, memeVerdict, top3Different, severite, deplacementQuadPct, cosinus, classer, comparer, SEUIL_DETECTION, SEUIL_CADRAGE };
