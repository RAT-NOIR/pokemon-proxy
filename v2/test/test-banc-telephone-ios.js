'use strict';
// BANC-TELEPHONE, lot iOS : (1) WebGPU désactivé sur iOS/iPadOS (détection écrite par ce qu'elle autorise, `?webgpu=forcer` pour un diagnostic), (2) la ligne de diagnostic des pixels (décodeur du navigateur
// contre redimensionnement), (3) le dépôt accepte les champs nouveaux et refuse les autres (liste fermée), (4) les engagements du code de la page (libération des sessions et du modèle), (5) le lot porte
// la référence de décodage. Règles pures de public/verdict.mjs rejouées sous node. Aucun réseau, aucune base.
const H = require('./_harnais');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const S = require('../banc-telephone/stockage');
const PUB = path.join(__dirname, '..', 'banc-telephone', 'public');

(async () => {
    const V = await import(pathToFileURL(path.join(PUB, 'verdict.mjs')).href);
    const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
    const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
    const UA_IPOD = 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
    const UA_IPAD_BUREAU = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';
    const UA_CHROME_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
    const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36';
    const ios = (ua, platform, maxTouchPoints) => V.detecterIOS({ ua, platform, maxTouchPoints });

    // ═══ 1. la détection d'iOS / iPadOS ═══
    H.v('1. iPhone (agent utilisateur) ⇒ iOS', ios(UA_IPHONE, 'iPhone', 5).ios, true);
    H.v('1. iPad (agent utilisateur mobile) ⇒ iOS', ios(UA_IPAD, 'iPad', 5).ios, true);
    H.v('1. iPod ⇒ iOS', ios(UA_IPOD, 'iPod', 5).ios, true);
    H.v('1. iPad en MODE BUREAU (UA « Macintosh », platform MacIntel, écran tactile) ⇒ iOS', [ios(UA_IPAD_BUREAU, 'MacIntel', 5).ios, ios(UA_IPAD_BUREAU, 'MacIntel', 5).raison], [true, 'ipad-bureau']);
    H.v('1. un Mac de bureau (MacIntel, 0 point tactile) n\'est PAS iOS : son WebGPU reste proposé', ios(UA_IPAD_BUREAU, 'MacIntel', 0).ios, false);
    H.v('1. un Mac avec 1 seul point tactile n\'est pas un iPad (il en faut plus de 1)', ios(UA_IPAD_BUREAU, 'MacIntel', 1).ios, false);
    H.v('1. Chrome sur PC, Chrome sur Android ⇒ pas iOS', [ios(UA_CHROME_PC, 'Win32', 0).ios, ios(UA_ANDROID, 'Linux armv81', 5).ios], [false, false]);
    H.v('1. agent illisible (absent, non texte) ⇒ la garde ne peut pas conclure : elle BLOQUE WebGPU et le dit (« indetermine »)', [ios(undefined, 'MacIntel', 0), ios(12, undefined, undefined)], [{ ios: true, raison: 'indetermine' }, { ios: true, raison: 'indetermine' }]);
    H.v('1. agent texte et plateforme/tactile absents sur un agent non Apple ⇒ pas iOS (rien ne le désigne)', ios(UA_CHROME_PC, undefined, undefined).ios, false);

    H.v('1. agent VIDE ou blanc = illisible : la garde BLOQUE WebGPU (indetermine)', [ios('', 'Win32', 0), ios('   ', 'Win32', 0)], [{ ios: true, raison: 'indetermine' }, { ios: true, raison: 'indetermine' }]);

    // ═══ 1 bis. rendre les octets du modèle : repli sans transfer JOUÉ (stub), jamais d'exception ═══
    {
        const appels = [];
        V.libererOctets({ buffer: { transfer: n => appels.push(n) } });
        H.v('1b. transfer présent ⇒ appelé avec 0', appels, [0]);
        let leve = false; try { V.libererOctets({ buffer: {} }); V.libererOctets({}); V.libererOctets(null); V.libererOctets(undefined); } catch { leve = true; }
        H.v('1b. SANS transfer (stub), sans buffer, null, undefined : aucune exception', leve, false);
        H.v('1b. transfer qui lève (tampon déjà détaché) : avalé', (() => { try { V.libererOctets({ buffer: { transfer() { throw new TypeError('detached'); } } }); return 'ok'; } catch { return 'leve'; } })(), 'ok');
        const vrai = new Uint8Array(1024); V.libererOctets(vrai);
        H.v('1b. vrai ArrayBuffer de node : détaché (longueur 0) si la méthode existe, sinon intact', vrai.buffer.byteLength, typeof ArrayBuffer.prototype.transfer === 'function' ? 0 : 1024);
        const sauve = ArrayBuffer.prototype.transfer; let apres;
        try { ArrayBuffer.prototype.transfer = undefined; const v2 = new Uint8Array(512); V.libererOctets(v2); apres = v2.buffer.byteLength; } finally { ArrayBuffer.prototype.transfer = sauve; }
        H.v('1b. méthode retirée du prototype réel : le tampon reste intact (ramasse-miettes), aucune exception', apres, 512);
    }

    // ═══ 2. le choix du moteur ═══
    H.v('2. WebGPU demandé sur iOS ⇒ WASM, désactivé, avec le texte à l\'écran', V.choisirMoteur({ demande: 'webgpu', ios: true, forcer: false }), { moteur: 'wasm', desactive: true, forcee: false, texte: 'WebGPU désactivé sur iOS (plantage mémoire) : WASM utilisé' });
    H.v('2. le texte écran est exporté tel quel', V.TEXTE_WEBGPU_IOS, 'WebGPU désactivé sur iOS (plantage mémoire) : WASM utilisé');
    H.v('2. WebGPU demandé sur iOS avec ?webgpu=forcer ⇒ WebGPU, marqué forcé', V.choisirMoteur({ demande: 'webgpu', ios: true, forcer: true }), { moteur: 'webgpu', desactive: false, forcee: true, texte: 'WebGPU forcé sur iOS (diagnostic) : plantage mémoire possible' });
    H.v('2. WebGPU demandé hors iOS ⇒ WebGPU, ni désactivé ni forcé', V.choisirMoteur({ demande: 'webgpu', ios: false, forcer: false }), { moteur: 'webgpu', desactive: false, forcee: false, texte: null });
    H.v('2. forcer hors iOS ne change rien (pas marqué « forcé »)', V.choisirMoteur({ demande: 'webgpu', ios: false, forcer: true }).forcee, false);
    H.v('2. WASM demandé ⇒ WASM sur iOS comme ailleurs', [V.choisirMoteur({ demande: 'wasm', ios: true, forcer: false }).moteur, V.choisirMoteur({ demande: 'wasm', ios: false, forcer: true }).moteur], ['wasm', 'wasm']);
    H.v('2. un moteur inconnu n\'est pas servi : WASM', V.choisirMoteur({ demande: 'cuda', ios: false, forcer: false }).moteur, 'wasm');
    H.v('2. ?webgpu=forcer est lu par ce qu\'il autorise : seule la valeur exacte « forcer »', ['?webgpu=forcer', '?iso=0&webgpu=forcer', '?webgpu=forcer&iso=0', '?webgpu=oui', '?webgpu=', '?xwebgpu=forcer', '', '?webgpu=forcer2', undefined].map(V.webgpuForce), [true, true, true, false, false, false, false, false, false]);

    // ═══ 3. le moteur déposé est celui qui a RÉELLEMENT servi (règle moteurRealise, inchangée) ═══
    H.v('3. moteurRealise : WebGPU demandé sans périphérique ⇒ wasm (inchangé)', V.moteurRealise('webgpu', null).moteur, 'wasm');

    // ═══ 4. les statistiques de pixels ═══
    const a = Uint8Array.from([10, 20, 30, 40, 50, 60]);
    H.v('4. deux tableaux égaux ⇒ 0 partout', V.statsPixels(a, Uint8Array.from(a)), { n: 6, max: 0, somme: 0, nDiff: 0, moy: 0, pctDiff: 0 });
    H.v('4. un octet sur six diffère de 3 ⇒ max 3, moyenne 0,5, 16,666667 % différents', V.statsPixels(a, Uint8Array.from([10, 20, 33, 40, 50, 60])), { n: 6, max: 3, somme: 3, nDiff: 1, moy: 0.5, pctDiff: 16.666667 });
    H.v('4. longueurs différentes, vide, absent ⇒ null (jamais « 0 écart »)', [V.statsPixels(a, a.subarray(1)), V.statsPixels(new Uint8Array(0), new Uint8Array(0)), V.statsPixels(null, a), V.statsPixels(a, undefined)], [null, null, null, null]);
    const s1 = V.statsPixels(a, Uint8Array.from([10, 20, 33, 40, 50, 60])), s2 = V.statsPixels(a, Uint8Array.from([11, 20, 30, 40, 50, 60]));
    H.v('4. fusion de deux séries : n additionné, max du max, moyennes et pourcentages PONDÉRÉS par n', V.fusionnerStats([s1, s2]), { n: 12, max: 3, somme: 4, nDiff: 2, moy: 0.333333, pctDiff: 16.666667 });
    H.v('4. fusion vide ou avec un null ⇒ null (un trou ne se compte pas comme zéro)', [V.fusionnerStats([]), V.fusionnerStats([s1, null])], [null, null]);

    // ═══ 5. la cause, dite par ce que les trois mesures établissent ═══
    const zero = { n: 100, max: 0, somme: 0, nDiff: 0, moy: 0, pctDiff: 0 }, petit = { n: 100, max: 1, somme: 20, nDiff: 20, moy: 0.2, pctDiff: 20 }, grand = { n: 100, max: 9, somme: 250, nDiff: 60, moy: 2.5, pctDiff: 60 };
    H.v('5. décodage différent de PIL ⇒ « decodeur »', V.causeEcart({ decodage: grand, redimensionnement: petit, chaine: grand }), 'decodeur');
    H.v('5. décodage identique, chaîne identique ⇒ « aucune »', V.causeEcart({ decodage: zero, redimensionnement: petit, chaine: petit }), 'aucune');
    H.v('5. décodage identique mais chaîne pire que le redimensionnement de référence ⇒ « autre-etape » (couleur, canal alpha, bitmap)', V.causeEcart({ decodage: zero, redimensionnement: petit, chaine: grand }), 'autre-etape');
    H.v('5. une mesure manquante ⇒ « indetermine », jamais « aucune »', [V.causeEcart({ decodage: null, redimensionnement: petit, chaine: petit }), V.causeEcart({ decodage: zero, redimensionnement: null, chaine: petit }), V.causeEcart({ decodage: zero, redimensionnement: petit, chaine: null }), V.causeEcart(null)], ['indetermine', 'indetermine', 'indetermine', 'indetermine']);
    H.v('5. décodage jugé sur 2 cartes (max 0), chaîne sur 12 au-dessus du plancher ⇒ « non-etablie », jamais « autre-etape »', [V.causeEcart({ decodage: zero, redimensionnement: petit, chaine: grand, cartesDecodage: 2, cartesChaine: 12 }), V.causeEcart({ decodage: zero, redimensionnement: petit, chaine: grand, cartesDecodage: 12, cartesChaine: 12 }), V.causeEcart({ decodage: zero, redimensionnement: petit, chaine: petit, cartesDecodage: 2, cartesChaine: 12 }), V.causeEcart({ decodage: grand, redimensionnement: petit, chaine: grand, cartesDecodage: 2, cartesChaine: 12 })], ['non-etablie', 'autre-etape', 'aucune', 'decodeur']);
    H.v('5. assemblerDiagnostic porte la couverture et en tire « non-etablie »', V.assemblerDiagnostic({ decodage: [zero, zero], redimensionnement: [petit, petit], chaine: Array(12).fill(grand) }).cause, 'non-etablie');
    H.v('5. la ligne dit « non établie »', /non établie/.test(V.texteDiagnostic({ cause: 'non-etablie', cartesDecodage: 2, cartesChaine: 12, decodage: zero, redimensionnement: petit, chaine: grand })), true);
    H.v('7. cause « non-etablie » acceptée au dépôt', S.valider({ v: 1, runId: '0123456789abcdef', modeleSha: 'a'.repeat(64), ua: 'x', isole: true, coeurs: 4, gpuDispo: true, mesure: { moteur: 'wasm', verdict: 'ECART', diagnosticPixels: { cause: 'non-etablie' } } }).ok, true);
    const diag = { cause: 'decodeur', cartesDecodage: 2, cartesChaine: 12, decodage: grand, redimensionnement: petit, chaine: grand, bitmapSansConversion: grand, bitmapAvecConversion: grand, couleurCanvas: 'srgb' };
    const ligne = V.texteDiagnostic(diag);
    H.v('5. la ligne de diagnostic nomme la cause et les trois écarts maximaux', [/décodeur/.test(ligne), /9/.test(ligne), /2 cartes/.test(ligne), ligne.includes('\n')], [true, true, true, false]);
    H.v('5. texteDiagnostic(null) ⇒ « non mesuré » (le diagnostic ne lève jamais)', /non mesuré/.test(V.texteDiagnostic(null)), true);

    // ═══ 6. les options de session demandées par la page (diagnostic mémoire), liste fermée ═══
    H.v('6. sans paramètre : aucune option (la session est celle de l\'extension)', V.optionsSession(''), { options: {}, retenues: [], ignorees: [] });
    H.v('6. ?session=arena0,pattern0 ⇒ les deux options du moteur, et seulement elles', V.optionsSession('?session=arena0,pattern0'), { options: { enableCpuMemArena: false, enableMemPattern: false }, retenues: ['arena0', 'pattern0'], ignorees: [] });
    H.v('6. un mot inconnu est ignoré ET dit', V.optionsSession('?session=arena0,graph0,../x'), { options: { enableCpuMemArena: false }, retenues: ['arena0'], ignorees: ['graph0', '../x'] });

    // ═══ 7. le dépôt : champs nouveaux acceptés, liste fermée à chaque niveau ═══
    const doc = (m = {}) => ({ v: 1, runId: '0123456789abcdef', modeleSha: 'a'.repeat(64), ua: 'x', isole: true, coeurs: 4, gpuDispo: true, mesure: { moteur: 'wasm', verdict: 'ECART', ...m } });
    H.v('7. moteurDemande, webgpuDesactive, webgpuForce, optionsSession acceptés', S.valider(doc({ moteurDemande: 'webgpu', webgpuDesactive: true, webgpuForce: false, optionsSession: 'arena0' })).ok, true);
    H.v('7. moteurDemande hors liste refusé', S.valider(doc({ moteurDemande: 'cuda' })).detail, 'champ:mesure.moteurDemande');
    H.v('7. diagnosticPixels accepté', S.valider(doc({ diagnosticPixels: { cause: 'decodeur', cartesDecodage: 2, cartesChaine: 12, decodage: { n: 10, max: 3, moy: 0.5, pctDiff: 10 }, redimensionnement: { n: 10, max: 1, moy: 0.1, pctDiff: 5 }, chaine: null, bitmapSansConversion: null, bitmapAvecConversion: null, couleurCanvas: 'srgb' } })).ok, true);
    H.v('7. diagnosticPixels : cause hors liste refusée', S.valider(doc({ diagnosticPixels: { cause: 'magie' } })).detail, 'champ:mesure.diagnosticPixels.cause');
    H.v('7. diagnosticPixels : champ inconnu refusé (liste fermée)', S.valider(doc({ diagnosticPixels: { cause: 'aucune', secret: 1 } })).detail, 'champ-inconnu:mesure.diagnosticPixels.secret');
    H.v('7. diagnosticPixels : statistique hors bornes refusée', S.valider(doc({ diagnosticPixels: { cause: 'aucune', decodage: { n: 10, max: 999, moy: 0, pctDiff: 0 } } })).detail, 'champ:mesure.diagnosticPixels.decodage.max');
    H.v('7. diagnosticPixels : champ inconnu dans une statistique refusé', S.valider(doc({ diagnosticPixels: { cause: 'aucune', decodage: { n: 1, max: 0, moy: 0, pctDiff: 0, x: 1 } } })).detail, 'champ-inconnu:mesure.diagnosticPixels.decodage.x');
    H.v('7. la taille du document reste bornée (8 Ko) avec tous les champs', Buffer.byteLength(JSON.stringify(doc({ diagnosticPixels: { cause: 'decodeur', cartesDecodage: 2, cartesChaine: 12, decodage: s1, redimensionnement: s1, chaine: s1, bitmapSansConversion: s1, bitmapAvecConversion: s1, couleurCanvas: 'srgb' } }))) < 4000, true);

    // ═══ 8. le code de la page : ce qu'il doit contenir (la logique dépendante du navigateur est éprouvée par pilote-memoire.js dans Chrome) ═══
    {
        const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8').replace(/\/\/.*$/gm, '');
        H.v('8. la page câble la détection iOS, le choix du moteur, le paramètre ?webgpu=forcer et le diagnostic', ['detecterIOS(', 'choisirMoteur(', 'webgpuForce(', 'diagnosticPixels', 'assemblerDiagnostic('].map(x => app.includes(x)), Array(5).fill(true));
        H.v('8. le bouton WebGPU n\'est pas proposé sur iOS (désactivé + texte)', /TEXTE_WEBGPU_IOS/.test(app), true);
        H.v('8. le modèle n\'est PAS gardé en mémoire après la création de la session (E.modele jamais affecté du tampon)', /E\.modele\s*=\s*tampon/.test(app), false);
        H.v('8. la session WASM est libérée (release) dans un finally', /finally\s*\{[^}]*session\.release\(\)/.test(app), true);
        H.v('8. la page ne contient aucun innerHTML (tout passe par textContent)', /innerHTML/.test(app), false);
        H.v('8. les octets du modèle sont rendus au système (libererOctets de verdict.mjs, joué en 1b) sur WASM comme sur WebGPU, et seulement si la session est créée', [(app.match(/libererOctets\(modele\)/g) || []).length, /if \(cree\) libererOctets/.test(app), /g && g\.ok\) libererOctets/.test(app), /import \{[^}]*libererOctets/.test(app)], [2, true, true, true]);
        H.v('8. le décodage et le redimensionnement sont ceux d\'origine : un canvas par carte, aucun canvas partagé', [/canvasDecodage|CANVAS_DECODAGE/.test(app), /const cv = document\.createElement\('canvas'\); cv\.width = bmp\.width; cv\.height = bmp\.height;/.test(app)], [false, true]);
        H.v('8. le diagnostic des pixels est calculé APRÈS la mesure (il ne coexiste ni avec le modèle ni avec une session)', app.indexOf('diagnostiquerPixels(await') > app.indexOf('m = moteur === \'wasm\' ? await mesurerWasm()'), true);
        H.v('8. lancer() passe par choisirMoteur AVANT toute mesure, et dépose moteurDemande / webgpuDesactive / webgpuForce', [app.indexOf('choisirMoteur({') < app.indexOf('mesurerWasm() : await mesurerGpu()'), /m\.moteurDemande/.test(app), /m\.webgpuDesactive = choix\.desactive/.test(app), /m\.webgpuForce = choix\.forcee/.test(app)], [true, true, true, true]);
        H.v('8. le bouton WebGPU reste désactivé après une mesure sur iOS (E.gpuPropose)', /disabled = !E\.gpuPropose/.test(app), true);
    }

    // ═══ 9. le lot porte la référence de décodage de PIL pour les deux premières cartes ═══
    {
        const lot = JSON.parse(fs.readFileSync(path.join(PUB, 'lot.json'), 'utf8'));
        H.v('9. `dec` : 420 x 587 x 3 octets sur les 2 premières cartes, rien ailleurs', [lot.cartes.filter(c => c.dec).length, lot.cartes.slice(0, 2).every(c => Buffer.from(c.dec, 'base64').length === 420 * 587 * 3)], [2, true]);
        H.v('9. jugerLot rejette un `dec` de la mauvaise taille', V.jugerLot({ cartes: Array.from({ length: 30 }, (_, i) => ({ refV: new Float32Array(256).fill(0.0625), decV: i === 1 ? new Uint8Array(5) : undefined })) }), 'decodage-mal-forme');
    }

    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
