// ============================================================
// L'HÉRITAGE DU LOGO D'UN ADDITIONALS (décision du testeur, 2026-10-13, DEC-LOGOS n°2) :
//   « 30th Celebration Additionals : oui, l'identifiant de page du parent pour recevoir son logo officiel, si le logo est bien celui de ce produit.
//     Réversible, noté au registre. »
// Fonctions pures + `appliquer` (une seule `updateOne`, filtre sur l'ABSENCE) ; l'outil en ligne de commande est poser-logo-additionals.js.
// Le modèle est celui des 16 autres Additionals (xASC, xPBL…) : `bulba.pageid` = celui du parent, `logo` = le logo du parent (même fichier, même sha1) ;
// ce qui s'ajoute ici est le REGISTRE (`logoHeritage`), qui rend le geste réversible. Rien d'autre n'est écrit : `bulba.expansion`, `bulba.titre`… de
// l'Additionals ne sont pas touchés (le collecteur de texte, la table et les noms les lisent).
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : un set de la liste fermée, un parent qui porte le pageid attendu et un logo de niveau `officiel`, un
// Additionals dont les trois champs sont ABSENTS (ou déjà posés à l'identique) ; tout le reste refuse et le dit.
// ============================================================
const DECISION = 'testeur 2026-10-13 (DEC-LOGOS, décision 2) : l\'Additionals prend l\'identifiant de page de son parent pour recevoir son logo officiel — réversible (poser-logo-additionals.js --retirer)';
// LISTE FERMÉE : un Additionals, son parent, le pageid que le parent doit porter (lu en base le 2026-10-13, page « 30th Celebration (TCG) »).
const HERITAGES = {
    '30th-Celebration-Additionals': { parent: '30th-Celebration', pageid: 357032 }
};

const refus = raison => ({ action: 'refus', raison });
const logoValide = l => !!l && typeof l.cleR2 === 'string' && !!l.cleR2 && typeof l.sha1 === 'string' && !!l.sha1 && l.niveau === 'officiel';

/** Le plan de l'héritage : { action: 'poser'|'deja'|'refus', … }. `additionals` et `parent` : les documents `sets` lus (ou null). */
function planifier({ id, additionals, parent, le = new Date() }) {
    const h = HERITAGES[id];
    if (!h) return refus(`« ${id} » n'est pas dans la liste fermée des héritages (${Object.keys(HERITAGES).join(', ')})`);
    if (!additionals) return refus(`set ${id} absent`);
    if (!parent) return refus(`parent ${h.parent} absent`);
    if ((additionals.tirage ?? additionals.region) !== (parent.tirage ?? parent.region)) return refus(`tirage ${additionals.tirage ?? additionals.region} ≠ celui du parent (${parent.tirage ?? parent.region})`);
    if (parent.bulba?.pageid !== h.pageid) return refus(`le parent porte le pageid ${parent.bulba?.pageid ?? '∅'}, pas ${h.pageid}`);
    if (!logoValide(parent.logo)) return refus('le logo du parent n\'est pas un logo de niveau `officiel` complet (cleR2, sha1, niveau) : je ne le copie pas');
    const pid = additionals.bulba?.pageid, aLogo = additionals.logo != null, aReg = additionals.logoHeritage != null;
    if (pid != null && pid !== h.pageid) return refus(`${id} porte déjà le pageid ${pid} : rien n'est remplacé`);
    if (aLogo && additionals.logo.sha1 !== parent.logo.sha1) return refus(`${id} porte déjà un logo différent de celui du parent : rien n'est remplacé`);
    if (pid === h.pageid && aLogo && aReg) return { action: 'deja', id };
    if (pid != null || aLogo || aReg) return refus(`${id} est dans un état partiel (pageid ${pid ?? '∅'}, logo ${aLogo ? 'oui' : 'non'}, registre ${aReg ? 'oui' : 'non'}) : je ne complète pas, à regarder`);
    return {
        action: 'poser', id, parent: h.parent,
        filtre: { _id: id, 'bulba.pageid': null, logo: { $exists: false }, logoHeritage: { $exists: false } },
        set: { 'bulba.pageid': h.pageid, logo: { ...parent.logo }, logoHeritage: { de: h.parent, pageid: h.pageid, decision: DECISION, le } }
    };
}

/** Le retrait : seulement ce que l'héritage a posé (registre ET sha1 du logo ET pageid), jamais autre chose. */
function planifierRetrait({ id, additionals, parent }) {
    const h = HERITAGES[id];
    if (!h) return refus(`« ${id} » n'est pas dans la liste fermée des héritages`);
    if (!additionals || !parent) return refus('set ou parent absent');
    if (additionals.logoHeritage?.de !== h.parent) return refus(`${id} ne porte pas le registre d'héritage de ${h.parent} : rien à retirer`);
    if (!parent.logo?.sha1 || additionals.logo?.sha1 !== parent.logo.sha1) return refus('le logo de l\'Additionals n\'est plus celui du parent : refus');
    if (additionals.bulba?.pageid !== h.pageid) return refus(`le pageid de ${id} n'est pas ${h.pageid} : refus`);
    return { action: 'retirer', id, filtre: { _id: id, 'logoHeritage.de': h.parent, 'logo.sha1': parent.logo.sha1, 'bulba.pageid': h.pageid }, unset: { 'bulba.pageid': '', logo: '', logoHeritage: '' } };
}

/** L'écriture d'UN plan : une `updateOne` dont le filtre garde la condition lue. Rend { action, ecrits }. */
async function appliquer({ S, plan }) {
    if (plan.action === 'deja') return { action: 'deja', ecrits: 0 };
    if (plan.action === 'refus') return { action: 'refus', ecrits: 0, raison: plan.raison };
    const u = await S.updateOne(plan.filtre, plan.action === 'retirer' ? { $unset: plan.unset } : { $set: plan.set });
    return { action: u.modifiedCount === 1 ? plan.action : 'conflit', ecrits: u.modifiedCount === 1 ? 1 : 0 };
}

/** Arguments : liste fermée ; `--attendu=<n>` obligatoire avec `--ecrire`, refusé sans. */
function analyserArguments(argv) {
    const erreurs = [];
    const ecrire = argv.includes('--ecrire'), retirer = argv.includes('--retirer'), viaEcriture = argv.includes('--lecture-via-ecriture');
    for (const x of argv) if (!/^(--ecrire|--retirer|--lecture-via-ecriture|--attendu=.*)$/.test(x)) erreurs.push(`argument inconnu : ${x} — autorisés : --retirer, --ecrire, --attendu=<n>, --lecture-via-ecriture`);
    const att = argv.find(x => x.startsWith('--attendu='));
    let attendu = null;
    if (att !== undefined) {
        if (!/^--attendu=\d+$/.test(att)) erreurs.push(`${att} : un entier positif ou nul est exigé`);
        else attendu = Number(att.slice(10));
        if (!ecrire) erreurs.push('--attendu n\'a de sens qu\'avec --ecrire');
    } else if (ecrire) erreurs.push('--ecrire exige --attendu=<n> (le nombre de sets à écrire, annoncé par la simulation)');
    return { erreurs, ecrire, retirer, attendu, viaEcriture };
}

module.exports = { HERITAGES, DECISION, planifier, planifierRetrait, appliquer, analyserArguments };
