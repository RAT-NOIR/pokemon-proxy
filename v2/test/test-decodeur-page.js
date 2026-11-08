'use strict';
// BANC-TELEPHONE × DECODEUR RAT-MARKET — le branchement du décodeur dans la page : règles pures de verdict.mjs, schéma du dépôt (stockage.js), texte de app.js, empreintes de PIL du lot.
// Node pur (aucune base) : la logique qui dépend du navigateur (createImageBitmap, canvas) est éprouvée par outils/decodeur/pilote-page.js dans Chrome.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const PUB = path.join(__dirname, '..', 'banc-telephone', 'public');
let ok = 0, ko = 0;
const eq = (nom, obtenu, attendu) => { const b = JSON.stringify(obtenu) === JSON.stringify(attendu); if (b) ok++; else { ko++; console.log(`❌ ${nom}\n   obtenu  ${JSON.stringify(obtenu)}\n   attendu ${JSON.stringify(attendu)}`); } };
const vrai = (nom, c) => eq(nom, Boolean(c), true);

(async () => {
    const V = await import(pathToFileURL(path.join(PUB, 'verdict.mjs')).href);
    const D = await import(pathToFileURL(path.join(PUB, 'decodeur.mjs')).href);
    const S = require('../banc-telephone/stockage');
    const lot = JSON.parse(fs.readFileSync(path.join(PUB, 'lot.json'), 'utf8'));
    const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    const sha = b => crypto.createHash('sha256').update(b).digest('hex');
    const n30 = (via, extra = {}) => Array.from({ length: 30 }, () => ({ via, ...extra }));

    // ═══ 1. resumerEntree : quel chemin a servi, et l'honnêteté sur l'identité au bit ═══
    {
        const r = V.resumerEntree(n30('rm'));
        eq('1. 30 cartes par Rat-Market : chemin « rm », identique au bit', [r.chemin, r.cartesRm, r.cartesRepli, r.identiqueAuBit, r.refus], ['rm', 30, 0, true, {}]);
        const m = V.resumerEntree([...n30('rm').slice(0, 27), { via: 'repli', code: 'NON_SUPPORTE' }, { via: 'repli', code: 'NON_SUPPORTE' }, { via: 'repli', code: 'memoire' }]);
        eq('1. 3 refus : chemin « mixte », PAS identique au bit, refus comptés par code', [m.chemin, m.cartesRm, m.cartesRepli, m.identiqueAuBit, m.refus], ['mixte', 27, 3, false, { NON_SUPPORTE: 2, memoire: 1 }]);
        const n = V.resumerEntree(n30('repli', { code: 'DECODAGE' }));
        eq('1. 30 refus : chemin « navigateur », pas identique au bit', [n.chemin, n.identiqueAuBit, n.refus], ['navigateur', false, { DECODAGE: 30 }]);
        eq('1. un code inconnu est rangé sous « autre » (liste fermée)', V.resumerEntree([{ via: 'repli', code: 'n\'importe quoi' }]).refus, { autre: 1 });
        eq('1. une liste incomplète (29 sur 30) n\'est jamais « identique au bit »', V.resumerEntree(n30('rm').slice(0, 29)).identiqueAuBit, false);
        eq('1. une liste vide : null, jamais « identique »', V.resumerEntree([]).identiqueAuBit, null);
    }

    // ═══ 2. le témoin du navigateur ═══
    {
        const t = V.resumerTemoin([{ octetsDiff: 0, ecartMax: 0, tenseurIdentique: true, cosNavigateur: 0.9999999 }, { octetsDiff: 12, ecartMax: 3, tenseurIdentique: false, cosNavigateur: 0.99987 }]);
        eq('2. le témoin compte les cartes identiques, l\'écart maximal et le cosinus minimal du navigateur', [t.cartes, t.rgbIdentiquesNavigateur, t.tenseursIdentiquesNavigateur, t.ecartMaxNavigateur, t.cosMinNavigateur], [2, 1, 1, 3, 0.99987]);
        eq('2. sans témoin : null (jamais « 0 écart »)', V.resumerTemoin([]), null);
    }

    // ═══ 3. les textes : honnêtes dans les trois cas ═══
    {
        const bon = V.resumerEntree(n30('rm')), mixte = V.resumerEntree([...n30('rm').slice(0, 28), { via: 'repli', code: 'NON_SUPPORTE' }, { via: 'repli', code: 'NON_SUPPORTE' }]);
        vrai('3. entrée identique au bit : la ligne le dit, avec le nombre de cartes', /Rat-Market.*30\/30/.test(V.texteEntree(bon)) && /identique au bit/.test(V.texteEntree(bon)));
        vrai('3. repli : la ligne dit « NON IDENTIQUE AU BIT », le nombre de cartes et le code', /NON IDENTIQUE AU BIT/.test(V.texteEntree(mixte)) && /2 carte/.test(V.texteEntree(mixte)) && /NON_SUPPORTE/.test(V.texteEntree(mixte)));
        vrai('3. IDENTIQUE avec entrée identique au bit : constat', /identique à la référence/.test(V.avisEntree('IDENTIQUE', bon)) && /identique au bit/.test(V.avisEntree('IDENTIQUE', bon)));
        vrai('3. IDENTIQUE avec repli : le verdict est gardé mais l\'avis dit que l\'entrée n\'est pas identique au bit', /n'est pas identique au bit/.test(V.avisEntree('IDENTIQUE', mixte)));
        vrai('3. ÉCART avec entrée identique au bit : la cause n\'est PAS le décodage (honnête)', /pas le décodage/.test(V.avisEntree('ECART', bon)));
        vrai('3. ERREUR : aucun avis de constat', V.avisEntree('ERREUR', bon) === '');
        vrai('3. sans résumé : « non mesurée », jamais un constat', /non mesurée/.test(V.texteEntree(null)) && V.avisEntree('IDENTIQUE', null) === '');
    }

    // ═══ 4. l'orientation EXIF des WebP dans ce navigateur ═══
    {
        eq('4. mêmes dimensions que l\'image brute : non tournée', V.etatOrientation(17, 9, 17, 9), 'non-tourne');
        eq('4. dimensions échangées : tournée', V.etatOrientation(9, 17, 17, 9), 'tourne');
        eq('4. image carrée : indéterminé (une rotation ne se voit pas)', V.etatOrientation(10, 10, 10, 10), 'indetermine');
        eq('4. dimensions absurdes ou manquantes : indéterminé', [V.etatOrientation(0, 0, 17, 9), V.etatOrientation(null, 9, 17, 9), V.etatOrientation(5, 5, 17, 9)], ['indetermine', 'indetermine', 'indetermine']);
        vrai('4. la ligne d\'orientation nomme WebP et JPEG', /WebP/.test(V.texteOrientation({ webp: 'non-tourne', jpeg: 'tourne' })) && /JPEG/.test(V.texteOrientation({ webp: 'non-tourne', jpeg: 'tourne' })));
    }

    // ═══ 4b. les deux images EXIF embarquées dans app.js sont celles du jeu de Pillow, et le décodeur les lit comme annoncé ═══
    {
        const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-decodeur', 'pil-synthetique.json'), 'utf8')).cas;
        const brut = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
        for (const [cst, nom, w, h] of [['IMG_EXIF_WEBP', 'webp-exif-17x9', 17, 9], ['IMG_EXIF_JPEG', 'jpeg-exif6-37x29', 37, 29]]) {
            const m = brut.match(new RegExp('const ' + cst + " = '([^']+)';")), ref = fx.find(x => x.nom === nom);
            vrai('4b. ' + cst + ' == l\'image de Pillow du jeu de preuve (octet pour octet)', m && ref && m[1] === ref.b64);
            const r = D.decoder(Buffer.from(m[1], 'base64'), { orientation: 'aucune' });
            eq('4b. ' + cst + ' : dimensions brutes et orientation lue (6)', [r.largeur, r.hauteur, r.orientationLue], [w, h, 6]);
        }
    }

    // ═══ 5. le dépôt : liste fermée, bornes, taille ═══
    {
        const base = { v: 1, runId: '0123456789abcdef', modeleSha: 'a'.repeat(64), ua: 'x', isole: true, coeurs: 4, memoireAppareilGo: null, gpuDispo: false, gpu: null, reseau: null, modeleOctets: 1, telechargementMs: 1, verifShaMs: 1, shaVerifie: true };
        const mesure = (extra = {}) => ({ ...base, mesure: { moteur: 'wasm', verdict: 'IDENTIQUE', nEmpreintes: 30, ...extra } });
        const entree = { chemin: 'rm', source: 'rm-decodeur-2', cartesRm: 30, cartesRepli: 0, refus: {}, identiqueAuBit: true, rgbIdentiquesPil: 30, cartesComparees: 30, rgbIdentiquesNavigateur: 30, tenseursIdentiquesNavigateur: 30, ecartMaxNavigateur: 0, cosMinNavigateur: 0.9999999, msRmMediane: 14.7, msNavigateurMediane: 8.4, cartes640: 3, ms640: 41.2, empreinte640: 'abcdef012345' };
        eq('5. `entree` accepté', S.valider(mesure({ entree })).ok, true);
        eq('5. `entree` : champ inconnu refusé', S.valider(mesure({ entree: { ...entree, secret: 1 } })).detail, 'champ-inconnu:mesure.entree.secret');
        eq('5. `entree` : chemin hors liste refusé', S.valider(mesure({ entree: { ...entree, chemin: 'magie' } })).detail, 'champ:mesure.entree.chemin');
        eq('5. `entree.refus` : code hors liste refusé', S.valider(mesure({ entree: { ...entree, refus: { 'a;b': 1 } } })).detail, 'champ-inconnu:mesure.entree.refus.a;b');
        eq('5. `entree.refus` : un code de la liste est accepté', S.valider(mesure({ entree: { ...entree, cartesRepli: 2, cartesRm: 28, identiqueAuBit: false, chemin: 'mixte', refus: { NON_SUPPORTE: 2 } } })).ok, true);
        eq('5. `entree.empreinte640` : doit être hexadécimale de 12', S.valider(mesure({ entree: { ...entree, empreinte640: 'ZZ' } })).detail, 'champ:mesure.entree.empreinte640');
        eq('5. `orientationNavigateur` accepté', S.valider(mesure({ orientationNavigateur: { webp: 'non-tourne', jpeg: 'tourne' } })).ok, true);
        eq('5. `orientationNavigateur` : valeur hors liste refusée', S.valider(mesure({ orientationNavigateur: { webp: 'peut-etre', jpeg: 'tourne' } })).detail, 'champ:mesure.orientationNavigateur.webp');
        vrai('5. la taille du document reste bornée avec tous les champs (< 4 000 octets)', Buffer.byteLength(JSON.stringify(mesure({ entree, orientationNavigateur: { webp: 'tourne', jpeg: 'tourne' } }))) < 4000);
    }

    // ═══ 6. le lot porte l'empreinte du décodage de PIL ; le décodeur Rat-Market la retrouve ═══
    {
        eq('6. 30 cartes portent `rgbSha256`', lot.cartes.filter(c => /^[0-9a-f]{64}$/.test(c.rgbSha256 || '')).length, 30);
        let bon = 0; for (const c of lot.cartes) if (sha(D.decoder(Buffer.from(c.jpg, 'base64'), { orientation: 'aucune' }).rgb) === c.rgbSha256) bon++;
        eq('6. décodage Rat-Market == empreinte de PIL du lot, 30/30', bon, 30);
        vrai('6. jugerLot accepte toujours le lot enrichi', V.jugerLot({ cartes: lot.cartes.map(() => ({ refV: new Float32Array(256).fill(0.0625) })) }) === null);
    }

    // ═══ 7. le texte de app.js : le décodeur est branché, le navigateur reste témoin, le verdict n'a pas bougé ═══
    {
        vrai('7. app.js importe decoder et reduire640 de decodeur.mjs', /import \{[^}]*\bdecoder\b[^}]*\breduire640\b[^}]*\} from '\.\/decodeur\.mjs'/.test(app));
        vrai('7. la mesure passe par le décodeur Rat-Market (orientation « aucune ») puis le navigateur comme témoin', /decoder\(octets, \{ orientation: 'aucune' \}\)/.test(app) && /await decoderCarte\(/.test(app));
        vrai('7. un refus retombe sur le navigateur et est compté (resumerEntree)', /via: 'repli'/.test(app) && /resumerEntree\(/.test(app));
        vrai('7. le chemin et l\'orientation sont déposés (m.entree, m.orientationNavigateur)', /m\.entree\s*=/.test(app) && /m\.orientationNavigateur\s*=/.test(app));
        vrai('7. le verdict est toujours rendu par jugerMesure, avec les mêmes arguments', /jugerMesure\(\{ nEmpreintes: m\.nEmpreintes, nVecteursRefuses: refuses, cos, cosModeleSeul: cosPx, shaVerifie: E\.shaVerifie \}\)/.test(app));
        vrai('7. aucun seuil modifié (SEUIL_IDENTIQUE, GARDE_EXTENSION inchangés dans verdict.mjs)', V.SEUIL_IDENTIQUE === 0.9999 && V.GARDE_EXTENSION === 0.998);
        vrai('7. la ligne 5 est affichée', /ligne5/.test(app) && /id="ligne5"/.test(fs.readFileSync(path.join(PUB, 'page.html'), 'utf8')));
        vrai('7. aucune adresse absolue ni innerHTML', !/https?:\/\//.test(app) && !/innerHTML/.test(app));
    }

    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error('❌ exception', e); process.exitCode = 1; });
