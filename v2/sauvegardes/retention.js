'use strict';
// SAUVEGARDES — la rétention. 30 jours, MAIS il reste toujours les `garder` (3) dernières sauvegardes complètes ET vérifiables, même vieilles.
//   · « vérifiable » = (manifeste.js) le manifeste se déchiffre avec la clé, liste AU MOINS une collection dont `comptes` non vide, et chaque objet listé est là, à la taille annoncée. Une sauvegarde sans collection
//     n'est JAMAIS vérifiable (un `every` sur une liste vide rendrait vrai) et ne compte pas parmi les 3 ; une sauvegarde qu'on ne sait pas vérifier (autre clé, objet manquant) non plus, et n'est JAMAIS retirée :
//     on la signale (`inverifiables`), un humain décide.
//   · seuls les objets qui ont EXACTEMENT la forme de ce mécanisme (chemins.analyser) sous le préfixe de cette base sont concernés ; tout autre objet, dans le préfixe ou ailleurs, n'est jamais touché.
//   · une sauvegarde sans manifeste (envoi coupé) n'existe pas : retirée passé `orphelinesHeures` (une plus récente peut être en cours d'envoi).
const { PREFIXE, dateDeId } = require('./chemins');
const { grouper, verifier } = require('./manifeste');

async function appliquerRetention({ stockage, cle, base, maintenant = new Date(), jours = 30, garder = 3, orphelinesHeures = 48 }) {
    const tous = await stockage.lister(`${PREFIXE}${base}/`);      // lève si la liste est tronquée : on ne décide jamais sur une partie des objets
    const groupes = grouper(base, tous);
    const ids = [...groupes.keys()].sort().reverse();                        // les plus récents d'abord (l'identifiant commence par la date)
    const verifiables = [], inverifiables = [], supprimes = [];
    const retirer = async (id) => {
        const objets = groupes.get(id);
        const ordre = [...objets].sort((x, y) => (x.objet === 'manifeste.rmsav' ? -1 : y.objet === 'manifeste.rmsav' ? 1 : 0));   // le manifeste d'abord : la sauvegarde cesse d'exister avant ses objets
        for (const o of ordre) await stockage.supprimer(o.cle);
        supprimes.push(id);
    };
    for (const id of ids) {
        const objets = groupes.get(id);
        if (!objets.some(o => o.objet === 'manifeste.rmsav')) continue;
        if (await verifier({ stockage, cle, base, id, objets })) verifiables.push(id); else inverifiables.push(id);
    }
    const limite = +maintenant - jours * 86400e3;
    for (const id of verifiables.slice(garder)) { if (+dateDeId(id) < limite) await retirer(id); }
    const orphelines = +maintenant - orphelinesHeures * 3600e3;
    for (const id of ids) { if (!groupes.get(id).some(o => o.objet === 'manifeste.rmsav') && +dateDeId(id) < orphelines) await retirer(id); }
    return { gardes: verifiables.filter(id => !supprimes.includes(id)), supprimes, inverifiables };
}
module.exports = { appliquerRetention };
