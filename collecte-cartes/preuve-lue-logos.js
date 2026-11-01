// ============================================================
// LOGOS « SOURCE UNIQUE + PREUVE LUE » (testeur, 2026-11-01) : « le nom du set est lu sur le logo et concorde nom pour nom avec la fiche du set. Sinon, le logo reste vide. »
// ============================================================
// Fonctions PURES. Une garde s'écrit par ce qu'elle AUTORISE : un seul chemin mène à l'écriture —
//   la ligne de la table (lue, regardée, datée) nomme CE set · un champ du set (logo | logoFr) porte CE fichier · son niveau ÉCRIT est « inconnu » · sa source est celle que la lecture a vue ·
//   le fichier en base est IDENTIQUE à celui lu (clé R2 et empreintes présentes des deux côtés : aucune ne diffère, et au moins une se compare) · ni générique, ni copie de Pokécardex,
//   ni logo du couple. Tout le reste est LISTÉ avec sa raison et rien n'est écrit. `logo.source` n'est jamais modifiée.
// Ce mode est DISTINCT de `--reclasser` (seconde source indépendante) : son `niveauPreuve` dit « source unique, preuve lue », jamais « seconde source ».
const fs = require('fs');
const path = require('path');
const { refusCopie, refusDuCouple, logoGenerique } = require('./langue-logo');

const CHAMPS = ['logo', 'logoFr'];
const EMPREINTES = ['cleR2', 'sha256', 'sha1'];
const texte = x => typeof x === 'string' && x.trim().length > 0;

/** Les lignes de la table, gardées par ce qu'elles AUTORISENT. Une ligne fautive, un fichier en double, une table vide : REFUS. Rend une Map fichier → ligne. */
function lignesDePreuves(lignes) {
    if (!Array.isArray(lignes) || !lignes.length) throw new Error('table des preuves lues vide ou illisible : rien ne se pose sur une table vide');
    const out = new Map();
    for (const [i, l] of lignes.entries()) {
        const ok = texte(l?.set) && texte(l.fichier) && texte(l.texteLu) && texte(l.nomFiche) && texte(l.sourceBase) && /^\d{4}-\d{2}-\d{2}$/.test(l.le ?? '') && l.regardee === true
            && EMPREINTES.some(k => texte(l[k]));
        if (!ok) throw new Error(`ligne ${i} de la table des preuves lues refusée (set, fichier, texteLu, nomFiche, sourceBase, le AAAA-MM-JJ, regardee: true, au moins une clé R2 ou empreinte) : ${JSON.stringify(l).slice(0, 200)}`);
        if (out.has(l.fichier)) throw new Error(`fichier en double dans la table des preuves lues : ${l.fichier}`);
        out.set(l.fichier, l);
    }
    return out;
}
const lignesDePreuvesDuFichier = (f = path.join(__dirname, 'logos-preuves-lues.json')) => lignesDePreuves(JSON.parse(fs.readFileSync(f, 'utf8')).lignes);

/** Le fichier en base est-il IDENTIQUE à celui lu ? Rend null (oui) ou la raison. Une empreinte absente d'un côté ne se compare pas ; si aucune ne se compare : on ne sait pas, on bloque. */
function identiqueOuRaison(e, l) {
    let comparees = 0;
    for (const k of EMPREINTES) {
        if (!texte(e[k]) || !texte(l[k])) continue;
        comparees++;
        if (e[k] !== l[k]) return `fichier en base différent de celui lu (${k} : base ${String(e[k]).slice(0, 24)} ≠ lu ${String(l[k]).slice(0, 24)})`;
    }
    return comparees ? null : 'aucune clé R2 ni empreinte à comparer des deux côtés : identité du fichier non prouvée';
}

/**
 * Le plan : { plan, refus }. Chaque ligne de la table finit dans l'un ou l'autre (plan + refus = lignes). `plan` : { _id, chemin, fichier, ligne }.
 */
function aPoserPreuveLue(sets, table) {
    const plan = [], refus = [];
    const parId = new Map(sets.map(s => [s._id, s]));
    const non = (l, raison) => refus.push({ set: l.set, fichier: l.fichier, raison });
    for (const l of table.values()) {
        const s = parId.get(l.set);
        if (!s) { non(l, 'set absent de la base'); continue; }
        const chemin = CHAMPS.find(c => s[c] && typeof s[c] === 'object' && s[c].fichier === l.fichier);
        if (!chemin) { non(l, 'aucun champ logo/logoFr du set ne porte ce fichier (fichier différent ou logo retiré)'); continue; }
        const e = s[chemin];
        if (e.niveau !== 'inconnu') { non(l, `niveau en base « ${e.niveau ?? 'absent'} » : seul « inconnu » se reclasse`); continue; }
        if (e.source !== l.sourceBase) { non(l, `source en base « ${e.source ?? 'absente'} » ≠ source vue à la lecture « ${l.sourceBase} »`); continue; }
        const id = identiqueOuRaison(e, l);
        if (id) { non(l, id); continue; }
        if (s.logoGenerique === true || logoGenerique(e.sha1)) { non(l, 'logo générique : ne se lève pas'); continue; }
        if (refusCopie(e.sha1, e.fichier)) { non(l, 'copie de Pokécardex'); continue; }
        if (refusDuCouple(e.fichier)) { non(l, 'logo du couple (le fichier nomme plusieurs sets)'); continue; }
        plan.push({ _id: s._id, chemin, fichier: l.fichier, ligne: l });
    }
    return { plan, refus };
}

const niveauPreuveDe = l => `source unique, preuve lue : « ${l.texteLu} » concorde avec la fiche « ${l.nomFiche} » (lu le ${l.le})`;
/** Les champs écrits pour un élément du plan : jamais `source`. */
const champsAEcrire = (x, le) => ({ [`${x.chemin}.niveau`]: 'officiel', [`${x.chemin}.niveauAvant`]: 'inconnu', [`${x.chemin}.niveauLe`]: le, [`${x.chemin}.niveauPreuve`]: niveauPreuveDe(x.ligne) });

module.exports = { lignesDePreuves, lignesDePreuvesDuFichier, aPoserPreuveLue, champsAEcrire, niveauPreuveDe, identiqueOuRaison };
