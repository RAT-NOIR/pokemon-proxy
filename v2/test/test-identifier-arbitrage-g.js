'use strict';
// Banc B1b.7 (correction 1) — arbitrage-g.js : TOUTES les branches de l'arbitrage entre la règle G et la chaîne héritée. Module pur : ni base, ni réseau.
const H = require('./_harnais');
const { arbitrer, memeEnsemble } = require('../identifier/arbitrage-g');

const aff = produit => ({ issue: 'affirmee', produit }), qst = candidats => ({ issue: 'question', candidats });
const A = 100, B = 200, C = 300, D = 400;
let branches = 0;
const cas = (nom, chaine, g, attendu) => { branches++; H.v(nom, arbitrer(chaine, g), attendu); };

// chaîne AFFIRME
cas('affirmee/affirmee, même produit : accord, on garde, aucun désaccord', { issue: 'affirmee', ids: [A] }, aff(A), { action: 'garder', desaccord: null });
cas('affirmee/affirmee, produits différents : question entre les deux (chaîne d\'abord)', { issue: 'affirmee', ids: [A] }, aff(B),
    { action: 'question', ids: [A, B], desaccord: { chaine: 'affirmee', regleG: 'affirmee', retenue: 'a-trancher', produitsChaine: [A], produitsRegleG: [B] } });
cas('affirmee/question : le doute de G gagne, candidats de G', { issue: 'affirmee', ids: [A] }, qst([B, C]),
    { action: 'question', ids: [B, C], desaccord: { chaine: 'affirmee', regleG: 'question', retenue: 'a-trancher', produitsChaine: [A], produitsRegleG: [B, C] } });
// chaîne POSE UNE QUESTION
cas('question/question, même ensemble (ordre différent) : accord', { issue: 'question', ids: [A, B] }, qst([B, A]), { action: 'garder', desaccord: null });
cas('question/question, ensemble DIFFÉRENT (même taille) : la question de la chaîne reste, désaccord journalisé', { issue: 'question', ids: [A, B] }, qst([A, C]),
    { action: 'garder', desaccord: { chaine: 'question', regleG: 'question', retenue: 'a-trancher', produitsChaine: [A, B], produitsRegleG: [A, C] } });
cas('question/question, ensemble de taille différente : désaccord journalisé', { issue: 'question', ids: [A, B] }, qst([A, B, C]),
    { action: 'garder', desaccord: { chaine: 'question', regleG: 'question', retenue: 'a-trancher', produitsChaine: [A, B], produitsRegleG: [A, B, C] } });
cas('question/affirmee : la question de la chaîne reste, désaccord journalisé', { issue: 'question', ids: [A, B] }, aff(C),
    { action: 'garder', desaccord: { chaine: 'question', regleG: 'affirmee', retenue: 'a-trancher', produitsChaine: [A, B], produitsRegleG: [C] } });
cas('question/affirmee d\'un produit DÉJÀ candidat de la chaîne : la question reste quand même (G ne promeut jamais)', { issue: 'question', ids: [A, B] }, aff(A),
    { action: 'garder', desaccord: { chaine: 'question', regleG: 'affirmee', retenue: 'a-trancher', produitsChaine: [A, B], produitsRegleG: [A] } });
// chaîne INTROUVABLE
cas('introuvable/affirmee : on n\'affirme pas contre un introuvable', { issue: 'introuvable', ids: [] }, aff(A),
    { action: 'garder', desaccord: { chaine: 'introuvable', regleG: 'affirmee', retenue: 'introuvable', produitsChaine: [], produitsRegleG: [A] } });
cas('introuvable/question : idem', { issue: 'introuvable', ids: [] }, qst([A, B]),
    { action: 'garder', desaccord: { chaine: 'introuvable', regleG: 'question', retenue: 'introuvable', produitsChaine: [], produitsRegleG: [A, B] } });
console.log(`   ${branches} branches jouées (chaîne × G : affirmee 3, question 4, introuvable 2 ; dont 2 question/question d'ensemble différent)`);

// memeEnsemble, directement
H.v('memeEnsemble : même ensemble, ordre différent', memeEnsemble([A, B, C], [C, A, B]), true);
H.v('memeEnsemble : tailles différentes', memeEnsemble([A, B], [A, B, C]), false);
H.v('memeEnsemble : même taille, un membre différent', memeEnsemble([A, B], [A, D]), false);
H.v('memeEnsemble : vides', memeEnsemble([], []), true);
// la règle de prudence, énoncée : aucune sortie ne rend jamais une AFFIRMATION (action 'garder' ou 'question', jamais autre chose)
for (const ch of ['affirmee', 'question', 'introuvable']) for (const g of [aff(A), aff(B), qst([A, B]), qst([B, C])]) {
    const r = arbitrer({ issue: ch, ids: ch === 'affirmee' ? [A] : ch === 'question' ? [A, B] : [] }, g);
    H.vrai(`${ch} × G ${g.issue} : l'action est « garder » ou « question », jamais une promotion d'introuvable/question en affirmation`, ['garder', 'question'].includes(r.action) && (r.action === 'garder' || ch === 'affirmee'));
}
H.bilan();
