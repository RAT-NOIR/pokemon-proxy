// node rouge-reponse-hote.js — LE ROUGE, VU POUR CHAQUE CAS DE LA RÈGLE COMMUNE DE RÉPONSE (§41 : « SAIT-ELLE refuser ? »).
// Chaque MUTANT casse UNE garde (un texte exact est remplacé, le fichier est restauré dans tous les cas) et le banc concerné DOIT passer au rouge : au moins une ligne ❌ ET un code 1.
// Un mutant dont le point d'attache n'existe pas exactement une fois ABAT le script. Aucune requête, aucune base.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const RH = 'collecte-cartes/reponse-hote.js', BM = 'test-reponse-hote.js', BX = 'test-reponse-hote-axios.js';
const M = (nom, fichier, de, vers, banc) => ({ nom, fichier, de, vers, banc });
const MUTANTS = [
    // ── le module ──
    M('200 text/html sans marqueur n\'est plus une fausse absence', RH, "return { issue: 'fausse-absente', motif: 'HTTP 200 text/html au lieu d\\'une image, aucun marqueur de défi', empreinte };", "return { issue: 'inattendue', motif: 'x' };", BM),
    M('l\'empreinte n\'est plus celle du corps', RH, 'const empreinte = sha256(corps);', "const empreinte = sha256(Buffer.from('x'));", BM),
    M('la borne de lecture redescend à 64 Ko (M3)', RH, 'const BORNE_CORPS = 512 * 1024;', 'const BORNE_CORPS = 64 * 1024;', BM),
    M('l\'empreinte connue ne vaut plus fausse-absente', RH, 'if (connues.includes(empreinte))', 'if (false)', BM),
    M('« challenge » seul n\'est plus ambigu', RH, 'if (/challenge/i.test(texte))', 'if (false)', BM),
    M('« challenge » seul devient un défi', RH, "[/just a moment/i, 'Just a moment'],", "[/just a moment|challenge/i, 'Just a moment'],", BM),
    M('401 n\'est plus un défi', RH, 'const STATUTS_DEFI = Object.freeze([401, 403, 410, 429]);', 'const STATUTS_DEFI = Object.freeze([403, 410, 429]);', BM),
    M('403 n\'est plus un défi', RH, 'const STATUTS_DEFI = Object.freeze([401, 403, 410, 429]);', 'const STATUTS_DEFI = Object.freeze([401, 410, 429]);', BM),
    M('410 n\'est plus un défi', RH, 'const STATUTS_DEFI = Object.freeze([401, 403, 410, 429]);', 'const STATUTS_DEFI = Object.freeze([401, 403, 429]);', BM),
    M('429 n\'est plus un défi', RH, 'const STATUTS_DEFI = Object.freeze([401, 403, 410, 429]);', 'const STATUTS_DEFI = Object.freeze([401, 403, 410]);', BM),
    M('cf-mitigated n\'est plus un défi', RH, "if (h['cf-mitigated'])", 'if (false)', BM),
    M('le marqueur « cf-chl » est retiré', RH, "[/cf[-_]chl/i, 'cf-chl'],", '', BM),
    M('le marqueur « challenge-platform » est retiré', RH, "[/challenge-platform/i, 'challenge-platform'],", '', BM),
    M('le marqueur « challenges.cloudflare.com » est retiré', RH, "[/challenges\\.cloudflare\\.com/i, 'challenges.cloudflare.com'],", '', BM),
    M('le marqueur « /cdn-cgi/challenge » est retiré', RH, "[/\\/cdn-cgi\\/challenge/i, '/cdn-cgi/challenge'],", '', BM),
    M('le marqueur « cf-challenge » est retiré', RH, "[/cf-challenge/i, 'cf-challenge'],", '', BM),
    M('le marqueur « captcha » est retiré', RH, "[/captcha/i, 'captcha'],", '', BM),
    M('le marqueur « turnstile » est retiré', RH, "[/turnstile/i, 'turnstile'],", '', BM),
    M('le marqueur « _Incapsula_Resource » est retiré', RH, "[/_Incapsula_Resource/i, '_Incapsula_Resource'],", '', BM),
    M('Imperva avec un corps de défi n\'est plus un défi', RH, "if ((/imperva|incapsula/i.test(h['x-cdn'] || '') || h['x-iinfo']) && statut !== 404)", 'if (false)', BM),
    M('Imperva seul (vraie image) devient un défi', RH, "if (corpsAnalyse && !image && corps.length && !estJson(type)) {", "if ((/imperva|incapsula/i.test(h['x-cdn'] || '') || h['x-iinfo'])) return 'x-cdn: Imperva';\n    if (corpsAnalyse && !image && corps.length && !estJson(type)) {", BM),
    M('503 sans marqueur n\'est plus transitoire', RH, "if (s >= 500 && s < 600) return { issue: 'transitoire'", "if (s >= 500 && s < 600) return { issue: 'inattendue'", BM),
    M('404 n\'est plus absente', RH, "if (s === 404) return { issue: 'absente', motif: 'HTTP 404' };", '', BM),
    M('3xx n\'est plus inattendue', RH, "if (s >= 300 && s < 400) return { issue: 'inattendue'", "if (s >= 300 && s < 400) return { issue: 'absente'", BM),
    M('200 image/* aux octets faux passe pour une image', RH, 'if (image) return { issue: \'image\', motif: \'HTTP 200, image\' };', "return { issue: 'image', motif: 'x' };", BM),
    M('200 sans Content-Type passe pour une image', RH, "if (/^\\s*image\\//i.test(type)) {", "if (/^\\s*image\\//i.test(type) || !type) {", BM),
    M('200 JSON n\'est plus inattendue', RH, "return { issue: 'inattendue', motif: type.trim() ?", "return { issue: 'fausse-absente', motif: type.trim() ?", BM),
    M('la 21e fausse absence ne met plus en pause (seuil 21)', RH, 'const SEUIL_FAUSSES = 20;', 'const SEUIL_FAUSSES = 21;', BM),
    M('la 20e met déjà en pause (comparaison >=)', RH, 'if (e.consecutives > seuil) { e.pause = true;', 'if (e.consecutives >= seuil) { e.pause = true;', BM),
    M('une image ne remet plus le compteur à zéro', RH, "if (classement?.issue === 'image') e.consecutives = 0;", "if (classement?.issue === 'image') { }", BM),
    M('un vrai 404 remet le compteur à zéro', RH, "if (classement?.issue === 'image') e.consecutives = 0;", "if (classement?.issue === 'image' || classement?.issue === 'absente') e.consecutives = 0;", BM),
    M('un vrai 404 compte comme fausse absence', RH, "else if (classement?.issue === 'fausse-absente') {", "else if (classement?.issue === 'fausse-absente' || classement?.issue === 'absente') {", BM),
    M('les empreintes ne sont plus gardées avec leur nombre', RH, "if (classement.empreinte) e.empreintes.set(classement.empreinte, (e.empreintes.get(classement.empreinte) || 0) + 1);", '', BM),
    M('le compteur est partagé entre hôtes', RH, "noter(hote, classement) {\n            const e = etat(hote);", "noter(hote, classement) {\n            const e = etat('unique');", BM),
    M('la pause n\'est plus collante', RH, "if (classement?.issue === 'image') e.consecutives = 0;", "if (classement?.issue === 'image') { e.consecutives = 0; e.pause = false; }", BM),
    M('l\'ambiguë ne donne plus de pause persistante', RH, "if (c.issue === 'ambigue') return { action: 'pause-persistante', ...base };", "if (c.issue === 'ambigue') return { action: 'pause', ...base };", BM),
    M('l\'inattendue ne donne plus de pause', RH, "if (c.issue === 'inattendue') return { action: 'pause', ...base };", "if (c.issue === 'inattendue') return { action: 'absente', ...base };", BM),
    M('le défi ne donne plus d\'arrêt définitif', RH, "if (c.issue === 'defi') return { action: 'arret-definitif', ...base };", "if (c.issue === 'defi') return { action: 'pause', ...base };", BM),
    M('la pause persistante n\'est plus écrite', RH, 'try { reaction.fichier = ecrirePausePersistante(dossierPauses, hote, {', 'try { reaction.fichier = (() => null)(dossierPauses, hote, {', 'test-pokumon.js'),
    M('un fichier de pause illisible ne bloque plus', RH, "return { hote, illisible: true, motif:", "return null; void { hote, illisible: true, motif:", BM),
    M('l\'extrait de pause n\'est plus borné', RH, '.slice(0, EXTRAIT_MAX);', ';', BM),
    M('le fichier d\'empreintes illisible ne lève plus', RH, "catch (e) { throw new Error(`reponse-hote : ${fichier} illisible", "catch (e) { return []; throw new Error(`reponse-hote : ${fichier} illisible", BM),
    // ── les clients et collecteurs (le câblage) ──
    M('pokumon : la fausse absence n\'est plus absente', 'collecte-cartes/pokumon.js', "if (x.action === 'absente') return null;", "if (x.action === 'absente') throw new Error('x');", 'test-pokumon.js'),
    M('pokumon : la pause de la passe n\'est plus relevée par garde() (REDONDANCE : le registre du processus la relève dans requete() par garderHote)', 'collecte-cartes/pokumon.js', 'if (pauseHote) throw pauseHote;                       // la pause de la passe', 'if (false) throw pauseHote;                       // la pause de la passe', null),
    M('pokumon : le défi ne bloque plus (REDONDANCE : requete() juge d\'abord le défi par la même fonction du module)', 'collecte-cartes/pokumon.js', "if (x.action === 'arret-definitif') bloquer(r, url);", '', null),
    M('pokumon : la pause persistante n\'est plus lue avant la requête', 'collecte-cartes/pokumon.js', 'RH.garderHote(new URL(c.url).hostname, dossierPauses, suivi);', '', 'test-pokumon.js'),
    M('pokumon (collecteur) : la pause devient un échec de fichier', 'collecteur-images-pokumon.js', 'if (err.pauseHote) { pauseHote = err; break; }', '', 'test-collecteur-pokumon.js'),
    M('ptcgio : la fausse absence n\'est plus absente', 'collecte-cartes/ptcgio.js', "if (x.action === 'absente') return null;", "if (x.action === 'absente') throw new Error('x');", 'test-ptcgio.js'),
    M('ptcgio : le défi ne bloque plus', 'collecte-cartes/ptcgio.js', "if (x.action === 'arret-definitif') bloquer(r, c.url);", '', 'test-ptcgio.js'),
    M('ptcgio (collecteur) : la pause devient un échec de fichier', 'collecteur-images-ptcgio.js', 'if (err.pauseHote) { pauseHote = err; break; }', '', 'test-ptcgio.js'),
    M('tpc : la fausse absence n\'est plus absente', 'collecte-cartes/tpc.js', "if (x.action === 'absente') return null;\n                return r;", "if (x.action === 'absente') throw new Error('x');\n                return r;", 'test-tpc.js'),
    M('tpc : le défi d\'une image ne bloque plus (REDONDANCE : requete() juge d\'abord le défi par la même fonction du module)', 'collecte-cartes/tpc.js', "if (x.action === 'arret-definitif') bloquer(r, courant);", '', null),
    M('tpc (collecteur) : la pause devient un échec de fichier', 'collecteur-images-tpc.js', 'if (err.pauseHote) { pauseHote = err; break; }', '', 'test-collecteur-tpc.js'),
    M('pikaqian : la fausse absence n\'est plus absente', 'collecte-cartes/pikaqian.js', "if (x.action === 'absente') { suite = 0; return null; }", "if (x.action === 'absente') { suite = 0; throw new Error('x'); }", 'test-pikaqian.js'),
    M('pikaqian : le défi d\'une image ne bloque plus (REDONDANCE : obtenir() juge d\'abord le défi par la même fonction du module)', 'collecte-cartes/pikaqian.js', "if (x.action === 'arret-definitif') bloquer(r, courant.url);", '', null),
    M('pikaqian : la définition du défi ne passe plus par le module', 'collecte-cartes/pikaqian.js', 'const defi = r => RH.detecterDefi(RH.entreeDepuisClient(r, { borne: 5000 })) !== null;', 'const defi = r => false;', 'test-pikaqian.js'),
    M('pkmncards : la fausse absence n\'est plus absente', 'collecteur-images-pkmncards.js', "if (x.action === 'absente') { index.images[url] = RH.entreeAbsence(", "if (false) { index.images[url] = RH.entreeAbsence(", 'test-collecteur-pkmncards.js'),
    M('pkmncards : le défi n\'arrête plus', 'collecteur-images-pkmncards.js', "if (x.action === 'arret-definitif') return { ...arret(", "if (false) return { ...arret(", 'test-collecteur-pkmncards.js'),
    M('pkmncards : la pause n\'est plus rendue', 'collecteur-images-pkmncards.js', "if (x.action === 'pause' || x.action === 'pause-persistante') return { etat: 'pause-hote'", "if (false) return { etat: 'pause-hote'", 'test-collecteur-pkmncards.js'),
    M('pokemoncom : le défi n\'arrête plus', 'collecteur-images-pokemoncom.js', "if (x.action === 'arret-definitif') return { ...arret(", "if (false) return { ...arret(", 'test-collecteur-pokemoncom.js'),
    M('pokemoncom : la pause n\'est plus rendue', 'collecteur-images-pokemoncom.js', "if (x.action === 'pause' || x.action === 'pause-persistante') return { etat: 'pause-hote'", "if (false) return { etat: 'pause-hote'", 'test-collecteur-pokemoncom.js'),
    M('pokemoncom : la fausse absence arrête', 'collecteur-images-pokemoncom.js', "if (x.action === 'absente') { index.images[url]", "if (false) { index.images[url]", 'test-collecteur-pokemoncom.js'),
    M('artofpkm : la fausse absence n\'est plus absente', RH, "if (x.action === 'absente') return { absente: true", "if (false) return { absente: true", BX),
    M('artofpkm : le registre du processus n\'est plus consulté avant la requête (I3)', 'collecte-cartes/artofpkm.js', 'function garderSource(url) { RH.garderHote(racineDe(url), dossierPauses, suivi); }', 'function garderSource(url) { RH.garderHote(racineDe(url), dossierPauses); }', BX),
    M('artofpkm : un 5xx lève de nouveau dans axios avant le module (I1)', 'collecte-cartes/artofpkm.js', "responseType: bin ? 'arraybuffer' : 'text', validateStatus: () => true", "responseType: bin ? 'arraybuffer' : 'text', validateStatus: s => s < 500", BX),
    M('artofpkm (collecteur) : le défi n\'arrête plus la passe', 'collecteur-images.js', 'if (err.bloque || err.pauseHote) { arretHote = err; break; }', 'if (false) { arretHote = err; break; }', BX),
    M('bulba : l\'arrêt durable n\'est plus lu avant la requête (I2)', 'collecte-cartes/bulba.js', 'RH.garderHote(SOURCE_RACINE, dossierPauses ?? dossierDefaut, suivi);', '', BX),
    M('bulba : le défi est avalé par le transport (plus d\'erreur typée)', 'collecte-cartes/bulba.js', 'if (e.refusRedirection || e.bloque || e.pauseHote || e.absente) throw e;', 'if (e.refusRedirection) throw e;', BX),
    M('tcgdex : un défi est réessayé (REDONDANCE : garde() relève l\'arrêt avant le réessai)', 'collecte-cartes/tcgdex.js', 'if (e.bloque || e.pauseHote) throw e;      // jamais de réessai', 'if (false) throw e;      // jamais de réessai', null),
    M('tcgdex : l\'arrêt durable n\'est plus lu avant la requête (I2)', 'collecte-cartes/tcgdex.js', 'RH.garderHote(SOURCE_RACINE, dossierPauses, suivi);   // l\'arrêt durable', '// supprimé   // l\'arrêt durable', BX),
    // ── correction 1 (relecture 1) ──
    M('I1 bulba : un 5xx lève de nouveau dans axios avant le module', 'collecte-cartes/bulba.js', 'maxRedirects: 0, validateStatus: () => true', 'maxRedirects: 0, validateStatus: s => s < 500', BX),
    M('I1 tcgdex : un 5xx lève de nouveau dans axios avant le module', 'collecte-cartes/tcgdex.js', "responseType: 'arraybuffer', headers: { 'User-Agent': 'rat-market-catalogue/1.0' }, validateStatus: () => true", "responseType: 'arraybuffer', headers: { 'User-Agent': 'rat-market-catalogue/1.0' }, validateStatus: s => s < 500", 'test-collecteur-tcgdex-reponse.js'),
    M('I1 artofpkm : un 503 « Just a moment » est réessayé (le défi n\'est plus vu en 5xx)', 'collecte-cartes/artofpkm.js', 'if (r.status >= 500 && !motif5xx) throw', 'if (r.status >= 500) throw', BX),
    M('I1 bulba : un 503 « Just a moment » est réessayé', 'collecte-cartes/bulba.js', 'if (r.status >= 500 && !RH.detecterDefi(', 'if (r.status >= 500 && !(() => null)(', BX),
    M('I2 l\'arrêt durable n\'est pas écrit sur défi', RH, "fichier = arretHote(hote, `${x.motif} (HTTP ${r?.status ?? '?'})`, { dossier: dossierPauses, url });", 'fichier = null;', BX),
    M('I2 garderHote ne lit plus l\'arrêt durable', RH, "const a = hoteArrete(hote, dossier);\n    if (a) throw", "const a = null;\n    if (a) throw", BM),
    M('I2 le fichier d\'arrêt illisible ne vaut plus arrêt', RH, "return { hote, nature: 'arret-definitif', illisible: true,", "return null; void { hote, nature: 'arret-definitif', illisible: true,", BM),
    M('I2 l\'arrêt écrit perd sa nature', RH, "nature: 'arret-definitif', le: new Date().toISOString(), motif, url: adresse,", "nature: 'pause', le: new Date().toISOString(), motif, url: adresse,", BM),
    M('I2 la racine d\'un hôte n\'est plus calculée (artofpkm : www et cdn deux sources)', RH, "return l.length <= 2 ? String(hote) : l.slice(-2).join('.'); }", "return String(hote); }", BM),
    M('I3 garderHote ne consulte plus le suivi du processus', RH, 'if (m) throw Object.assign(new Error(`${hote} EN PAUSE pour ce processus', 'if (false) throw Object.assign(new Error(`${hote} EN PAUSE pour ce processus', BM),
    M('I3 une réponse inattendue ne met plus l\'hôte en pause pour le processus', RH, "if (classement?.issue === 'inattendue') { e.pause = true;", "if (classement?.issue === 'inattendue') { e.pause = false;", BM),
    M('I3 le registre du processus est neuf à chaque appel', RH, 'const suiviDuProcessus = () => REGISTRE;', 'const suiviDuProcessus = () => suiviHote();', BM),
    M('I3 pokumon : un suivi neuf par client', 'collecte-cartes/pokumon.js', 'suivi = RH.suiviDuProcessus(), dossierPauses', 'suivi = RH.suiviHote(), dossierPauses', 'test-pokumon.js'),
    M('I3 ptcgio : un suivi neuf par client', 'collecte-cartes/ptcgio.js', 'suivi = RH.suiviDuProcessus(), dossierPauses', 'suivi = RH.suiviHote(), dossierPauses', 'test-ptcgio.js'),
    M('I3 tpc : un suivi neuf par client', 'collecte-cartes/tpc.js', 'suivi = RH.suiviDuProcessus(), dossierPauses', 'suivi = RH.suiviHote(), dossierPauses', 'test-tpc.js'),
    M('I3 pikaqian : un suivi neuf par client', 'collecte-cartes/pikaqian.js', 'suivi = RH.suiviDuProcessus(), dossierPauses', 'suivi = RH.suiviHote(), dossierPauses', 'test-pikaqian.js'),
    M('I3 tcgdex : un suivi neuf par client', 'collecte-cartes/tcgdex.js', 'suivi = RH.suiviDuProcessus(), dossierPauses', 'suivi = RH.suiviHote(), dossierPauses', BX),
    M('I3 pkmncards : un suivi neuf par appel', 'collecteur-images-pkmncards.js', 'suivi = RH.suiviDuProcessus(), dossierPauses', 'suivi = RH.suiviHote(), dossierPauses', 'test-collecteur-pkmncards.js'),
    M('I3 pokemoncom : un suivi neuf par appel', 'collecteur-images-pokemoncom.js', 'suivi = RH.suiviDuProcessus(), dossierPauses', 'suivi = RH.suiviHote(), dossierPauses', 'test-collecteur-pokemoncom.js'),
    M('M1 pokemoncom : la garde PNG est retirée', 'collecteur-images-pokemoncom.js', 'if (!r.octets.subarray(0, 8).equals(PNG_MAGIE)) return {', 'if (false) return {', 'test-collecteur-pokemoncom.js'),
    M('M2 reagir sans suivi laisse passer', RH, "if (!suivi) return { action: 'pause'", "if (false) return { action: 'pause'", BM),
    M('M2 une issue inconnue passe', RH, "return { action: 'pause', ...base, motif: `issue inconnue", "return { action: 'absente', ...base, motif: `issue inconnue", BM),
    M('M2 l\'écriture de la pause qui échoue ne lève plus', RH, "throw erreurPause({ ...reaction, motif: `${reaction.motif} ; écriture de la pause persistante impossible (${e.message})` }, hote, url, { ecritureEchouee: true }); }", 'reaction.fichier = null; }', BM),
    M('M2 lireImage laisse passer une action inconnue (REDONDANCE : reagir est fermé, aucune action inconnue n\'arrive jusqu\'ici — ceinture de la ceinture)', RH, "if (x.action !== 'continuer') throw erreurPause(", "if (false) throw erreurPause(", null),
    M('M3 le corps coupé à la borne n\'est plus inattendu', RH, "if (corps.length >= BORNE_CORPS) return { issue: 'inattendue'", "if (false) return { issue: 'inattendue'", BM),
    M('M3 l\'UTF-16 LE n\'est plus décodé', RH, 'if (corps.length >= 2 && corps[0] === 0xff && corps[1] === 0xfe) return', 'if (false) return', BM),
    M('M3 l\'UTF-16 BE n\'est plus décodé', RH, 'if (corps.length >= 2 && corps[0] === 0xfe && corps[1] === 0xff) {', 'if (false) {', BM),
    M('M3 un corps à octets NUL sans BOM n\'est plus indécodable', RH, 'if (corps.includes(0)) return null;', '', BM),
    M('M3 un corps indécodable n\'est plus inattendu', RH, "if (texte === null) return { issue: 'inattendue'", "if (false) return { issue: 'inattendue'", BM),
    M('M4 la première fausse absence s\'écrit « absent » définitif (pokemoncom)', RH, "return { statut: 'fausse-absente', status, empreinte: x.empreinte ?? null, n: 1, le };", "return { statut: 'absent', status, empreinte: x.empreinte ?? null, n: 1, le };", 'test-collecteur-pokemoncom.js'),
    M('M4 la fausse absence est redemandée sans attendre 24 h (pkmncards)', RH, 'return Number.isFinite(t) && maintenant - t < DELAI_FAUSSE_ABSENCE_MS;', 'return false;', 'test-collecteur-pkmncards.js'),
    M('M4 la seconde fausse absence ne devient pas définitive (pkmncards)', RH, "if (precedente?.statut === 'fausse-absente') return { statut: 'absent'", "if (false) return { statut: 'absent'", 'test-collecteur-pkmncards.js'),
    M('M4 le délai de 24 h devient 1 s', RH, 'const DELAI_FAUSSE_ABSENCE_MS = 24 * 3600 * 1000;', 'const DELAI_FAUSSE_ABSENCE_MS = 1000;', 'test-collecteur-pokemoncom.js'),
    M('F3 logos officiels : 401 et 410 ne sont plus des défis', RH, 'const STATUTS_DEFI = Object.freeze([401, 403, 410, 429]);', 'const STATUTS_DEFI = Object.freeze([403, 429]);', 'test-collecter-logos-officiels.js'),
    M('F3 logos officiels : la définition du défi redevient locale', 'collecter-logos-officiels.js', 'return RH.detecterDefi({ statut: r.status,', 'return [403, 429].includes(r.status) || !!h(\'cf-mitigated\') || RH.detecterDefi === null && ({ statut: r.status,', 'test-collecter-logos-officiels.js'),
    M('M5 tcgdex collecteur : le défi n\'arrête plus l\'unité', 'collecteur-images-tcgdex.js', 'if (err.bloque || err.pauseHote) { arretHote = err; break; }', 'if (false) { arretHote = err; break; }', 'test-collecteur-tcgdex-reponse.js'),
    M('M5 tcgdex collecteur : la pause n\'arrête plus l\'unité', 'collecteur-images-tcgdex.js', "etat: arretHote.bloque ? 'refuse-source-bloquee' : 'incomplet'", "etat: 'refuse-source-bloquee'", 'test-collecteur-tcgdex-reponse.js'),
    M('M5 tcgdex client : l\'arrêt durable n\'est pas lu avant la requête', 'collecte-cartes/tcgdex.js', 'RH.garderHote(SOURCE_RACINE, dossierPauses, suivi);   // l\'arrêt durable', '// supprimé   // l\'arrêt durable', 'test-collecteur-tcgdex-reponse.js')
];

const original = new Map();
const lire = f => { if (!original.has(f)) original.set(f, fs.readFileSync(path.join(__dirname, f), 'utf8')); return original.get(f); };
const restaurer = () => { for (const [f, t] of original) fs.writeFileSync(path.join(__dirname, f), t); };
process.on('exit', restaurer);
function banc(b) { const r = spawnSync(process.execPath, [b], { cwd: __dirname, encoding: 'utf8', timeout: 280000 }); return { code: r.status, rouges: (r.stdout.match(/^(❌|\s*ECHEC )/gm) || []).length }; }
const filtre = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
let tues = 0; const vivants = [], sansAttache = [], redondants = [], codeBase = new Map();
const bancs = [...new Set(MUTANTS.map(m => m.banc).filter(Boolean))];
for (const b of bancs) { const r = banc(b); if (r.code !== 0 && b !== 'test-pikaqian.js' && b !== 'test-collecter-logos-officiels.js' && !(r.rouges === 0 && r.code === -1073740791)) { console.error(`❌ le banc ${b} n'est pas vert avant les mutants (code ${r.code})`); process.exit(2); } codeBase.set(b, r.code); }
console.log(`bancs verts avant mutation (test-pikaqian.js : 1 échec déjà présent sur la base, seuils) ; ${MUTANTS.length} mutants\n`);
for (const m of MUTANTS) {
    if (filtre && !filtre.test(m.nom)) continue;
    const t = lire(m.fichier);
    const eol = s => (t.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s);
    const de = eol(m.de), vers = eol(m.vers);
    if (t.split(de).length - 1 !== 1) { sansAttache.push(`${m.nom} (pas exactement 1 occurrence dans ${m.fichier})`); continue; }
    if (!m.banc) { redondants.push(m.nom); console.log('redondance documentée  ' + m.nom); continue; }
    fs.writeFileSync(path.join(__dirname, m.fichier), t.replace(de, () => vers));
    let r; try { r = banc(m.banc); } finally { fs.writeFileSync(path.join(__dirname, m.fichier), t); }
    const base = m.banc === 'test-pikaqian.js' ? 1 : 0;
    const tue = r.rouges > base || r.code !== codeBase.get(m.banc);        // une ligne ❌ de plus, ou un code de sortie qui change (le banc, vert avant, plante ou échoue)
    if (tue) tues++; else vivants.push(`${m.nom} (code ${r.code}, ${r.rouges} ❌)`);
    console.log(`${tue ? '🔴 rouge vu' : '⚠️ VIVANT  '}  ${m.nom}  [${r.rouges} ❌ au banc ${m.banc}]`);
}
console.log(`\n${tues} mutants tués sur ${MUTANTS.length - sansAttache.length} jugés · ${vivants.length} vivants · ${sansAttache.length} sans point d'attache`);
for (const v of vivants) console.log(`   VIVANT : ${v}`);
for (const s of sansAttache) console.log(`   SANS ATTACHE : ${s}`);
process.exit(vivants.length || sansAttache.length ? 1 : 0);
