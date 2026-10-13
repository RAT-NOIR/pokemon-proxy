// LES LOGOS PARTAGÉS DE L'EXPORT, AVEC LE SAUT NOMMÉ DES FICHIERS ABSENTS (décision 7 du testeur, 2026-10-13) :
// « l'export ne doit plus s'arrêter pour eux. Il les SAUTE nommément (liste écrite dans sa sortie), et ces sets gardent leur logo actuel
// jusqu'au retour du fichier. » Le « logo actuel » est l'entrée de l'export PRÉCÉDENT, reprise telle quelle et marquée.
// Une garde s'écrit par ce qu'elle AUTORISE : seule l'ABSENCE du fichier (ENOENT) se saute. Un sha1 qui diffère de la table, un code absent de
// la table, une autre erreur de lecture, un dossier `apport-manuel/Deck JP` introuvable (racine fausse : tout serait « absent ») LÈVENT.
const fs = require('fs');
const path = require('path');

/**
 * partages : { set: code } · lus : Map code → { sha1, lu } · fichier(rel) : async → { fichier, cheminAbsolu, sha1, w, h } (lève ENOENT si absent)
 * precedents : entrées `logosPartages` de l'export précédent (peut être vide). Rend { partages, fichiersAbsents }.
 */
async function lirePartages({ racine, partages, lus, fichier, precedents = [] }) {
    const dossier = path.join(racine, 'apport-manuel', 'Deck JP');
    if (!fs.existsSync(dossier)) throw new Error(`${dossier} introuvable : racine fausse ? (rien n'est sauté, tout serait « absent »)`);
    const prec = new Map((precedents || []).map(p => [p.set, p]));
    const sortie = [], absents = new Map();
    for (const [set, code] of Object.entries(partages)) {
        const l = lus.get(code); if (!l) throw new Error(`${code} absent de la table des logos lus`);
        const rel = `apport-manuel/Deck JP/${code}.png`;
        let f;
        try { f = await fichier(rel); }
        catch (e) {
            if (e?.code !== 'ENOENT') throw e;
            const a = absents.get(rel) || { fichier: rel, cheminAbsolu: path.join(racine, rel), sets: [], rubrique: 'partagés', action: null };
            a.sets.push(set); absents.set(rel, a);
            const p = prec.get(set);
            if (p) { sortie.push({ ...p, reprisDeLExportPrecedent: true, fichierAbsent: rel }); a.action = 'repris de l\'export précédent'; }
            else a.action = 'sans logo repris';
            continue;
        }
        if (f.sha1 !== l.sha1) throw new Error(`${code} : sha1 ${f.sha1} ≠ table ${l.sha1}`);
        sortie.push({ set, ...f, lu: l.lu, partageAvec: Object.entries(partages).filter(([s, c]) => s !== set && lus.get(c)?.sha1 === l.sha1).map(([s]) => s) });
    }
    return { partages: sortie, fichiersAbsents: [...absents.values()] };
}
module.exports = { lirePartages };
