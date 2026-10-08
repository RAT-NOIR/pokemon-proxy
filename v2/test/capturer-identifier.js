'use strict';
// USAGE : node v2/test/capturer-identifier.js --ecrire=<fichier.json>     (référence, AVANT le changement)
//         node v2/test/capturer-identifier.js --contre=<fichier.json>     (comparaison, APRÈS) -> code 1 si la moindre différence
// Rejoue TOUTES les charges enregistrées de verrou/charges.json sur le vrai serveur, hors ligne, base test_scratch (même montage que capture-reponse.js).
// Le seul champ normalisé est `scanId` (un ObjectId neuf à chaque scan) : tout le reste doit être identique OCTET POUR OCTET.
require('dotenv').config();
const path = require('path'), fs = require('fs');
const { demarrer, appeler, RACINE } = require('../../verrou/serveur');
const JETON = process.env.JETON_API || 'jeton-verrou';
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const normaliser = s => s.replace(/"scanId":"[0-9a-f]{24}"/g, '"scanId":"<id>"');
(async () => {
    if (!arg('ecrire') && !arg('contre')) { console.error('USAGE : --ecrire=<fichier> ou --contre=<fichier>'); process.exit(1); }
    const charges = JSON.parse(fs.readFileSync(path.join(RACINE, 'verrou', 'charges.json'), 'utf8')).charges;
    const srv = await demarrer(path.join(RACINE, 'verrou', 'faux-reseau.js'), { VERROU_CHARGES: path.join(RACINE, 'verrou', 'charges.json'), JETON_API: JETON, MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '' });
    if (!await srv.attendreMongo()) { console.error('Mongo non connecté'); srv.enfant.kill(); process.exit(1); }
    const sorties = [], repartition = {};
    for (let i = 0; i < charges.length; i++) {
        const r = await appeler(srv.port, 'POST', '/api/identifier', { userId: `inchange-${i}`, imageUrls: [charges[i].imageUrl], title: null, vintedEtat: null }, JETON);
        sorties.push(normaliser(`${r.status} ${JSON.stringify(r.json)}`));
        const motif = r.json && (r.json.success ? 'succes' : `refus:${r.json.motifRefus || '?'}`);
        repartition[motif] = (repartition[motif] || 0) + 1;
    }
    console.log('répartition :', JSON.stringify(repartition));
    srv.enfant.kill();
    console.log(`${sorties.length} charge(s) rejouée(s) (dénominateur)`);
    if (!sorties.length) { console.error('🔴 aucune charge rejouée : outil cassé, pas une réussite'); process.exit(1); }
    if (arg('ecrire')) {
        if (!repartition.succes) { console.error('🔴 RÉFÉRENCE REFUSÉE : aucune charge ne réussit (catalogue de test_scratch absent ?) — un vide parfait ne prouve rien.'); process.exit(1); }
        fs.writeFileSync(arg('ecrire'), JSON.stringify(sorties)); console.log('référence écrite'); return;
    }
    const ref = JSON.parse(fs.readFileSync(arg('contre'), 'utf8'));
    let diff = 0; sorties.forEach((s, i) => { if (s !== ref[i]) { diff++; console.log(`❌ charge ${i} diffère`); } });
    console.log(diff ? `🔴 ${diff} différence(s)` : `✅ ${sorties.length}/${sorties.length} identiques`);
    process.exit(diff || ref.length !== sorties.length ? 1 : 0);
})();
