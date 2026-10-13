// ============================================================
// LIRE LA SONDE DU SERVEUR D'IMAGES OFFICIEL (cdn.pokemon-tcg.cn) ET L'ÉTAT DU RÉESSAI PIKAQIAN — lecture seule, 0 requête vers les sources
// ============================================================
//   node lire-sonde-cdn.js
// La sonde et la tentative espacée tournent dans le worker (collecte-cartes/sonde-cdn-pokemon-tcg.js, collecte-cartes/reessai-pikaqian.js) ; ce fichier
// ne fait que LIRE leurs documents dans `collecte_images_etat` (base `cartes`) et les imprimer. Il n'écrit rien.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const S = require('./collecte-cartes/sonde-cdn-pokemon-tcg');
const P = require('./collecte-cartes/pikaqian');
const { blocagesDe } = require('./collecte-cartes/reessai-pikaqian');

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const E = cx.db.collection('collecte_images_etat');
    console.log(S.formater(await E.findOne({ _id: S.ID_SONDE })));
    const al = await E.findOne({ _id: P.ID_ALERTE });
    if (!al) console.log(`\npikaqian : aucun document ${P.ID_ALERTE}`);
    else {
        const bl = blocagesDe(al);
        console.log(`\npikaqian : alerte ${al.active ? 'ACTIVE' : 'levée'}${al.suspendue ? ' — SUSPENDUE (plus aucune tentative sans décision du testeur)' : ''} · ${bl ? bl.length : '?'} blocage(s) · dernier essai ${al.dernierEssai ? new Date(al.dernierEssai).toISOString() : 'aucun'} · source passive : aucune tentative automatique (échéance écrite en base, non lue : ${al.pasAvant ? new Date(al.pasAvant).toISOString() : '—'})`);
        for (const b of bl ?? []) console.log(`   - ${new Date(b.le).toISOString()} · HTTP ${b.status ?? '?'} · ${b.url ?? '?'} · ${b.origine ?? ''}`);
    }
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
