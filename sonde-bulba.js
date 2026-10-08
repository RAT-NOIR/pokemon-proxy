// SONDE BULBAPEDIA — UNE requête, directe et isolée (décision 5 du testeur, 2026-10-08).
// robots.txt, au User-Agent de bulba.js, sans autre en-tête, redirection non suivie. Ne passe PAS par la file de bulba.js et ne prend PAS
// le verrou `bulbapedia/__collecteur__` (un worker peut le tenir) : une requête, imprimée, et c'est tout. N'écrit rien nulle part.
// Usage : node sonde-bulba.js --je-confirme-une-seule-requete
const E = require('./collecte-cartes/bulba-espacement');

(async () => {
    if (!process.argv.includes('--je-confirme-une-seule-requete')) { console.error('Refusé : ajouter --je-confirme-une-seule-requete (une requête vers Bulbapedia).'); process.exit(2); }
    let rep;
    try { rep = await E.fabriquerClientDirect()(); } catch (e) { console.log(`AUTRE : erreur réseau ${e.code || e.message}`); process.exit(1); }
    const h = k => rep.headers.get(k);
    console.log(`date             : ${new Date().toISOString()}`);
    console.log(`requête          : GET ${E.HOTE}/robots.txt (1 seule, User-Agent seul)`);
    console.log(`statut           : ${rep.status}`);
    for (const k of ['server', 'cf-mitigated', 'cf-ray', 'retry-after', 'content-type']) console.log(`${k.padEnd(16)} : ${h(k) ?? '(absent)'}`);
    console.log(`début du corps   : ${JSON.stringify(rep.texte.slice(0, 120))}`);
    const v = E.verdictDe(rep);
    console.log(`VERDICT          : ${v.verdict} — ${v.motif}`);
})();
