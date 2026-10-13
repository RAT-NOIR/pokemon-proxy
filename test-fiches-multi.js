// node test-fiches-multi.js — collecte-cartes/fiches-multi.js (lot MULTI) sur une FAUSSE BASE en memoire, avec la REGLE DU SITE IMPORTEE
// (exporter-donnees-logos-site.js : regleDuSite / fichesDesProduits). Aucun reseau, aucune vraie base.
// Monde = la forme relevee le 2026-10-13 : Promos (2107) n'a pas de bulba.expansion ; l'Ultra Ball 148517 porte 6 lignes, 3 d'origine
// Brilliant Stars n°150 et 3 d'origine Mega Evolution n°131 (slugs ...-PRBRS-150 / ...-PRMEG-131), sans numeroFiche.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTEE du module (le rouge se voit en cassant le code).
// RACINE_SITE=<dossier> : le dossier dont le VOISIN `rat-market-site` porte la regle du site (defaut : le depot principal).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const FM = require(path.join(DIR, 'collecte-cartes', 'fiches-multi.js'));
const X = require(path.join(__dirname, 'exporter-donnees-logos-site.js'));
const RACINE_SITE = process.env.RACINE_SITE || 'C:/Users/Yung/Desktop/pokemon-proxy';
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

// ── la fausse base : find / findOne / countDocuments / updateOne, avec les operateurs que l'outil emploie ──
function fakeDb(init, opts = {}) {
    const cols = new Map(Object.entries(init).map(([n, docs]) => [n, new Map(docs.map(d => [d._id, structuredClone(d)]))]));
    const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const valeurs = (d, chemin) => { let xs = [d]; for (const k of chemin.split('.')) xs = xs.flatMap(x => (x == null ? [] : Array.isArray(x) ? x.map(y => y?.[k]) : [x[k]])); return xs.flatMap(x => (Array.isArray(x) ? [x, ...x] : [x])); };
    const cond = (d, k, v) => {
        const vs = valeurs(d, k);
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some(o => o.startsWith('$'))) {
            if ('$in' in v) return vs.some(x => v.$in.some(y => egal(x, y)));
            if ('$ne' in v) return !vs.some(x => egal(x, v.$ne));
            throw new Error('operateur non gere par la fausse base : ' + JSON.stringify(v));
        }
        if (v === null) return vs.every(x => x == null);
        return vs.some(x => egal(x, v));
    };
    const correspond = (d, f) => Object.entries(f || {}).every(([k, v]) => cond(d, k, v));
    const poser = (d, chemin, f) => { const ks = chemin.split('.'); let x = d; for (const k of ks.slice(0, -1)) x = x[k] = x[k] || {}; x[ks.at(-1)] = f(x[ks.at(-1)]); };
    const col = nom => { const m = cols.get(nom); if (!m) throw new Error('collection inconnue ' + nom); return {
        find: (f, o) => ({ toArray: async () => [...m.values()].filter(d => correspond(d, f)).map(d => structuredClone(d)) }),
        async findOne(f) { return structuredClone([...m.values()].find(d => correspond(d, f)) ?? null); },
        countDocuments: async f => [...m.values()].filter(d => correspond(d, f)).length,
        async updateOne(f, u) {
            if (opts.ecrire) opts.ecrire(nom, f, u);
            const d = [...m.values()].find(x => correspond(x, f));
            if (!d) return { matchedCount: 0, modifiedCount: 0 };
            for (const [k, v] of Object.entries(u.$set || {})) poser(d, k, () => structuredClone(v));
            for (const [k, v] of Object.entries(u.$push || {})) poser(d, k, cur => [...(cur || []), ...structuredClone(v.$each || [v])]);
            return { matchedCount: 1, modifiedCount: 1 };
        } }; };
    return { collection: col, brut: nom => [...cols.get(nom).values()].map(d => structuredClone(d)) };
}

const SET = (o = {}) => ({ _id: 'Promos', code: 'PR', idExpansion: [2107], region: 'intl', tirage: 'intl', nomAffichage: 'Promos', bulba: { titre: null, expansion: null, motifTitres: 'réimpressions (pr)' }, partiel: { prouves: 53, total: 93 }, ...o });
const IMP = (expansion, numero) => ({ tirage: 'intl', expansion, deck: null, numero, total: null, rarete: null });
const LIGNE = (idProduct, carteId, slug, o = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, idExpansion: 2107, tirage: 'intl', preuve: 'reimpression+origine+numero', slug, slugSet: 'Promos', route: 'PR', ...o });
const ULTRA = [[701604, 'Ultra-Ball-V1-PRBRS-150'], [707850, 'Ultra-Ball-V2-PRBRS-150'], [707851, 'Ultra-Ball-V3-PRBRS-150'], [861240, 'Ultra-Ball-V4-PRMEG-131'], [873099, 'Ultra-Ball-V5-PRMEG-131'], [873102, 'Ultra-Ball-V6-PRMEG-131']];
function monde(o = {}) {
    const lignesUltra = ULTRA.map(([id, slug]) => LIGNE(id, 148517, slug, { origine: { code: /BRS/.test(slug) ? 'BRS' : 'MEG', numero: /BRS/.test(slug) ? '150' : '131' } }));
    return fakeDb({
        sets: [SET(o.set)],
        cartes: [
            { _id: 148517, nomEn: 'Ultra Ball', sets: ['Brilliant-Stars', 'Promos'], impressions: [IMP('Brilliant Stars', '150/172'), ...(o.impUltra || [])], images: o.imagesUltra || [], liens: { idProduct: [999, 861240, 701604, 707850, 707851, 873099, 873102], idMetacards: [218103] } },
            { _id: 7, nomEn: 'Pidgey', sets: ['Promos'], impressions: [IMP('Pokemon 151', '016/165')], images: [], liens: { idProduct: [5001], idMetacards: [] } },
            { _id: 8, nomEn: 'Eevee', sets: ['Promos'], impressions: [], images: [], liens: { idProduct: [5002, 5003], idMetacards: [] } },
            ...(o.cartes || [])
        ],
        cartes_produits: [
            ...lignesUltra,
            LIGNE(5001, 7, 'Pidgey-PRMEW-016'),
            LIGNE(5002, 8, 'Eevee-V1-PRSVI-167'), LIGNE(5003, 8, 'Eevee-PRMEW-133'),
            { _id: '1|1', carteId: 1, idProduct: 1, idExpansion: 99, slug: 'Autre-X-1', slugSet: 'Autre' },
            ...(o.lignes || [])
        ]
    });
}
const CARTE = db => id => db.brut('cartes').find(c => c._id === id), LIG = db => id => db.brut('cartes_produits').find(l => l._id === id);
const etat = db => JSON.stringify(['sets', 'cartes', 'cartes_produits'].map(n => db.brut(n)));
const NOM = FM.expansionDe('Promos');

(async () => {
    const regle = await X.regleDuSite(RACINE_SITE);
    const deps = { regle, fichesDesProduits: X.fichesDesProduits };
    const set = SET();
    const ultra = db => db.brut('cartes').find(c => c._id === 148517);
    const lignesDe = (db, id) => db.brut('cartes_produits').filter(l => l.carteId === id);

    // ── planFiche : le geste minimal d'UNE fiche ──
    let db = monde();
    let P = FM.planFiche({ set, carte: ultra(db), lignes: lignesDe(db, 148517), nom: NOM });
    verifier('Ultra Ball : a ecrire, 2 impressions (131 puis 150, dans l\'ordre de liens.idProduct de la carte), tirage et expansion du set', [P.statut, P.impressions.map(i => [i.tirage, i.expansion, i.numero])], ['ecrire', [['intl', NOM, '131'], ['intl', NOM, '150']]]);
    verifier('   la premiere impression porte la preuve (slug, code, numero) ; ni illustrateur ni rarete ni total inventes', [P.impressions[0].source, /Ultra-Ball-V4-PRMEG-131/.test(P.impressions[0].preuveNumero), P.impressions[0].illustrateur, P.impressions[0].rarete, P.impressions[0].total], ['origine-slug', true, undefined, null, null]);
    verifier('   numeroFiche pose sur les 6 lignes : l\'origine de CHAQUE slug', [...P.numeros].map(([id, n]) => `${id}=${n}`).sort(), ['148517|701604=150', '148517|707850=150', '148517|707851=150', '148517|861240=131', '148517|873099=131', '148517|873102=131']);
    verifier('   l\'ordre des lignes ne change pas le resultat (deterministe)', FM.planFiche({ set, carte: ultra(db), lignes: [...lignesDe(db, 148517)].reverse(), nom: NOM }).impressions.map(i => i.numero), ['131', '150']);

    const plan = (lignes, o = {}) => FM.planFiche({ set: o.set || set, carte: o.carte || ultra(db), lignes, nom: NOM });
    const L = (id, slug, o = {}) => LIGNE(id, 148517, slug, o);
    verifier('une seule origine (3 produits du meme tirage) : hors de la forme, rien a ecrire', plan([L(1, 'X-V1-PRBRS-150'), L(2, 'X-V2-PRBRS-150')]).statut, 'hors-forme');
    verifier('un slug qui ne se decode pas : la fiche est REFUSEE (WCD25 « Munkidori-WCD25099 »)', [plan([L(1, 'X-PRBRS-150'), L(2, 'Munkidori-WCD25099')]).statut, plan([L(1, 'X-PRBRS-150'), L(2, 'Munkidori-WCD25099')]).raison], ['refus', 'origine-non-decodee']);
    verifier('deux origines, meme numero (BRS 150 et SVI 150) : refus', plan([L(1, 'X-PRBRS-150'), L(2, 'X-PRSVI-150')]).raison, 'deux-origines-meme-numero');
    verifier('   meme numero a un zero pres (BRS 085 et SVI 85) : refus', plan([L(1, 'X-PRBRS-085'), L(2, 'X-PRSVI-85')]).raison, 'deux-origines-meme-numero');
    verifier('   une meme origine ecrite 085 / 85 n\'est qu\'une origine : hors forme', plan([L(1, 'X-PRBRS-085'), L(2, 'X-V2-PRBRS-85')]).statut, 'hors-forme');
    verifier('l\'origine deja stockee sur la ligne contredit le slug : refus', plan([L(1, 'X-PRBRS-150', { origine: { code: 'BRS', numero: '151' } }), L(2, 'X-PRMEG-131')]).raison, 'origine-stockee-en-desaccord');
    verifier('une ligne d\'un AUTRE set (slugSet) : refus', plan([L(1, 'X-PRBRS-150'), L(2, 'X-PRMEG-131', { slugSet: 'Autre' })]).raison, 'ligne-hors-du-set');
    verifier('numeroFiche deja pose et d\'accord : jamais reecrit (absent de numeros) ; en desaccord : refus', [[...plan([L(1, 'X-PRBRS-150', { numeroFiche: '150' }), L(2, 'X-PRMEG-131')]).numeros.keys()], plan([L(1, 'X-PRBRS-150', { numeroFiche: '999' }), L(2, 'X-PRMEG-131')]).raison], [['148517|2'], 'numeroFiche-contredit']);
    const deja = { ...ultra(db), impressions: [...ultra(db).impressions, { ...IMP(NOM, '131') }, { ...IMP(NOM, '150') }] };
    const toutes = lignesDe(db, 148517).map(l => ({ ...l, numeroFiche: /BRS/.test(l.slug) ? '150' : '131' }));
    verifier('deja fait (memes impressions, memes numeroFiche) : statut « deja », rien a ecrire', FM.planFiche({ set, carte: deja, lignes: toutes, nom: NOM }).statut, 'deja');
    verifier('   etat partiel (une impression sur deux) : refus', FM.planFiche({ set, carte: { ...ultra(db), impressions: [...ultra(db).impressions, IMP(NOM, '131')] }, lignes: lignesDe(db, 148517), nom: NOM }).raison, 'etat-partiel');

    // ── executer : la simulation par defaut, avec la regle du site importee ──
    db = monde();
    let av = etat(db), R = await FM.executer({ db, deps, sets: ['Promos'], attendu: null, ecrire: false, log: () => {}, err: () => {} });
    const s0 = R.rapport.sets[0];
    verifier('simulation : exit 0 et RIEN d\'ecrit', [R.code, etat(db) === av], [0, true]);
    verifier('   2 fiches a ecrire (Ultra Ball, Eevee), Pidgey (une origine) hors forme', [s0.aEcrire, s0.horsForme, s0.refus.length], [2, 1, 0]);
    verifier('   produits servis 9 -> 9, 0 perdu, 0 double, 0 produit sur la fiche d\'une autre carte', [s0.servisAvant, s0.servisApres, s0.perdus, s0.doublesApres, s0.autreCarte], [9, 9, 0, 0, 0]);
    verifier('   LE CONTROLE TRANSVERSAL : fiches qui ouvrent deux cartes d\'origine 2 -> 0 (sur la population)', [s0.multiAvant, s0.multiApres], [2, 0]);
    verifier('   chaque produit tombe sur la fiche de SON numero d\'origine (6 + 2)', s0.surLaBonneFiche, 8);

    // ── l'ecriture : ajouts seulement, relue ──
    const avant = structuredClone({ ultra: ultra(db), pidgey: CARTE(db)(7), lignes: db.brut('cartes_produits'), set: db.brut('sets')[0] });
    R = await FM.executer({ db, deps, sets: ['Promos'], attendu: 2, ecrire: true, log: () => {}, err: () => {}, le: new Date('2026-10-13T12:00:00Z') });
    verifier('ecriture : exit 0, relecture sans ecart', [R.code, R.rapport.ecarts], [0, []]);
    const apres = ultra(db);
    verifier('   cartes.impressions : les anciennes dans leur ordre, les 2 neuves ajoutees a la FIN (131 puis 150)', [apres.impressions.slice(0, 1), apres.impressions.slice(1).map(i => [i.expansion, i.numero])], [avant.ultra.impressions, [[NOM, '131'], [NOM, '150']]]);
    verifier('   🔑 liens.idProduct, sets, images : intacts et dans le meme ordre', [apres.liens, apres.sets, apres.images], [avant.ultra.liens, avant.ultra.sets, avant.ultra.images]);
    verifier('   numeroFiche : pose sur les 8 lignes, aucune autre valeur modifiee (slug, idProduct, preuve...)', [lignesDe(db, 148517).map(l => l.numeroFiche).join(','), lignesDe(db, 148517).every(l => { const { numeroFiche, ...reste } = l; return JSON.stringify(reste) === JSON.stringify(avant.lignes.find(a => a._id === l._id)); })], ['150,150,150,131,131,131', true]);
    verifier('   Eevee : meme geste ; Pidgey (une origine) et la ligne d\'un autre set : intacts', [CARTE(db)(8).impressions.map(i => i.numero), JSON.stringify(CARTE(db)(7)) === JSON.stringify(avant.pidgey), LIG(db)('1|1').numeroFiche, LIG(db)('7|5001').numeroFiche], [['167', '133'], true, undefined, undefined]);
    verifier('   le set : SEUL bulba.expansion change (null -> le nom), tout le reste du document est identique', [db.brut('sets')[0].bulba.expansion, JSON.stringify({ ...db.brut('sets')[0], bulba: { ...db.brut('sets')[0].bulba, expansion: null } }) === JSON.stringify(avant.set)], [NOM, true]);
    // la regle du site, rejouee sur la base ECRITE : Ultra Ball a deux fiches, 3 + 3
    const docs = db.brut('cartes').filter(c => c.sets.includes('Promos')), ls = db.brut('cartes_produits').filter(l => l.idExpansion === 2107);
    const F = X.fichesDesProduits(regle, db.brut('sets')[0], docs, ls).fiche;
    verifier('   la regle du site sur la base ecrite : 701604 -> fiche n°150, 861240 -> fiche n°131, 9 produits servis', [F.get(701604).numero, F.get(861240).numero, F.get(873102).numero, F.size], ['150', '131', '131', 9]);

    // ── 🔑 LA CONCLUSION SUR bulba.expansion, PROUVEE PAR LA REGLE DU SITE IMPORTEE : sans nom sur le set, aucune impression ne le repare ──
    {
        const m = monde(), docs0 = m.brut('cartes').filter(c => c.sets.includes('Promos')), ls0 = m.brut('cartes_produits').filter(l => l.idExpansion === 2107).map(l => (l.carteId === 148517 ? { ...l, numeroFiche: /BRS/.test(l.slug) ? '150' : '131' } : l));
        const docsNul = docs0.map(d => (d._id === 148517 ? { ...d, impressions: [...d.impressions, IMP(null, '150'), IMP(null, '131')] } : d));
        const docsSynth = docs0.map(d => (d._id === 148517 ? { ...d, impressions: [...d.impressions, IMP(NOM, '150'), IMP(NOM, '131')] } : d));
        const f1 = X.fichesDesProduits(regle, SET(), docsNul, ls0).fiche, f2 = X.fichesDesProduits(regle, SET(), docsSynth, ls0).fiche, f3 = X.fichesDesProduits(regle, SET({ bulba: { expansion: NOM } }), docsSynth, ls0).fiche;
        verifier('sans bulba.expansion, ni une impression a expansion nulle ni une impression au nom du set ne cree de fiche numerotee (les 6 produits restent sur UNE fiche sans numero)', [f1.get(701604).numero, f1.get(861240).numero, f2.get(701604).numero, f2.get(861240).numero], [null, null, null, null]);
        verifier('   avec bulba.expansion = le nom : 701604 -> 150, 861240 -> 131', [f3.get(701604).numero, f3.get(861240).numero], ['150', '131']);
    }

    // ── rejouer : rien a faire, rien ne bouge ──
    av = etat(db); R = await FM.executer({ db, deps, sets: ['Promos'], attendu: 0, ecrire: true, log: () => {}, err: () => {} });
    verifier('rejeu apres ecriture : exit 0, 0 a ecrire, 2 « deja », la base ne bouge pas', [R.code, R.rapport.sets[0].aEcrire, R.rapport.sets[0].deja, etat(db) === av], [0, 0, 2, true]);

    // ── les gardes de l'ecriture ──
    db = monde(); av = etat(db);
    R = await FM.executer({ db, deps, sets: ['Promos'], attendu: 3, ecrire: true, log: () => {}, err: () => {} });
    verifier('--attendu qui ne colle pas (3 pour 2) : exit 1, rien d\'ecrit', [R.code, etat(db) === av], [1, true]);
    R = await FM.executer({ db, deps, sets: ['Promos'], attendu: null, ecrire: true, log: () => {}, err: () => {} });
    verifier('--ecrire sans --attendu : exit 2, rien d\'ecrit', [R.code, etat(db) === av], [2, true]);
    R = await FM.executer({ db, deps, sets: ['Inconnu'], attendu: null, ecrire: false, log: () => {}, err: () => {} });
    verifier('un set absent de la base : exit 1', R.code, 1);

    // ── les gardes de la simulation : un set qui perdrait un produit, ou qui en deplacerait un, n'est PAS ecrit ──
    // (a) le document porte une image SANS numero dans ce set : le site repasserait le set en « une fiche par document » (documentAmbigu)
    db = monde({ imagesUltra: [{ set: 'Promos', numero: null, cleR2: 'x/y.webp' }] }); av = etat(db);
    R = await FM.executer({ db, deps, sets: ['Promos'], attendu: null, ecrire: false, log: () => {}, err: () => {} });
    verifier('image du set sans numero sur Ultra Ball : le set est REFUSE par la simulation, 0 a ecrire', [R.rapport.sets[0].statut, R.rapport.sets[0].aEcrire, etat(db) === av], ['refuse-simulation', 0, true]);
    verifier('   documentAmbigu (site, importe) est calcule avant/apres : par impression true -> false, le detail le DIT', [R.rapport.sets[0].parImpressionAvant, R.rapport.sets[0].parImpressionApres, /documentAmbigu/.test(R.rapport.sets[0].detail)], [true, false, true]);
    // (b) une autre carte declare DEJA le nom d'expansion : poser bulba.expansion lui ferait gagner des fiches
    db = monde({ cartes: [{ _id: 9, nomEn: 'Intrus', sets: ['Promos'], impressions: [IMP(NOM, '1')], images: [], liens: { idProduct: [], idMetacards: [] } }] });
    R = await FM.executer({ db, deps, sets: ['Promos'], attendu: null, ecrire: false, log: () => {}, err: () => {} });
    verifier('une carte etrangere declare deja le nom : le set est REFUSE (le nom doit etre declare par nos seules impressions)', [R.rapport.sets[0].statut, R.rapport.sets[0].aEcrire], ['refuse-nom-declare', 0]);
    // (c) bulba.expansion deja posee a autre chose : jamais ecrasee
    db = monde({ set: { bulba: { titre: 'T', expansion: 'Promos Bulba' } } });
    R = await FM.executer({ db, deps, sets: ['Promos'], attendu: null, ecrire: false, log: () => {}, err: () => {} });
    verifier('bulba.expansion deja posee ailleurs : jamais ecrasee, set refuse', [R.rapport.sets[0].statut, R.rapport.sets[0].aEcrire], ['refuse-expansion-posee', 0]);
    // (d) aucune fiche a ecrire : le set n'est PAS nomme
    db = monde({ lignes: [] }); await db.collection('cartes_produits').updateOne({ _id: '148517|861240' }, { $set: { slug: 'Ultra-Ball-V4-PRBRS-150' } });
    R = await FM.executer({ db, deps, sets: ['Promos'], attendu: null, ecrire: false, log: () => {}, err: () => {} });
    verifier('une ligne d\'Ultra Ball dont le slug contredit l\'origine stockee : la fiche est refusee, il ne reste que Eevee a ecrire',[R.rapport.sets[0].aEcrire], [1]);
    db = fakeDb({ sets: [SET()], cartes: [{ _id: 7, nomEn: 'Pidgey', sets: ['Promos'], impressions: [], images: [], liens: { idProduct: [5001], idMetacards: [] } }], cartes_produits: [LIGNE(5001, 7, 'Pidgey-PRMEW-016')] });
    av = etat(db); R = await FM.executer({ db, deps, sets: ['Promos'], attendu: 0, ecrire: true, log: () => {}, err: () => {} });
    verifier('aucune fiche de la forme : le set n\'est pas nomme, exit 1 (rien a faire), rien d\'ecrit', [R.code, etat(db) === av], [1, true]);

    // ── une ecriture qui perd une mise a jour est RELUE et DITE ──
    db = fakeDb({ sets: [SET()], cartes: monde().brut('cartes'), cartes_produits: monde().brut('cartes_produits') }, { ecrire: () => {} });
    const perdre = fakeDb({ sets: [SET()], cartes: monde().brut('cartes'), cartes_produits: monde().brut('cartes_produits') });
    const vraiUpdate = perdre.collection('cartes').updateOne;
    const dbPerte = { collection: nom => { const c = perdre.collection(nom); return nom === 'cartes' ? { ...c, updateOne: async (f, u) => (f._id === 8 ? { matchedCount: 1, modifiedCount: 0 } : c.updateOne(f, u)) } : c; }, brut: perdre.brut };
    R = await FM.executer({ db: dbPerte, deps, sets: ['Promos'], attendu: 2, ecrire: true, log: () => {}, err: () => {} });
    verifier('une impression qui ne s\'ecrit pas (modifiedCount 0) : exit 1, l\'arret est dit', [R.code, R.rapport.erreur != null], [1, true]);

    console.log(`\n${ok} passes, ${ko} en echec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
