'use strict';
// B1b.7 — l'arbitrage entre la règle G et la chaîne héritée. Module PUR (aucune base, aucun réseau).
// Ruling du coordinateur : un désaccord n'est JAMAIS tranché en silence. Le plus PRUDENT gagne (a-trancher > identifiee ; introuvable, qui n'affirme rien,
// reste introuvable), et la facturation suit l'issue RETENUE (l'appelant la fabrique d'après ce que le registre du scan a réellement fait) — jamais celle de
// l'autre. Une règle G qui ne dit rien (null) ou une chaîne en panne : pas d'arbitrage, la chaîne décide.
//
// entrée : `chaine` = { issue: 'affirmee'|'question'|'introuvable', ids: [idProduct…] } ; `g` = la sortie de decisionRegleG (affirmee|question).
// sortie : { action: 'garder'|'question', ids?, desaccord: null | { chaine, regleG, retenue, produitsChaine, produitsRegleG } }
//   action 'question' : la chaîne avait AFFIRMÉ ; on pose à la place une question entre `ids`.
const memeEnsemble = (a, b) => a.length === b.length && a.every(x => b.includes(x));

function arbitrer(chaine, g) {
    const idsC = chaine.ids;
    const idsG = g.issue === 'affirmee' ? [g.produit] : g.candidats;
    const desaccord = retenue => ({ chaine: chaine.issue, regleG: g.issue, retenue, produitsChaine: idsC, produitsRegleG: idsG });
    if (chaine.issue === 'affirmee') {
        if (g.issue === 'affirmee' && g.produit === idsC[0]) return { action: 'garder', desaccord: null };               // accord
        // G affirme un AUTRE produit : ni l'un ni l'autre n'est cru seul, on demande entre les deux
        if (g.issue === 'affirmee') return { action: 'question', ids: [idsC[0], g.produit], desaccord: desaccord('a-trancher') };
        return { action: 'question', ids: idsG, desaccord: desaccord('a-trancher') };                                    // G doute : le doute gagne
    }
    if (chaine.issue === 'question') {
        if (g.issue === 'question' && memeEnsemble(idsC, idsG)) return { action: 'garder', desaccord: null };            // accord
        return { action: 'garder', desaccord: desaccord('a-trancher') };                                                  // la question de la chaîne reste : elle est déjà la plus prudente
    }
    return { action: 'garder', desaccord: desaccord('introuvable') };                                                    // on n'affirme pas contre un « introuvable »
}
module.exports = { arbitrer, memeEnsemble };
