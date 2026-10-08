// node test-vignettes-apres-jointure.js — le chemin du rejeu de jointure rend leurs vignettes aux entrées réécrites.
// Banc par INJECTION (pas de R2 ni de base) : il prouve QUE `assurerVignettes` est appelé et avec QUELS arguments ; que la
// vignette revienne depuis le document `images` (depuisDocument) est la preuve de test-vignette-scratch.js (bout en bout, R2).
const fs = require('fs');
const path = require('path');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

(async () => {
    const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
    const appels = [];
    const assurer = async (db, o) => { appels.push({ db, o }); return { entrees: 3, cles: 2, traitees: 2, fabriquees: 0, deja: 0, depuisDocument: 2, echecs: [], interrompu: false, sets: ['Set-A', 'Set-B'] }; };
    const db = { fictive: true }, arreter = () => false;
    const r = await vignetterApresJointure(db, 'Set-A', { bucket: 'bucket-x', arreter, assurer });
    verifier('assurerVignettes est appelé une fois, sur la base donnée', [appels.length, appels[0].db === db], [1, true]);
    verifier('mêmes options que le worker : bucket, slug du set, parallèle 4, arrêt relayé', [appels[0].o.bucket, appels[0].o.slug, appels[0].o.parallele, appels[0].o.arreter === arreter], ['bucket-x', 'Set-A', 4, true]);
    verifier('le bilan est celui que le worker écrit (depuisDocument compris) et rend les sets vignettés', [r.vg.depuisDocument, r.vg.entrees, r.vg.echecs, r.sets], [2, 3, 0, ['Set-A', 'Set-B']]);
    const muet = { error() { } };
    const e = await vignetterApresJointure(db, 'Set-A', { bucket: 'b', journal: muet, assurer: async () => { throw new Error('R2 injoignable'); } });
    verifier('un échec ne lève pas : il est rendu, aucun set', [e.vg.erreur, e.sets], ['R2 injoignable', []]);

    // ── EFFET (sans R2) : une entrée réécrite sans vignette + un document `images` qui en porte une -> la vignette revient, recopiée
    // (depuisDocument), sans fabrication. `assurerVignettes` RÉEL, base fictive en mémoire, r2 remplacé (aucun accès réseau).
    const r2Faux = { verifierBucket: async () => { }, lireBinaire: async () => { throw new Error('ne doit pas lire R2 : la vignette est dans le document'); }, deposerBinaire: async () => { throw new Error('ne doit pas déposer'); } };
    const chemin = require.resolve('./collecte-cartes/r2');
    require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: r2Faux };
    const V = { cleR2: 'vignettes/a/2.webp', w: 200, h: 280 };
    const cartes = [{ _id: 1, images: [{ set: 'Set-A', numero: '2', cleR2: 'a/2', jointeLe: 'rejeu' }, { set: 'Set-B', numero: '1', cleR2: 'b/1', vignette: { cleR2: 'vignettes/b/1.webp' } }] }];
    const imagesDocs = [{ cleR2: 'a/2', vignette: V }];
    const dbFictive = { collection: nom => nom === 'cartes' ? {
        find: () => ({ async *[Symbol.asyncIterator]() { for (const d of cartes) if (d.images.some(e => typeof e.cleR2 === 'string' && !e.vignette && e.set === 'Set-A')) yield d; } }),
        updateOne: async (f, u, o) => { const cle = o.arrayFilters[0]['e.cleR2']; for (const e of cartes.find(d => d._id === f._id).images) if (e.cleR2 === cle && !e.vignette) e.vignette = u.$set['images.$[e].vignette']; return {}; }
    } : { find: q => ({ toArray: async () => imagesDocs.filter(d => q.cleR2.$in.includes(d.cleR2)) }), updateOne: async () => { throw new Error('le document porte déjà la vignette : pas d\'écriture'); } } };
    const reel = await vignetterApresJointure(dbFictive, 'Set-A', { bucket: 'b' });
    verifier('EFFET : l\'entrée réécrite retrouve la vignette du document (depuisDocument 1, 0 fabriquée, 0 échec)', [cartes[0].images[0].vignette, reel.vg.depuisDocument, reel.vg.fabriquees, reel.vg.echecs], [V, 1, 0, 0]);
    verifier('EFFET : l\'entrée d\'un autre set, déjà vignettée, n\'est pas touchée ; le set est rendu pour la revalidation', [cartes[0].images[1].vignette.cleR2, reel.sets], ['vignettes/b/1.webp', ['Set-A']]);

    // Le worker ET le rejeu passent par cette fonction (une seule définition) — lu dans le source, pas supposé.
    const src = fs.readFileSync(path.join(__dirname, 'collecteur-images.js'), 'utf8');
    verifier('collecteur-images.js appelle vignetterApresJointure à DEUX endroits (worker et rejeu)', (src.match(/vignetterApresJointure\(/g) || []).length, 2);
    verifier('collecteur-images.js n\'appelle plus assurerVignettes directement', /assurerVignettes\(/.test(src), false);
    // le bloc du rejeu : de son `if (arg('rejouer-jointure'))` à son premier `await fermer(); return;` (bornes de CODE, pas de commentaire)
    const debut = src.indexOf("if (arg('rejouer-jointure')) {"), fin = src.indexOf('await fermer(); return;', debut);
    const rejeu = debut >= 0 && fin > debut ? src.slice(debut, fin) : '';
    verifier('le bloc du rejeu est trouvé', rejeu.length > 200, true);
    const iV = rejeu.indexOf('vignetterApresJointure('), iSimule = rejeu.indexOf('continue;', rejeu.indexOf('if (simuler) {'));   // le `continue` du chemin simulé, pas ceux des codes absents
    verifier('le rejeu en écriture appelle la fonction ; en --simuler, jamais (le continue précède)', [iV > 0, iSimule > 0 && iSimule < iV], [true, true]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
