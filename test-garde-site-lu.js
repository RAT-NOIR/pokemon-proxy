// node test-garde-site-lu.js — SITE_LIT (garde-lot.js) confrontée au gabarit de lecture du SITE, IMPORTÉ (collecte-cartes/garde-site-lu.js). PUR : aucune base, aucun réseau.
// Le banc importe le vrai lib/lireDonnee.ts du site (même mécanisme que exporter-donnees-logos-site.js) : site introuvable = le banc ÉCHOUE (il ne passe pas), comme celui de l'API.
// Ce que le banc garde : (1) la liste est COMPLÈTE face aux SPEC réelles, sous-champs compris ; (2) la confrontation sait dire NON (champ absent, SPEC modifiée, site absent, import qui lève, export absent) ;
// (3) lot-additif.js la joue AVANT la sauvegarde et refuse (code 6, rien de sauvegardé ni d'écrit).
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./collecte-cartes/garde-site-lu');
const { SITE_LIT } = require('./collecte-cartes/garde-lot');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const leve = async f => { try { await f(); return null; } catch (e) { return String(e.message); } };
const TEXTE = { t: 'texte' }, NOMBRE = { t: 'nombre' };
const objet = (champs) => ({ t: 'objet', champs, requis: [] });
const liste = (el) => ({ t: 'liste', el });

(async () => {
    // ── 1. L'aplatissement d'une SPEC (sur une SPEC fabriquée : on connaît la réponse)
    const fab = objet({ _id: NOMBRE, a: TEXTE, b: objet({ c: NOMBRE, d: objet({ e: TEXTE }) }), l: liste(objet({ x: TEXTE, y: liste(NOMBRE) })), m: liste(NOMBRE), n: { t: 'nomAffichage' }, o: { t: 'texteOuListeDeTextes' } });
    verifier('cheminsDeSpec : feuilles pointées ; un tableau ne change pas le chemin ; `_id` de la racine écarté', S.cheminsDeSpec(fab), ['a', 'b.c', 'b.d.e', 'l.x', 'l.y', 'm', 'n', 'o']);
    verifier('cheminsDeSpec : un `_id` imbriqué n\'est PAS écarté (seul celui de la racine est l\'identité)', S.cheminsDeSpec(objet({ z: objet({ _id: TEXTE }) })), ['z._id']);
    verifier('cheminsDeSpec : une forme inconnue LÈVE', [!!(await leve(() => S.cheminsDeSpec({ nimporte: 1 }))), !!(await leve(() => S.cheminsDeSpec(null))), !!(await leve(() => S.cheminsDeSpec({ t: 'objet' })))], [true, true, true]);

    // ── 2. LA CONFRONTATION, sur des SPEC fabriquées
    const lit = (o = {}) => ({ cartes: ['nomEn', 'attaques', 'liens.idProduct'], impressions: ['tirage'], images: ['set', 'vignette'], lignes: ['carteId', 'visuelSubstitut.cleR2'], sets: ['code', 'logo'], ...o });
    const specs = (o = {}) => ({
        SPEC_CARTE: objet({ _id: NOMBRE, nomEn: TEXTE, attaques: liste(objet({ nom: TEXTE, degats: TEXTE })), liens: objet({ idProduct: liste(NOMBRE) }), impressions: liste(objet({ tirage: TEXTE })), images: liste(objet({ set: TEXTE, vignette: objet({ cleR2: TEXTE, w: NOMBRE }) })), ...(o.carte || {}) }),
        SPEC_PRODUIT: objet({ carteId: NOMBRE, visuelSubstitut: objet({ cleR2: TEXTE }), ...(o.produit || {}) }),
        SPEC_SET: objet({ _id: TEXTE, code: TEXTE, logo: objet({ cleR2: TEXTE, preuve: TEXTE }), ...(o.set || {}) })
    });
    verifier('confronter : une liste complète (un ancêtre couvre ses sous-champs : attaques.nom, vignette.cleR2, logo.preuve) -> rien ne manque', S.confronter(specs(), lit()), []);
    verifier('confronter : un champ de carte que le site lit et que la liste n\'a pas -> nommé', S.confronter(specs({ carte: { pv: NOMBRE } }), lit()), [{ collection: 'cartes', chemin: 'pv' }]);
    verifier('confronter : un sous-champ d\'entrée d\'image (images.langue) absent -> nommé', S.confronter(specs({ carte: { images: liste(objet({ set: TEXTE, langue: TEXTE })) } }), lit()), [{ collection: 'cartes', chemin: 'images.langue' }]);
    verifier('confronter : un sous-champ d\'impression absent -> nommé', S.confronter(specs({ carte: { impressions: liste(objet({ tirage: TEXTE, rarete: TEXTE })) } }), lit()), [{ collection: 'cartes', chemin: 'impressions.rarete' }]);
    verifier('confronter : `liens.idMetacard` (frère de liens.idProduct) absent -> nommé', S.confronter(specs({ carte: { liens: objet({ idProduct: liste(NOMBRE), idMetacard: NOMBRE }) } }), lit()), [{ collection: 'cartes', chemin: 'liens.idMetacard' }]);
    verifier('confronter : un champ de produit hors liste (visuelSubstitut.mention) -> nommé', S.confronter(specs({ produit: { visuelSubstitut: objet({ cleR2: TEXTE, mention: TEXTE }) } }), lit()), [{ collection: 'cartes_produits', chemin: 'visuelSubstitut.mention' }]);
    verifier('confronter : un champ de set hors liste (deck) -> nommé', S.confronter(specs({ set: { deck: TEXTE } }), lit()), [{ collection: 'sets', chemin: 'deck' }]);
    verifier('confronter : l\'inverse (la liste a un champ de PLUS que le site) ne refuse pas — prudence permise', S.confronter(specs(), lit({ cartes: ['nomEn', 'attaques', 'liens.idProduct', 'champEnPlus'] })), []);
    verifier('confronter : une SPEC sans aucun champ LÈVE (un vide parfait ne prouve rien)', !!(await leve(() => S.confronter({ ...specs(), SPEC_SET: objet({ _id: TEXTE }) }, lit()))), true);

    // ── 3. LE SITE RÉEL, importé : la liste est complète, sous-champs compris
    let site;
    try { site = await S.chargerSite(); } catch (e) { console.log(`❌ chargerSite : ${e.message}`); process.exit(1); }
    verifier('chargerSite : les trois SPEC réelles sont importées (objets)', [typeof site.SPEC_CARTE, typeof site.SPEC_PRODUIT, typeof site.SPEC_SET], ['object', 'object', 'object']);
    const dn = k => S.cheminsDeSpec(site[k]);
    verifier('dénominateurs (jamais un vide parfait) : champs lus par le site', [dn('SPEC_CARTE').length > 40, dn('SPEC_PRODUIT').length >= 9, dn('SPEC_SET').length > 30], [true, true, true]);
    verifier('les sous-champs d\'images, d\'impressions, de visuelSubstitut et de liens sont dans l\'aplatissement (le banc lit l\'arbre, pas des types)',
        [['images.vignette.cleR2', 'images.tamponNonRepresente', 'impressions.rarete', 'liens.idProduct', 'liens.idMetacard', 'attaques.cout'].every(c => dn('SPEC_CARTE').includes(c)), dn('SPEC_PRODUIT').includes('visuelSubstitut.mention'), ['logo.preuve', 'dateSortieMois.texte', 'bulba.pageid', 'symbolesIdentification.fichier'].every(c => dn('SPEC_SET').includes(c))], [true, true, true]);
    verifier('SITE_LIT couvre TOUT ce que les SPEC réelles du site lisent (SPEC_CARTE avec images et impressions, SPEC_PRODUIT avec visuelSubstitut, SPEC_SET)', S.confronter(site, SITE_LIT), []);
    verifier('verifierSiteLu rend le nombre de champs vus', (await S.verifierSiteLu({ siteLit: SITE_LIT })).champs > 80, true);
    // le banc sait dire non sur le VRAI site : on retire un champ de la liste
    const sansPreuve = { ...SITE_LIT, sets: SITE_LIT.sets.filter(c => c !== 'logo') };
    verifier('sur le site réel, une liste amputée de `logo` : manque logo.* (nommé)', S.confronter(site, sansPreuve).map(m => m.chemin).filter(c => c.startsWith('logo.')).length > 3, true);
    verifier('sur le site réel, une liste amputée de `liens.idMetacard` : nommé', S.confronter(site, { ...SITE_LIT, cartes: SITE_LIT.cartes.filter(c => c !== 'liens.idMetacard') }).map(m => `${m.collection}.${m.chemin}`), ['cartes.liens.idMetacard']);
    const rv = await leve(() => S.verifierSiteLu({ siteLit: sansPreuve }));
    verifier('verifierSiteLu sur une liste amputée : LÈVE en nommant les champs', [/garde site lu/.test(rv || ''), /sets\.logo\./.test(rv || '')], [true, true]);

    // ── 4. TOUT CE QUI EMPÊCHE DE CONCLURE REFUSE
    const tmp = (contenu) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'site-faux-')); if (contenu !== null) { fs.mkdirSync(path.join(d, 'lib')); fs.writeFileSync(path.join(d, 'lib', 'lireDonnee.ts'), contenu); } return d; };
    const dInexistant = path.join(os.tmpdir(), `site-inexistant-${process.pid}-${Date.now()}`);
    verifier('site introuvable : LÈVE « je ne peux pas conclure »', /garde site lu : je ne peux pas conclure/.test(await leve(() => S.verifierSiteLu({ siteLit: SITE_LIT, dossier: dInexistant })) || ''), true);
    verifier('dossier du site sans lib/lireDonnee.ts : LÈVE', /garde site lu : je ne peux pas conclure/.test(await leve(() => S.verifierSiteLu({ siteLit: SITE_LIT, dossier: tmp(null) })) || ''), true);
    verifier('import qui lève : LÈVE (le message de l\'erreur d\'import est porté)', /garde site lu : je ne peux pas conclure.*import-qui-leve/.test(await leve(() => S.verifierSiteLu({ siteLit: SITE_LIT, dossier: tmp('throw new Error("import-qui-leve");\nexport const x = 1;\n') })) || ''), true);
    verifier('SPEC_SET absente du module : LÈVE en la nommant', /SPEC_SET absent/.test(await leve(() => S.verifierSiteLu({ siteLit: SITE_LIT, dossier: tmp('export const SPEC_CARTE = { t: "objet", champs: {} };\nexport const SPEC_PRODUIT = { t: "objet", champs: {} };\n') })) || ''), true);
    verifier('SPEC de forme inconnue : LÈVE (jamais un « rien ne manque »)', !!(await leve(() => S.verifierSiteLu({ siteLit: SITE_LIT, dossier: tmp('export const SPEC_CARTE = { t: "inconnue" };\nexport const SPEC_PRODUIT = { t: "objet", champs: {} };\nexport const SPEC_SET = { t: "objet", champs: {} };\n') }))), true);

    // ── 5. LE CÂBLAGE de lot-additif.js (lecture de la source : le lot lui-même ne se lance pas dans un banc pur)
    const src = fs.readFileSync(path.join(__dirname, 'lot-additif.js'), 'utf8');
    const iTer = src.indexOf('await GS.verifierSiteLu('), iSauve = src.indexOf("spawnSync(process.execPath, ['backup-collections.js'");
    const bloc = src.slice(src.lastIndexOf('if (BASE ===', iTer), src.indexOf("} else console.log('   0 ter.", iTer) + 60);
    verifier('lot-additif.js : étape 0 ter, la confrontation au site AVANT la sauvegarde, sur la base `cartes` seulement', [iTer > 0 && iTer < iSauve, /^if \(BASE === 'cartes'\) \{/.test(bloc)], [true, true]);
    verifier('lot-additif.js : un manque ou une impossibilité de conclure sort en code 6 « Rien n\'a été sauvegardé ni écrit », SITE_LIT passée à la confrontation',
        [/catch \(e\) \{ console\.error\(`❌ \$\{e\.message\}\. Rien n'a été sauvegardé ni écrit\.`\); process\.exit\(6\); \}/.test(bloc), /GS\.verifierSiteLu\(\{ siteLit: SITE_LIT \}\)/.test(bloc)], [true, true]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ banc cassé :', e); process.exit(1); });
