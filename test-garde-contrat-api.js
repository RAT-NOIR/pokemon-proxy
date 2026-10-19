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
    verifier('bout en bout : la même variante sur une image à partage : decider ÉCARTE l\'entrée (partage incohérent) — ni refus ni variante perdue, mais un produit « sans entrée après » MONTRÉ',
        [v.nouveaux.length, v.disparus.map(d => d.idProduct), G.ligneContrat(v).includes('sans entrée après')], [0, [450608], true]);
    v = await G.verifierContrat({ api, avant: frosmoth('League'), apres: frosmoth('League') });
    verifier('bout en bout : rien ne change = aucun set rejoué, aucun refus', [v.slugs.length, v.nouveaux.length, v.entreesApres], [0, 0, 0]);

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
