// SONDE BULBAPEDIA — UNE requête, directe et isolée (décision 5 du testeur, 2026-10-08).
// robots.txt, au User-Agent de bulba.js, sans autre en-tête, redirection non suivie. Ne passe PAS par la file de bulba.js et ne prend PAS
// le verrou `bulbapedia/__collecteur__` (un worker peut le tenir) : une requête, imprimée, et c'est tout. N'écrit rien nulle part, SAUF avec --noter.
// Usage : node sonde-bulba.js --je-confirme-une-seule-requete [--noter]
// --noter : écrit le verdict dans l'état que lit la route B des logos (collecte-cartes/logos-bulba.js : feuVertSonde), par la MÊME machine d'état que le worker :
//   une suspension non échue (ou une cadence d'essai non écoulée) = AUCUNE requête, rien d'écrit ; l'écriture est conditionnelle à la réservation de l'essai
//   (jamais d'écrasement d'un DEFI écrit pendant la requête) ; un échec réseau écrit son verdict d'échec (AUTRE) — jamais de SERVI sans réponse 200 lisible.
const E = require('./collecte-cartes/bulba-espacement');

const afficher = rep => {
    const h = k => rep.headers.get(k);
    console.log(`date             : ${new Date().toISOString()}`);
    console.log(`requête          : GET ${E.HOTE}/robots.txt (1 seule, User-Agent seul)`);
    console.log(`statut           : ${rep.status}`);
    for (const k of ['server', 'cf-mitigated', 'cf-ray', 'retry-after', 'content-type']) console.log(`${k.padEnd(16)} : ${h(k) ?? '(absent)'}`);
    console.log(`début du corps   : ${JSON.stringify(rep.texte.slice(0, 120))}`);
    const v = E.verdictDe(rep);
    console.log(`VERDICT          : ${v.verdict} — ${v.motif}`);
    return v;
};

(async () => {
    if (!process.argv.includes('--je-confirme-une-seule-requete')) { console.error('Refusé : ajouter --je-confirme-une-seule-requete (une requête vers Bulbapedia).'); process.exit(2); }
    if (!process.argv.includes('--noter')) {
        let rep;
        try { rep = await E.fabriquerClientDirect()(); } catch (e) { console.log(`AUTRE : erreur réseau ${e.code || e.message}`); process.exit(1); }
        afficher(rep);
        return;
    }
    require('dotenv').config();
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { sonderEtNoter } = require('./collecte-cartes/logos-bulba');
    const cx = await ouvrirConnexions({ production: false, buckets: [] });
    try {
        let rep = null;
        const direct = E.fabriquerClientDirect();
        const r = await sonderEtNoter({ collection: cx.cartes.db.collection('collecte_images_etat'), client: async () => { rep = await direct(); return rep; } });
        if (!r.envoye) { console.log(`AUCUNE REQUÊTE   : ${r.raison} — rien n'est écrit`); process.exitCode = 1; return; }
        if (rep) afficher(rep); else console.log(`AUTRE : ${r.motif}`);
        console.log(`ÉTAT NOTÉ        : ${E.ID_ETAT} → ${JSON.stringify(r)}`);
        if (r.verdict !== 'SERVI') process.exitCode = 1;
    } catch (e) { console.error(`🛑 ${e.message}`); process.exitCode = 1; }
    finally { await cx.fermer(); }
})();
