'use strict';
const H = require('./_harnais');
delete process.env.CODE_ILLIMITE;
const acces = require('../../acces');
(async () => {
    const appels = [];
    const v2 = {
        rembourser: async (req, motif, opts) => { appels.push(['rembourser', motif, opts]); req.scanRembourse = true; return true; },
        poserQuestion: async (req, q) => { appels.push(['poser', q.raison]); return { etat: 'en-attente' }; }
    };
    const req = { credit: { userId: 'v2:i1', poche: 'essai', v2 }, body: {} };
    H.v('rembourserScan délègue à req.credit.v2', await acces.rembourserScan(req, 'ia-echec'), true);
    H.v('   avec le motif et les options', appels[0], ['rembourser', 'ia-echec', { compteur: undefined, jourDe: undefined }]);
    H.v('poserQuestion délègue à req.credit.v2', await acces.poserQuestion(req, { scanId: 's', raison: 'egalite', candidats: [1, 2] }), { etat: 'en-attente' });
    // signalerIncertain passe par rembourserScan : il délègue donc aussi, avec le compteur des questions
    const req2 = { credit: { userId: 'v2:i2', poche: 'essai', v2 }, body: {} };
    await acces.signalerIncertain(req2, 'x');
    H.v('signalerIncertain => compteur question', appels[2][2].compteur, 'question');
    // SANS req.credit.v2 : le chemin d'aujourd'hui (aucun crédit => false, cause aucun-debit), sans toucher à v2
    H.v('sans credit.v2, comportement hérité (aucun débit => false)', await acces.rembourserScan({ body: {} }, 'x'), false);
    H.bilan();
})();
