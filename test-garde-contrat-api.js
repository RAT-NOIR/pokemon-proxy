// node test-garde-contrat-api.js — la garde de lot vérifie le CONTRAT DE L'API (décision du testeur, 2026-10-19).
// PUR : aucune base, aucun réseau. Le banc importe la VRAIE chaîne de l'API (lireEntree, estVariante, PROJECTIONS, decider) par chargerApi :
// c'est le contrat réel qui est testé, pas une copie. Si l'API est introuvable, le banc ÉCHOUE (il ne passe pas).
// Le cas fondateur : Frosmoth (carte 245005), image du set Sword-Shield n°064 partagée par 5 produits, tamponNonRepresente de 78 caractères,
// refusé par l'API (40 au plus) — 5 produits ont perdu leur visuel, la garde de comptes n'a rien vu.
const os = require('os');
const path = require('path');
const G = require('./collecte-cartes/garde-contrat-api');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const copie = o => structuredClone(o);

// L'entrée type d'un produit de Frosmoth, telle que decider la rend : séparée par la variante ET portant sa liste de produits partagés.
const PRODUITS = [436454, 450593, 450598, 450603, 450608];
const entree = (surcharge = {}) => ({
    idProduct: 450593, vignette: { cle: 'v/frosmoth.webp', w: 200, h: 280 }, grande: { cle: 'g/frosmoth.webp', w: 600, h: 840 }, visuel: 'du-set', mention: null,
    idMetacard: null, numero: '064', rarete: null, total: null, variante: 'league+place-1', setNom: 'Sword & Shield', lien: null,
    partageeHoloNonHolo: null, partageeTamponNonSepare: false, produitsPartages: PRODUITS, tamponNonRepresente: null, basseDefinition: null, ...surcharge
});
const TAMPON_78 = 'x'.repeat(78);

(async () => {
    // ── 0. L'API est chargée, ou le banc échoue
    let api;
    try { api = await G.chargerApi(); } catch (e) { console.log(`❌ chargerApi : ${e.message}`); process.exit(1); }
    verifier('chargerApi : rend la vraie lireEntree, la vraie estVariante, decider et les PROJECTIONS',
        [typeof api.lireEntree, typeof api.estVariante, typeof api.decider, Object.keys(api.PROJECTIONS).sort().join(',')], ['function', 'function', 'function', 'cartes,cartes_produits,sets']);

    const juge = (e, variante = e.variante) => G.jugerEntree(api, e, variante);
    const carte = (...es) => new Map(es.map(e => [e.idProduct, juge(e)]));

    // ── 1. LE CAS FONDATEUR
    const sain = carte(entree());
    verifier('l\'entrée saine est admise par la vraie lireEntree', sain.get(450593).ok, true);
    let c = G.comparerContrat(sain, carte(entree({ tamponNonRepresente: TAMPON_78 })));
    verifier('tamponNonRepresente de 78 caractères sur une entrée qui ne l\'avait pas : 1 nouveau', c.nouveaux.length, 1);
    verifier('… avec le motif de l\'API, lu de la vraie lireEntree (pas recopié)', c.nouveaux[0].motif, api.lireEntree(entree({ tamponNonRepresente: TAMPON_78 })).motif);
    verifier('… et le motif nomme bien le champ', /tamponNonRepresente/.test(c.nouveaux[0].motif), true);
    verifier('… idProduct porté', c.nouveaux[0].idProduct, 450593);
    c = G.comparerContrat(sain, carte(entree({ tamponNonRepresente: 'x'.repeat(40) })));
    verifier('exactement 40 caractères : admis (la limite est celle de l\'API)', [c.nouveaux.length, c.persistants.length], [0, 0]);
    c = G.comparerContrat(sain, carte(entree({ tamponNonRepresente: 'x'.repeat(41) })));
    verifier('41 caractères : refusé', c.nouveaux.length, 1);

    // ── 2. LE MÊME, PASSÉ À « League » : résolu
    const avantFaux = carte(entree({ tamponNonRepresente: TAMPON_78 }));
    c = G.comparerContrat(avantFaux, carte(entree({ tamponNonRepresente: 'League' })));
    verifier('tampon corrigé en « League » : 0 nouveau, 0 persistant, 1 résolu', [c.nouveaux.length, c.persistants.length, c.resolus.length], [0, 0, 1]);

    // ── 3. UN REFUS DÉJÀ PRÉSENT AVANT : persistant, ne bloque pas
    c = G.comparerContrat(avantFaux, carte(entree({ tamponNonRepresente: TAMPON_78 })));
    verifier('refus déjà présent avant et après : persistant, 0 nouveau (ne bloque pas)', [c.nouveaux.length, c.persistants.length, c.resolus.length], [0, 1, 0]);

    // ── 4. produitsPartages de 7
    c = G.comparerContrat(sain, carte(entree({ produitsPartages: [450593, 1, 2, 3, 4, 5, 6] })));
    verifier('produitsPartages de 7 (le plafond de l\'API est 6) : nouveau', c.nouveaux.length, 1);
    // ── 5. variante hors liste : PERDUE en silence par lireEntree
    const hors = entree({ variante: 'staff+bidule' });
    verifier('lireEntree n\'est PAS refusante sur une variante hors liste (elle la met à null) — c\'est pour ça que la garde compare la ligne',
        [api.lireEntree(hors).ok, api.lireEntree(hors).doc.variante], [true, null]);
    c = G.comparerContrat(sain, new Map([[450593, juge(hors, 'staff+bidule')]]));
    verifier('variante hors liste (staff+bidule) : nouveau (variante perdue)', [c.nouveaux.length, c.nouveaux[0]?.motif.includes('variante')], [1, true]);
    c = G.comparerContrat(new Map([[450593, juge(hors, 'staff+bidule')]]), new Map([[450593, juge(hors, 'staff+bidule')]]));
    verifier('variante perdue déjà avant : pas nouvelle (0 nouveau)', c.nouveaux.length, 0);
    verifier('une ligne SANS variante et une entrée sans variante : rien de perdu', juge(entree({ variante: null }), null).variantePerdue, false);
    // ── 6. booléen
    c = G.comparerContrat(sain, carte(entree({ partageeTamponNonSepare: 'oui' })));
    verifier('partageeTamponNonSepare: \'oui\' : nouveau', c.nouveaux.length, 1);
    // ── 7. entrée absente avant (produit nouveau) et refusée après : nouveau ; absente après : pas un refus
    c = G.comparerContrat(new Map(), carte(entree({ tamponNonRepresente: TAMPON_78 })));
    verifier('produit absent avant, refusé après : nouveau', c.nouveaux.length, 1);
    c = G.comparerContrat(avantFaux, new Map());
    verifier('refusé avant, absent après : plus refusé (résolu), 0 nouveau', [c.nouveaux.length, c.resolus.length], [0, 1]);

    // ── 8. LES SETS TOUCHÉS : le cas que setsTouches (garde-lot.js) ne voit pas
    const etat = () => ({
        sets: [{ _id: 'Sword-Shield', idExpansion: 6000 }, { _id: 'Autre', idExpansion: 6001 }],
        cartes: [{ _id: 245005, nomEn: 'x', sets: ['Sword-Shield'], impressions: [], images: [{ set: 'Sword-Shield', cleR2: 'a/b', numero: '064', partageeTamponNonSepare: false, produitsPartages: PRODUITS, tamponNonRepresente: 'League' }] },
            { _id: 2, nomEn: 'x', sets: ['Autre'], impressions: [], images: [] }],
        cartesProduits: [{ _id: 'l1', carteId: 245005, idProduct: 450593, idExpansion: 6000, slugSet: 'Sword-Shield', variante: 'league+place-1' },
            { _id: 'l2', carteId: 2, idProduct: 9, idExpansion: 6001, slugSet: 'Autre', variante: null }]
    });
    const touches = (modifier) => { const b = etat(), a = etat(); modifier(a); return G.setsTouchesContrat({ avant: b, apres: a }); };
    verifier('rien ne change : aucun set touché', touches(() => { }), []);
    verifier('un champ change DANS une entrée images existante (tampon 78 car.) : le set de l\'entrée est touché',
        touches(a => { a.cartes[0].images[0].tamponNonRepresente = TAMPON_78; }), ['Sword-Shield']);
    verifier('l\'ordre des clés ne compte pas', touches(a => { const i = a.cartes[0].images[0]; a.cartes[0].images[0] = Object.fromEntries(Object.entries(i).reverse()); }), []);
    verifier('une ligne cartes_produits changée : son slugSet est touché', touches(a => { a.cartesProduits[1].variante = 'staff'; }), ['Autre']);
    verifier('une ligne qui change de slugSet : les deux (avant ∪ après)', touches(a => { a.cartesProduits[0].slugSet = 'Autre'; }), ['Autre', 'Sword-Shield']);
    verifier('un document sets changé : son _id', touches(a => { a.sets[1].nomAffichage = 'Nouveau'; }), ['Autre']);
    verifier('une carte ajoutée : tous ses sets', touches(a => { a.cartes.push({ _id: 3, nomEn: 'x', sets: ['Autre', 'Sword-Shield'], impressions: [], images: [] }); }), ['Autre', 'Sword-Shield']);
    verifier('une carte retirée : ses sets et ceux de ses images', touches(a => { a.cartes.splice(0, 1); }), ['Sword-Shield']);
    verifier('une carte qui change de set : sets avant ∪ après', touches(a => { a.cartes[1].sets = ['Sword-Shield']; }), ['Autre', 'Sword-Shield']);
    verifier('une collection vide ou absente côté avant/après LÈVE (rien ne se compare sur du vide)', (() => { try { G.setsTouchesContrat({ avant: { sets: [], cartes: [], cartesProduits: [] }, apres: etat() }); return 'passé'; } catch { return 'levé'; } })(), 'levé');

    // ── 9. LA PROJECTION : la même que l'API
    const complet = { _id: 7, nomEn: 'Frosmoth', secret: 1, sets: ['A'], impressions: [{ tirage: 'intl', expansion: 'X', illustrateur: 'Z', numero: '1' }, 5],
        images: [{ set: 'A', cleR2: 'k', jointeLe: new Date(0), vignette: { cleR2: 'v', w: 1, h: 2, sha: 'z' }, tamponNonRepresente: 'League' }] };
    const p = G.projeter([complet], api.PROJECTIONS.cartes)[0];
    verifier('projeter : les champs hors projection tombent (jointeLe, illustrateur, secret)', [p.secret, p.images[0].jointeLe, p.impressions[0].illustrateur], [undefined, undefined, undefined]);
    verifier('projeter : les champs de la projection restent, sous-documents compris', [p.nomEn, p.images[0].vignette, p.images[0].tamponNonRepresente, p.impressions[0].numero], ['Frosmoth', { cleR2: 'v', w: 1, h: 2 }, 'League', '1']);
    verifier('projeter : un élément de tableau qui n\'est pas un document est écarté (comme Mongo)', p.impressions.length, 1);
    verifier('projeter est idempotente', JSON.stringify(G.projeter([p], api.PROJECTIONS.cartes)[0]), JSON.stringify(p));

    // ── 9 bis. DE BOUT EN BOUT sur la VRAIE `decider` (règle du site embarquée, sans base) : le cas de Frosmoth, 5 produits, variantes normale puis league+place-1 à 4
    const VARIANTES = ['normale', 'league+place-1', 'league+place-2', 'league+place-3', 'league+place-4'];
    const frosmoth = (tampon, variantes = VARIANTES, rareteAutre = null, marquee = true) => ({
        sets: [{ _id: 'Sword-Shield', idExpansion: 6000, nomAffichage: 'Sword & Shield', tirage: 'intl', region: 'intl', code: 'SSH', bulba: { expansion: 'Sword & Shield' } }],
        cartes: [{ _id: 245005, nomEn: 'Frosmoth', sets: ['Sword-Shield'], impressions: [{ tirage: 'intl', expansion: 'Sword & Shield', numero: '064', total: '202', rarete: 'Uncommon' }],
            images: [{ set: 'Sword-Shield', cleR2: 'bulbapedia/frosmoth.png', w: 600, h: 840, numero: '064', langue: 'en', source: 'bulbapedia', jointeLe: new Date(0),
                vignette: { cleR2: 'vignettes/frosmoth.webp', w: 200, h: 280 }, ...(marquee ? { partageeTamponNonSepare: false, tamponNonRepresente: tampon } : {}) }] },
        { _id: 2, nomEn: 'Autre', sets: ['Sword-Shield'], impressions: [{ tirage: 'intl', expansion: 'Sword & Shield', numero: '001', total: '202', rarete: rareteAutre }], images: [] }],
        cartesProduits: PRODUITS.map((p, i) => ({ _id: `l${p}`, carteId: 245005, idProduct: p, idExpansion: 6000, numeroFiche: '064', slug: `Frosmoth-V${i + 1}-SSH064`, slugSet: 'Sword-Shield', variante: variantes[i], variantePreuve: 'preuve' }))
    });
    let v = await G.verifierContrat({ api, avant: frosmoth('League'), apres: frosmoth(TAMPON_78) });
    verifier('bout en bout (decider réel) : tampon de 78 caractères sur l\'image de Frosmoth = 5 refus NOUVEAUX', [v.nouveaux.map(n => n.idProduct).sort(), v.persistants.length, v.resolus.length], [[...PRODUITS].sort(), 0, 0]);
    verifier('… dénominateur imprimé : 5 entrées avant (admises), 5 après, le set touché nommé', [v.entreesAvant, v.entreesApres, v.slugs, v.setsFautifs], [5, 5, ['Sword-Shield'], ['Sword-Shield']]);
    verifier('… la ligne imprimée porte les trois comptes', G.ligneContrat(v), 'contrat API : 1 set(s) rejoué(s) · refus nouveaux 5 · persistants 0 · résolus 0');
    v = await G.verifierContrat({ api, avant: frosmoth(TAMPON_78), apres: frosmoth('League') });
    verifier('bout en bout : corrigé en « League » = 0 nouveau, 5 résolus', [v.nouveaux.length, v.resolus.length], [0, 5]);
    v = await G.verifierContrat({ api, avant: frosmoth(TAMPON_78), apres: frosmoth(TAMPON_78, VARIANTES, 'Rare') });
    verifier('bout en bout : les 5 refus étaient déjà là avant (le lot touche le set par ailleurs) : persistants, rien ne bloque', [v.nouveaux.length, v.persistants.length], [0, 5]);
    const HORS = ['normale', 'league+place-1', 'league+place-2', 'league+place-3', 'league+bidule'];
    v = await G.verifierContrat({ api, avant: frosmoth(null, VARIANTES, null, false), apres: frosmoth(null, HORS, null, false) });
    verifier('bout en bout : une variante de ligne hors liste fermée (league+bidule), entrée servie = 1 variante perdue NOUVELLE', [v.nouveaux.length, v.nouveaux[0]?.idProduct, /variante/.test(v.nouveaux[0]?.motif || '')], [1, 450608, true]);
    v = await G.verifierContrat({ api, avant: frosmoth('League'), apres: frosmoth('League', HORS) });
    verifier('TOUR 1, bout en bout sur la vraie decider : la même variante sur une image à partage — decider ÉCARTE l\'entrée (produit « sans entrée après » montré) MAIS le contrôle par LIGNE la bloque : 1 nouveau',
        [v.nouveaux.map(n => n.idProduct), /variante « league\+bidule » hors de la liste de l'API \(ligne cartes_produits\)/.test(v.nouveaux[0]?.motif || ''), v.disparus.map(d => d.idProduct), G.ligneContrat(v).includes('sans entrée après')], [[450608], true, [450608], true]);
    v = await G.verifierContrat({ api, avant: frosmoth('League', HORS), apres: frosmoth('League', HORS, 'Rare') });
    verifier('TOUR 1 : ligne déjà hors liste avant ET après (le lot touche le set par ailleurs) : persistant, 0 nouveau', [v.nouveaux.length, v.persistants.map(p => p.idProduct)], [0, [450608]]);
    v = await G.verifierContrat({ api, avant: frosmoth(null, VARIANTES, null, false), apres: frosmoth(null, HORS, null, false) });
    verifier('TOUR 1 : variante hors liste ET variante perdue pour le même produit : UNE seule entrée dans nouveaux', v.nouveaux.map(n => n.idProduct), [450608]);

    // ── 9 ter. TOUR 1 — le contrôle PAR LIGNE, en isolation (clé : idProduct) ; ce que estVariante dit de chaque forme, lu de l'API
    const lg = (idProduct, variante) => ({ _id: `l${idProduct}`, carteId: 1, idProduct, variante });
    const vl = G.violationsParLigne(api, [lg(1, 'staff+bidule'), lg(2, 'normale'), lg(3, 'jumbo'), lg(4, 'league+place-1'), lg(5, null), { _id: 'x', idProduct: 6 }, lg(7, ''), lg(8, ' staff '), lg(9, 'staff-prerelease'), lg(10, 'Staff'), lg(11, 12)]);
    // D3.1 (2026-10-24) : le contrôle par ligne applique EXACTEMENT ce que decider fait de la variante d'une ligne — normaliserVariante (marques-tampon.js ; decision.js : varianteProuvee, varianteHorsListe), sans trim :
    // la forme ancienne « staff-prerelease » est LUE « staff+prerelease » (rien n'est perdu : pas une violation) ; « ' staff ' » n'est PAS lu (decider ne la trimme pas : elle est perdue — une violation). L'ancien contrôle
    // faisait l'inverse des deux (estVariante brute après un trim que decider n'applique qu'APRÈS la normalisation, jamais avant).
    verifier('par ligne : seules les valeurs que decider ne sait pas LIRE (normaliserVariante null, sans trim) sont des violations', [...vl.keys()].sort((a, b) => a - b), [1, 7, 8, 10, 11]);
    verifier('par ligne : normale et jumbo ne sont pas traitées à part — normaliserVariante les lit', [api.normaliserVariante('normale'), api.normaliserVariante('jumbo'), vl.has(2), vl.has(3)], ['normale', 'jumbo', false, false]);
    verifier('par ligne : null et absente : conformes', [vl.has(5), vl.has(6)], [false, false]);
    verifier('par ligne : « staff » entouré d\'espaces : VIOLATION (decider la perd, il ne trimme pas avant de normaliser)', [vl.has(8), api.normaliserVariante(' staff ')], [true, null]);
    verifier('par ligne : la forme ancienne « staff-prerelease » (lue par decider via normaliserVariante) N\'EST PAS une violation', [vl.has(9), api.estVariante('staff-prerelease'), api.normaliserVariante('staff-prerelease')], [false, false, 'staff+prerelease']);
    // le même fait, de bout en bout sur la VRAIE decider : une ligne à l'ancienne forme, avec sa preuve, est servie en `staff+prerelease` ; sans preuve, elle est perdue (variantePerdue, déjà comptée par l'entrée)
    {
        const avecForme = (variante, preuve = 'preuve') => { const e = frosmoth('League'); e.cartesProduits[1].variante = variante; if (preuve) e.cartesProduits[1].variantePreuve = preuve; else delete e.cartesProduits[1].variantePreuve; return e; };
        let w = await G.verifierContrat({ api, avant: frosmoth('League'), apres: avecForme('staff-prerelease') });
        verifier('D3.1 bout en bout : ligne `staff-prerelease` AVEC preuve : decider la lit, 0 nouveau (le lot n\'est pas bloqué à tort)', [w.nouveaux.length, w.persistants.length], [0, 0]);
        w = await G.verifierContrat({ api, avant: frosmoth('League'), apres: avecForme('staff-prerelease', null) });
        verifier('D3.1 bout en bout : la même ligne SANS preuve : decider écarte l\'entrée (variante non prouvée sur une image qui partage) — ce n\'est pas une violation de LIGNE, le visuel perdu est montré en information (disparus)', [w.nouveaux.length, w.disparus.map(d => d.idProduct)], [0, [450593]]);
        w = await G.verifierContrat({ api, avant: frosmoth('League'), apres: avecForme(' staff ') });
        verifier('D3.1 bout en bout : ligne `\' staff \'` avec preuve : hors liste pour decider — 1 nouveau, motif de ligne', [w.nouveaux.length, /hors de la liste de l'API \(ligne cartes_produits\)/.test(w.nouveaux[0]?.motif || '')], [1, true]);
    }
    c = G.comparerContrat(new Map([[1, { ok: true, motif: null, variantePerdue: false }]]), new Map([[1, { ok: true, motif: null, variantePerdue: false, ligneHorsListe: 'staff+bidule', sansEntree: true }]]));
    verifier('comparerContrat : violation par ligne après seulement, produit sans entrée : 1 nouveau', [c.nouveaux.length, c.nouveaux[0]?.motif, c.disparus.length], [1, 'variante « staff+bidule » hors de la liste de l\'API (ligne cartes_produits)', 1]);
    c = G.comparerContrat(new Map([[1, { ok: true, variantePerdue: true, ligneHorsListe: 'x+y' }]]), new Map([[1, { ok: true, variantePerdue: true, ligneHorsListe: 'x+y' }]]));
    verifier('comparerContrat : violation par ligne avant ET après : persistant, 0 nouveau', [c.nouveaux.length, c.persistants.length], [0, 1]);
    c = G.comparerContrat(new Map(), new Map([[1, { ok: true, variantePerdue: true, ligneHorsListe: 'x+y' }]]));
    verifier('comparerContrat : variantePerdue ET ligneHorsListe pour le même produit : une seule entrée', c.nouveaux.length, 1);
    v = await G.verifierContrat({ api, avant: frosmoth('League'), apres: frosmoth('League') });
    verifier('bout en bout : rien ne change = aucun set rejoué, aucun refus', [v.slugs.length, v.nouveaux.length, v.entreesApres], [0, 0, 0]);

    // ── 9 quater. D3.2 — LA FERMETURE DES SETS REJOUÉS : les sets d'où viennent les visuels « autre-tirage » et « substitut » des produits touchés
    // Un produit d'un set sans visuel propre se sert de l'image d'un AUTRE set de sa carte ; choisirVisuel classe ces images par le tirage et la région de leur set (setsBase) : sans ces sets, le classement
    // est celui d'un monde amputé et la décision peut désigner une AUTRE image que la production (avec un défaut qu'elle n'a pas, ou sans celui qu'elle a). Banc dans les DEUX sens.
    const SET = (id, exp, tirage, code) => ({ _id: id, idExpansion: exp, nomAffichage: id, tirage, region: tirage, code, bulba: { expansion: `${id} Expansion` } });
    const IMG = (set, cle, extra = {}) => ({ set, cleR2: cle, w: 600, h: 840, numero: '001', source: 'tcgdex', ...extra });
    const autreTirage = (surcharge = {}) => ({
        sets: [SET('X-Set', 6100, 'jp', 'XJP'), SET('Zeta-Set', 6101, 'jp', 'ZJP'), SET('Alpha-Set', 6102, 'intl', 'AEN')],
        // X n'a AUCUN visuel : le produit se sert d'un autre set de sa carte. Zeta est du MÊME tirage que X (rang 0), Alpha non : avec les deux sets connus, Zeta gagne ; sans eux, l'ordre alphabétique désigne Alpha.
        // L'image d'Alpha n'a pas de vignette (un défaut) ; celle de Zeta est saine.
        cartes: [{ _id: 500, nomEn: 'Testmon', sets: ['X-Set'], impressions: [{ tirage: 'jp', expansion: 'X-Set Expansion', numero: '001', total: '10', rarete: 'C' }],
            images: [IMG('Zeta-Set', 'z/img.webp', { vignette: { cleR2: 'v/z.webp', w: 200, h: 280 }, ...(surcharge.zeta || {}) }), IMG('Alpha-Set', 'a/img.webp', surcharge.alpha || {})] }],
        cartesProduits: [{ _id: 'l500', carteId: 500, idProduct: 777, idExpansion: 6100, numeroFiche: '001', slug: 'Testmon-X001', slugSet: 'X-Set' }]
    });
    const jugee = async (etat, slugs) => G.contratDesSets({ api, sets: etat.sets, docs: etat.cartes, lignes: etat.cartesProduits, slugs });
    const j0 = await jugee(autreTirage(), ['X-Set']);
    verifier('D3.2 : le produit d\'un set sans visuel est jugé sur l\'image que la PRODUCTION lui donne (Zeta, du même tirage), pas sur celle qu\'un monde amputé désignerait (Alpha, sans vignette)',
        [j0.has(777), j0.get(777)?.ok, j0.get(777)?.sansEntree ?? false], [true, true, false]);
    verifier('D3.2 : … les sets d\'où vient le visuel sont REJOUÉS mais ne deviennent pas des sets du produit (il garde ceux de ses lignes : X)', j0.get(777)?.sets, ['X-Set']);
    // l'autre sens : le défaut est dans l'image que la production DÉSIGNE (Zeta : tampon de 78 caractères) — il doit être vu même quand seul le set X est « touché »
    const zetaFautive = { partageeTamponNonSepare: false, produitsPartages: [777, 778], tamponNonRepresente: TAMPON_78 };
    const j1 = await jugee(autreTirage({ zeta: zetaFautive }), ['X-Set']);
    verifier('D3.2 (l\'autre sens) : le défaut de l\'image désignée par la production (Zeta) est jugé : refus, motif de la vraie lireEntree', [j1.get(777)?.ok, /tamponNonRepresente/.test(j1.get(777)?.motif || '')], [false, true]);
    // les substituts : la vignette d'un substitut est celle de l'entrée d'une AUTRE carte qui porte le même fichier ; cette carte doit être dans les documents rejoués
    const substitut = () => {
        const e = autreTirage();
        e.cartes[0].images = [];                                                          // aucune image propre : le produit n'a que son substitut
        e.cartesProduits[0].visuelSubstitut = { cleR2: 'origine/img.webp', w: 600, h: 840, mention: 'Carte d\'origine' };
        // la carte d'origine n'est membre d'AUCUN des sets rejoués (`sets` ne contient pas le set de son image) : seule la recherche par FICHIER la rapporte
        e.cartes.push({ _id: 501, nomEn: 'Origine', sets: ['Autre-Set'], impressions: [], images: [IMG('Zeta-Set', 'origine/img.webp', { vignette: { cleR2: 'v/origine.webp', w: 200, h: 280 } })] });
        return e;
    };
    const js = await jugee(substitut(), ['X-Set']);
    verifier('D3.2 : un substitut dont l\'image est portée par une AUTRE carte : cette carte est rejouée, la vignette est trouvée — le produit est admis (pas de faux refus « vignette absente »)',
        [js.get(777)?.ok, js.get(777)?.motif ?? null], [true, null]);

    // ── 9 quinquies. D3.3 — (a) le produit « contradictoire » : deux entrées aux visuels DIFFÉRENTS perdent tout visuel dans l'archive (v2/chargeur/version.js)
    const deuxSets = (avecSecondeLigne, memeImage = false) => ({
        sets: [SET('X-Set', 6100, 'jp', 'XJP'), SET('W-Set', 6103, 'jp', 'WJP')],
        cartes: [{ _id: 500, nomEn: 'Testmon', sets: ['X-Set'], impressions: [{ tirage: 'jp', expansion: 'X-Set Expansion', numero: '001', total: '10', rarete: 'C' }], images: [IMG('X-Set', 'x/img.webp', { vignette: { cleR2: 'v/x.webp', w: 200, h: 280 } })] },
            { _id: 501, nomEn: 'Testmon', sets: ['W-Set'], impressions: [{ tirage: 'jp', expansion: 'W-Set Expansion', numero: '001', total: '10', rarete: 'C' }], images: [memeImage ? IMG('W-Set', 'x/img.webp', { vignette: { cleR2: 'v/x.webp', w: 200, h: 280 } }) : IMG('W-Set', 'w/img.webp', { vignette: { cleR2: 'v/w.webp', w: 200, h: 280 } })] }],
        cartesProduits: [{ _id: 'l500', carteId: 500, idProduct: 777, idExpansion: 6100, numeroFiche: '001', slug: 'Testmon-X001', slugSet: 'X-Set' },
            ...(avecSecondeLigne ? [{ _id: 'l501', carteId: 501, idProduct: 777, idExpansion: 6103, numeroFiche: '001', slug: 'Testmon-W001', slugSet: 'W-Set' }] : []),
            { _id: 'l502', carteId: 501, idProduct: 888, idExpansion: 6103, numeroFiche: '001', slug: 'Autre-W001', slugSet: 'W-Set' }]
    });
    const jc = await G.contratDesSets({ api, ...(e => ({ sets: e.sets, docs: e.cartes, lignes: e.cartesProduits }))(deuxSets(true)), slugs: ['W-Set'] });
    verifier('D3.3a : un produit joint à deux cartes de deux sets, aux visuels différents : jugé CONTRADICTOIRE (même règle que le chargeur : version.js), AVEC ses deux sets (le set non touché est rejoué)',
        [jc.get(777)?.contradictoire === true, jc.get(777)?.sets], [true, ['W-Set', 'X-Set']]);
    const jm = await G.contratDesSets({ api, ...(e => ({ sets: e.sets, docs: e.cartes, lignes: e.cartesProduits }))(deuxSets(true, true)), slugs: ['W-Set'] });
    verifier('D3.3a (l\'autre sens) : les deux entrées portent le MÊME visuel : doublon admis par le chargeur, pas contradictoire', [jm.get(777)?.contradictoire === true, jm.get(777)?.ok], [false, true]);
    let vc = await G.verifierContrat({ api, avant: deuxSets(false), apres: deuxSets(true) });
    verifier('D3.3a : la seconde ligne apparaît dans le lot (visuels différents) : 1 NOUVEAU, motif nommé, aucune autre chose ne bouge', [vc.nouveaux.map(n => n.idProduct), /deux entrées aux visuels différents/.test(vc.nouveaux[0]?.motif || ''), vc.persistants.length], [[777], true, 0]);
    verifier('D3.3a : … seul W est touché par le lot (X est rejoué, pas écrit) : W est fautif, X ne l\'est pas', [vc.slugs, vc.setsFautifs], [['W-Set'], ['W-Set']]);
    vc = await G.verifierContrat({ api, avant: deuxSets(true), apres: (e => { e.cartes[0].nomEn = 'Testmon ex'; return e; })(deuxSets(true)) });
    verifier('D3.3a : déjà contradictoire AVANT le lot : persistant, ne bloque pas', [vc.nouveaux.length, vc.persistants.map(p => p.idProduct)], [0, [777]]);
    vc = await G.verifierContrat({ api, avant: deuxSets(true), apres: deuxSets(true, true) });
    verifier('D3.3a : le lot unifie les deux visuels : plus contradictoire, rien de nouveau', [vc.nouveaux.length, vc.persistants.length], [0, 0]);

    // ── D3.3 (b) un refus de motif A avant et de motif B après est NOUVEAU
    c = G.comparerContrat(new Map([[1, { ok: false, motif: 'motif A', sets: ['S'] }]]), new Map([[1, { ok: false, motif: 'motif B', sets: ['S'] }]]));
    verifier('D3.3b : refusé avant (A) et après (B) : NOUVEAU (le lot a fabriqué un autre défaut), pas persistant', [c.nouveaux.map(n => n.motif), c.persistants.length], [['motif B'], 0]);
    c = G.comparerContrat(new Map([[1, { ok: false, motif: 'motif A', sets: ['S'] }]]), new Map([[1, { ok: false, motif: 'motif A', sets: ['S'] }]]));
    verifier('D3.3b (l\'autre sens) : le MÊME motif avant et après : persistant, ne bloque pas', [c.nouveaux.length, c.persistants.length], [0, 1]);
    c = G.comparerContrat(new Map([[1, { ok: true, variantePerdue: false, ligneHorsListe: 'x+y' }]]), new Map([[1, { ok: true, variantePerdue: false, ligneHorsListe: 'z+t' }]]));
    verifier('D3.3b : une variante de ligne hors liste qui devient une AUTRE valeur hors liste : nouveau (le lot l\'a réécrite)', [c.nouveaux.length, c.persistants.length], [1, 0]);

    // ── 9 sexies. D3.4 — la restauration remet le tableau `images` de TOUS les sets touchés des cartes fautives, pas seulement ceux des lignes du produit
    const vf = await G.verifierContrat({ api, avant: autreTirage(), apres: autreTirage({ zeta: zetaFautive }) });
    verifier('D3.4 : l\'image fautive vit dans le set Zeta (autre tirage), le produit est dans X : la carte est fautive, ses sets TOUCHÉS (X, Zeta, Alpha) sont fautifs — le tableau `images` sera remis',
        [vf.nouveaux.map(n => n.idProduct), vf.setsFautifs], [[777], ['Alpha-Set', 'X-Set', 'Zeta-Set']]);
    verifier('D3.4 : … les cartes fautives sont portées par le verdict (la restauration les lit)', vf.nouveaux[0]?.cartes, [500]);
    const vg = await G.verifierContrat({ api, avant: deuxSets(false), apres: deuxSets(true) });
    verifier('D3.4 (l\'autre sens) : un set non touché n\'est jamais fautif (le lot n\'y a rien écrit : pas de restauration à y faire)', vg.setsFautifs.every(s => vg.slugs.includes(s)), true);

    // ── D3.5. le coût : UNE seule lecture de l'état « après » (les projections réunies), plus une troisième copie de la base
    verifier('D3.5 : unionProjections réunit les chemins sans collision parent/enfant (Mongo refuse « a » et « a.b » ensemble) et sans perdre un champ',
        [G.unionProjections({ a: 1, 'b.c': 1 }, { 'a.x': 1, 'b.d': 1, e: 1 }), G.unionProjections({ 'a.x': 1 }, { a: 1 })], [{ a: 1, 'b.c': 1, 'b.d': 1, e: 1 }, { a: 1 }]);
    verifier('D3.5 : unionProjections refuse une projection d\'exclusion (0) : la réunion d\'inclusions seulement', (() => { try { G.unionProjections({ a: 1 }, { b: 0 }); return 'passé'; } catch { return 'levé'; } })(), 'levé');
    {
        // chaque chemin de l'API et du site est COUVERT par la projection réunie : lui-même, ou un ancêtre (« images.vignette » couvre « images.vignette.cleR2 »)
        const couvert = (u, k) => k.split('.').some((_, i, a) => u[a.slice(0, i + 1).join('.')] === 1);
        const site = require('./collecte-cartes/garde-lot').PROJECTION_ETAT;
        const uc = G.unionProjections(site.cartes, api.PROJECTIONS.cartes), up = G.unionProjections(site.cartesProduits, api.PROJECTIONS.cartes_produits);
        verifier('D3.5 : chaque champ de l\'API ET du site est couvert par la projection réunie (cartes et cartes_produits) — rien ne se perd, aucun chemin parent/enfant ensemble',
            [[...Object.keys(site.cartes), ...Object.keys(api.PROJECTIONS.cartes)].every(k => couvert(uc, k)), [...Object.keys(site.cartesProduits), ...Object.keys(api.PROJECTIONS.cartes_produits)].every(k => couvert(up, k)),
                Object.keys(uc).every(k => !Object.keys(uc).some(p => p !== k && k.startsWith(`${p}.`))), Object.keys(up).every(k => !Object.keys(up).some(p => p !== k && k.startsWith(`${p}.`)))], [true, true, true, true]);
    }
    {
        const srcLot = require('fs').readFileSync(path.join(__dirname, 'lot-additif.js'), 'utf8');
        // (tour de correction 1, point 5) la réunion des projections est calculée et VALIDÉE par chargerApi, avant la sauvegarde : lot-additif.js ne l'appelle plus (aucune exception possible après l'écriture)
        verifier('D3.5 : lot-additif.js ne relit plus la base une seconde fois pour le contrat (plus de etatContrat), l\'état « après » est lu UNE fois avec les projections réunies par chargerApi',
            [/async function etatContrat/.test(srcLot), /GC\.unionProjections\(/.test(srcLot), /api\.projectionsEtat\.cartes/.test(srcLot), /async function jouerContrat\(api, avantDocs, apresDocs\)/.test(srcLot)], [false, false, true, true]);
        verifier('D3.5 : la restauration relit l\'état UNE fois (comparaison des comptes ET contrat sur la même lecture)', [/const apresRelu = await etatDeLaBase\(db, api\)/.test(srcLot), /jouerContrat\(api, docsAvant, apresRelu\.docs\)/.test(srcLot)], [true, true]);
        verifier('D3.5 : l\'en-tête de garde-contrat-api.js porte les chiffres mesurés et leur date', [/2,1 s/.test(require('fs').readFileSync(path.join(__dirname, 'collecte-cartes', 'garde-contrat-api.js'), 'utf8')), /1 073 Mo/.test(require('fs').readFileSync(path.join(__dirname, 'collecte-cartes', 'garde-contrat-api.js'), 'utf8')), /2026-10-19/.test(require('fs').readFileSync(path.join(__dirname, 'collecte-cartes', 'garde-contrat-api.js'), 'utf8'))], [true, true, true]);
    }

    // ══ TOUR DE CORRECTION 1 (2026-10-24) ══
    // ── point 5 : la réunion des projections est validée au CHARGEMENT (avant la sauvegarde)
    {
        const L = require('./collecte-cartes/garde-lot');
        verifier('T1.5 : chargerApi rend les projections réunies, déjà validées (cartes et cartes_produits)',
            [JSON.stringify(api.projectionsEtat?.cartes) === JSON.stringify(G.unionProjections(L.PROJECTION_ETAT.cartes, api.PROJECTIONS.cartes)), JSON.stringify(api.projectionsEtat?.cartesProduits) === JSON.stringify(G.unionProjections(L.PROJECTION_ETAT.cartesProduits, api.PROJECTIONS.cartes_produits)), Object.isFrozen(api.projectionsEtat)], [true, true, true]);
        const srcApi = require('fs').readFileSync(path.join(__dirname, 'collecte-cartes', 'garde-contrat-api.js'), 'utf8');
        const corpsCharger = srcApi.slice(srcApi.indexOf('async function chargerApi'), srcApi.indexOf('// ── LA PROJECTION'));
        verifier('T1.5 : la réunion est calculée DANS chargerApi (une projection invalide y refuse : code 6 avant toute écriture) et un refus déjà formé n\'est pas ré-enveloppé',
            [/unionProjections\(/.test(corpsCharger), /\^garde contrat API/.test(corpsCharger)], [true, true]);
    }

    // ── point 6 : toute ligne d'une carte changée est retenue, avec son set, quel que soit `cartes.sets`
    {
        const f1 = etat(), f2 = etat();
        for (const e of [f1, f2]) e.cartesProduits.push({ _id: 'l9', carteId: 245005, idProduct: 9, idExpansion: 9999, slugSet: 'Hors-Set', variante: null });
        f2.cartes[0].nomEn = 'y';                                              // la CARTE change, sa ligne (inchangée) vit dans un set que ni cartes.sets ni ses images ne nomment
        verifier('T1.6 : une carte changée -> le slugSet de ses LIGNES est touché, même hors de cartes.sets et de ses images', G.setsTouchesContrat({ avant: f1, apres: f2 }).includes('Hors-Set'), true);
    }
    {
        const e1 = etat(), e2 = etat();
        for (const e of [e1, e2]) e.cartesProduits.push({ _id: 'l9', carteId: 245005, idProduct: 9, idExpansion: 9999, slugSet: 'Hors-Set', variante: null });
        e2.cartes[1].nomEn = 'z';                                              // une AUTRE carte change ; la carte 245005 et sa ligne ne bougent pas
        verifier('T1.6 (l\'autre sens) : une carte inchangée n\'ajoute pas les sets de ses lignes', G.setsTouchesContrat({ avant: e1, apres: e2 }).includes('Hors-Set'), false);
    }
    {
        // la carte 500 n'est membre d'AUCUN set (cartes.sets vide) : seule la ligne la rattache à X-Set. Son image (Zeta) devient fautive.
        const sansSets = (zeta) => { const e = autreTirage(zeta ? { zeta: zetaFautive } : {}); e.cartes[0].sets = []; return e; };
        const v6 = await G.verifierContrat({ api, avant: sansSets(false), apres: sansSets(true) });
        // (decider ne sert un produit que si sa carte est MEMBRE du set : `cartes.sets` vide, il n'y a pas de fiche, donc pas d'entrée — ni avant ni après ; la règle ne fabrique donc pas de refus, elle garantit seulement que le set de la ligne est rejoué)
        verifier('T1.6 : de bout en bout, le set de la ligne (X-Set) est dans les sets rejoués alors que la carte n\'en est membre ni par `sets` ni par ses images', [v6.slugs.includes('X-Set'), v6.nouveaux.length], [true, 0]);
    }

    // ── point 7 : « persistant » = le MÊME défaut (motif ET valeur fautive)
    c = G.comparerContrat(carte(entree({ tamponNonRepresente: 'x'.repeat(78) })), carte(entree({ tamponNonRepresente: 'y'.repeat(78) })));
    verifier('T1.7 : un tamponNonRepresente fautif (78 car.) qui devient UN AUTRE texte fautif : NOUVEAU', [c.nouveaux.length, c.persistants.length], [1, 0]);
    c = G.comparerContrat(carte(entree({ tamponNonRepresente: 'x'.repeat(78) })), carte(entree({ tamponNonRepresente: 'x'.repeat(78) })));
    verifier('T1.7 (l\'autre sens) : le même texte fautif avant et après : persistant', [c.nouveaux.length, c.persistants.length], [0, 1]);
    c = G.comparerContrat(carte(entree({ tamponNonRepresente: 'x'.repeat(78) })), carte(entree({ tamponNonRepresente: 'x'.repeat(78), mention: 'autre mention' })));
    verifier('T1.7 : un champ SANS rapport qui change sur le même produit toujours refusé (la mention) : persistant, le lot n\'a pas écrit le défaut', [c.nouveaux.length, c.persistants.length], [0, 1]);
    c = G.comparerContrat(carte(entree({ partageeTamponNonSepare: 'oui' })), carte(entree({ partageeTamponNonSepare: 'peut-être' })));
    verifier('T1.7 : tout champ de marquage refusé (partageeTamponNonSepare : « oui » -> « peut-être ») : NOUVEAU', [c.nouveaux.length, c.persistants.length], [1, 0]);
    c = G.comparerContrat(carte(entree({ produitsPartages: [450593, 1, 2, 3, 4, 5, 6] })), carte(entree({ produitsPartages: [450593, 1, 2, 3, 4, 5, 6, 7] })));
    verifier('T1.7 : produitsPartages de 7 qui devient 8 : NOUVEAU (la valeur fautive a changé)', [c.nouveaux.length, c.persistants.length], [1, 0]);
    c = G.comparerContrat(new Map([[1, { ok: false, motif: 'motif inconnu de la table' }]]), new Map([[1, { ok: false, motif: 'motif inconnu de la table' }]]));
    verifier('T1.7 : jugements sans valeur (cartes fabriquées) : même motif = persistant, comme avant', [c.nouveaux.length, c.persistants.length], [0, 1]);
    verifier('T1.7 : un motif que la table ne sait pas rattacher à un champ compare l\'entrée ENTIÈRE (fail-closed)',
        [G.jugerEntree(api, 'abc').valeur === G.jugerEntree(api, 'abc').valeur, G.jugerEntree(api, 'abc').valeur === G.jugerEntree(api, 'abd').valeur, G.jugerEntree(api, 'abc').motif], [true, false, 'entrée illisible']);

    // ── point 8 : la restauration se fait par CARTE fautive
    {
        const deuxCartes = (zeta) => {
            const e = autreTirage(zeta ? { zeta: zetaFautive } : {});
            e.cartes.push({ _id: 600, nomEn: 'Autremon', sets: ['X-Set'], impressions: [{ tirage: 'jp', expansion: 'X-Set Expansion', numero: '002', total: '10', rarete: 'C' }], images: [IMG('X-Set', 'x/600.webp', { numero: '002', vignette: { cleR2: 'v/600.webp', w: 200, h: 280 } })] });
            e.cartesProduits.push({ _id: 'l600', carteId: 600, idProduct: 888, idExpansion: 6100, numeroFiche: '002', slug: 'Autremon-X002', slugSet: 'X-Set' });
            return e;
        };
        const v8 = await G.verifierContrat({ api, avant: deuxCartes(false), apres: deuxCartes(true) });
        verifier('T1.8 : le verdict nomme les CARTES fautives (la carte 500), pas celles qui partagent ses sets (la carte 600)', [v8.nouveaux.map(n => n.idProduct), v8.cartesFautives], [[777], [500]]);
        const srcLot8 = require('fs').readFileSync(path.join(__dirname, 'lot-additif.js'), 'utf8');
        verifier('T1.8 : lot-additif.js garde le tableau `images` des cartes qui ne sont pas fautives (restauration par carte), le contrat ne passe plus par les sets',
            [/cartesFautives\.has\(d\._id\)/.test(srcLot8), /cartesFautives = new Set\(contrat\?\.cartesFautives/.test(srcLot8), /\.\.\.\(contrat\?\.setsFautifs/.test(srcLot8)], [true, true, false]);
    }

    // ── point 9 : nouveaux dédoublonnés par idProduct + motif
    {
        const l = [{ idProduct: 1, motif: 'a' }, { idProduct: 1, motif: 'a' }, { idProduct: 1, motif: 'b' }, { idProduct: 2, motif: 'a' }];
        verifier('T1.9 : dedoublonner garde un exemplaire par (idProduct, motif), dans l\'ordre', G.dedoublonner(l), [{ idProduct: 1, motif: 'a' }, { idProduct: 1, motif: 'b' }, { idProduct: 2, motif: 'a' }]);
        const srcApi9 = require('fs').readFileSync(path.join(__dirname, 'collecte-cartes', 'garde-contrat-api.js'), 'utf8');
        verifier('T1.9 : comparerContrat rend ses listes dédoublonnées', /nouveaux: dedoublonner\(nouveaux\), persistants: dedoublonner\(persistants\)/.test(srcApi9), true);
    }

    // ── 10. LE CHARGEMENT ÉCHOUE FERMÉ
    let leve = null;
    try { await G.chargerApi({ dossier: path.join(os.tmpdir(), `api-inexistante-${process.pid}-${Date.now()}`) }); } catch (e) { leve = e.message; }
    verifier('chargerApi sur un dossier inexistant : LÈVE « je ne peux pas conclure »', /garde contrat API : je ne peux pas conclure/.test(leve || ''), true);

    // ── 11. verifierContrat : une exception est un refus de conclure
    let l2 = null;
    try { await G.verifierContrat({ api, avant: { sets: [], cartes: [], cartesProduits: [] }, apres: etat() }); } catch (e) { l2 = e.message; }
    verifier('verifierContrat sur un état vide : LÈVE (jamais un « tout va bien »)', typeof l2, 'string');

    // ── 12. LE CÂBLAGE de lot-additif.js (lecture de la source : le lot lui-même ne se lance pas dans un banc pur)
    const src = require('fs').readFileSync(path.join(__dirname, 'lot-additif.js'), 'utf8');
    verifier('lot-additif.js : étape 0 bis, chargerApi avant la sauvegarde, exit 6 si elle ne peut pas conclure',
        [src.indexOf('GC.chargerApi()') > 0 && src.indexOf('GC.chargerApi()') < src.indexOf("spawnSync(process.execPath, ['backup-collections.js'"), /process\.exit\(6\)/.test(src)], [true, true]);
    verifier('lot-additif.js : un refus nouveau ou une exception du contrat arrête le lot (fautivesContrat) et la relecture rejoue le contrat',
        [/!cmp\.nonAutorisees\.length && !fautivesContrat\.length/.test(src), /contratRelu = api \? await jouerContrat/.test(src), /RESTAURATION INCOMPLÈTE/.test(src)], [true, true, true]);
    verifier('lot-additif.js : la garde est active sur `cartes`, sur test_scratch seulement avec --contrat-api', [/CONTRAT_ACTIF = BASE === 'cartes' \|\| options\.includes\('--contrat-api'\)/.test(src), /non vérifié \(base de banc\)/.test(src)], [true, true]);
    verifier('lot-additif.js : AUCUNE limite recopiée (ni 40 ni 6 ni liste de variantes)', /TAMPON_MAX|PARTAGES_MAX|MARQUES\b/.test((src + require('fs').readFileSync(path.join(__dirname, 'collecte-cartes', 'garde-contrat-api.js'), 'utf8')).replace(/\/\/.*$/gm, '')), false);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ banc cassé :', e); process.exit(1); });
