'use strict';
const { col } = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const L = require('../transport/limites');
const nettoyerLibelle = (v, max) => {
    if (typeof v !== 'string') return 'Navigateur';
    const s = Array.from(v.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').trim()).slice(0, max).join('').trim();
    return s || 'Navigateur';
};
async function creerInstallation({ libelle, cfg, maintenant = new Date() }) {
    const jour = await L.consommer('essais-globaux', { max: cfg.limites.essaisGlobauxJour, fenetreMs: 86400e3, maintenant });
    const jeton = J.genererJeton();
    // compteId n'est JAMAIS un paramètre : une installation naît non liée (la liaison est un autre geste, B2.9).
    const inst = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: jour.permis ? cfg.quotas.essai : 0, libelle: nettoyerLibelle(libelle, cfg.comptes.libelleMax), now: maintenant });
    await col('installations').insertOne(inst);
    return { installation: inst, jeton };
}
module.exports = { creerInstallation, nettoyerLibelle };
