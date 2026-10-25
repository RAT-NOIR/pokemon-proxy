'use strict';
// node lancer-a-blanc.js audit-catalogue/mesure-images-apres-lot.js --code=smG --plan=<plan-R3.json> [--sortie=<f>.json]
// LECTURE SEULE. « Après l'écriture du lot de LIGNES <plan>, un rejeu de la jointure d'IMAGES du set (--rejouer-jointure=<code>) joindrait-il des visuels de CE tirage aux cartes du lot ? »
// La fonction de production (`joindreImages` de collecteur-images.js, en mode `simuler`) est appelée telle quelle ; seule la lecture des cartes du set est enveloppée : les cartes que le plan rattache au set
// (`cartesSets`) y sont ajoutées EN MÉMOIRE, comme le fera l'écriture du lot. Rien n'est écrit : le mode simuler n'écrit ni image, ni carte, ni reste ; le rapport va dans un dossier temporaire.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ouvrirConnexions } = require('../collecte-cartes/garde');
const { modeles } = require('../collecte-cartes/schemas');
const { ligne: ligneDeTable } = require('../collecte-cartes/table-sets');
const { sourceDe } = require('../collecte-cartes/sources-sets');
const { joindreImages } = require('../collecteur-images');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
(async () => {
    const code = arg('code'), planF = arg('plan');
    if (!code || !planF) { console.error('usage : --code=<CODE> --plan=<plan.json> [--sortie=<f>.json]'); process.exit(2); }
    const plan = JSON.parse(fs.readFileSync(planF, 'utf8'));
    const L = ligneDeTable(code); if (!L) { console.error(`code ${code} absent de la table`); process.exit(1); }
    const slug = L.slugSet;
    const ajoutees = [...new Set((plan.cartesSets || []).filter(x => x.set === slug).map(x => x.carteId))];
    if (!ajoutees.length) { console.error(`le plan ne rattache aucune carte au set ${slug}`); process.exit(1); }
    const { cartes: cx, fermer } = await ouvrirConnexions({ buckets: [], production: false });
    try {
        const M = modeles(cx);
        const dejaDuSet = await M.Carte.countDocuments({ sets: slug, _id: { $in: ajoutees } });
        const e = await M.EtatImages.findById(`artofpkm/${slug}`).lean();
        if (!e?.entrees) throw new Error(`artofpkm/${slug} : jamais collecté, rien à rejouer`);
        // l'enveloppe : { sets: slug } rend aussi les cartes du plan, avec le set en plus ; toute autre requête passe telle quelle
        const Carte = { find: (f) => {
            if (f && f.sets === slug && Object.keys(f).length === 1) {
                const q = M.Carte.find({ $or: [{ sets: slug }, { _id: { $in: ajoutees } }] });
                const aj = c => (c.sets || []).includes(slug) ? c : { ...c, sets: [...(c.sets || []), slug] };
                return { lean: async () => (await q.lean()).map(aj), select() { return this; } };
            }
            return M.Carte.find(f);
        } };
        const M2 = { ...M, Carte };
        const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mesure-images-'));
        const r = await joindreImages(M2, L, slug, sourceDe(code, 'artofpkm'), e.entrees, e.mesures || {}, dossier, { silencieux: true, simuler: true });
        const idsPlan = new Set(ajoutees);
        const duLot = r.nouvelles.filter(x => idsPlan.has(x.carteId)), horsLot = r.nouvelles.filter(x => !idsPlan.has(x.carteId));
        const sortie = { code, slug, cartesDuLot: ajoutees.length, dejaRattachees: dejaDuSet, imagesOk: r.imagesOk, preuves: r.preuves, nouvellesDuLot: duLot.length, cartesDuLotAvecImage: new Set(duLot.map(x => x.carteId)).size, nouvellesHorsLot: horsLot.length, remplacees: r.remplacees.length, contredites: r.contredites.length, restes: r.restes, exemples: duLot.slice(0, 5), horsLot: horsLot.slice(0, 5) };
        console.log(JSON.stringify(sortie, null, 1));
        if (arg('sortie')) fs.writeFileSync(arg('sortie'), JSON.stringify({ ...sortie, nouvelles: r.nouvelles, remplacees: r.remplacees, contredites: r.contredites }));
        try { fs.rmdirSync(dossier); } catch { /* non vide ou déjà parti : le mode simuler n'y écrit rien */ }
    } finally { await fermer(); }
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });
