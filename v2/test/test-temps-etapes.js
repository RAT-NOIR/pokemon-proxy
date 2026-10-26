'use strict';
// LOT TEMPS-ETAPES — les pièces PURES : les trois drapeaux de la configuration (éteints par défaut), le chronomètre des étapes (durées additives du journal des scans), et la mémoïsation de la recherche des voisins
// (preparerVecteur : UNE recherche par requête au lieu de deux). Aucune base, aucun réseau, aucun modèle ; l'index est FABRIQUÉ (_empreinte-aide.js).
const H = require('./_harnais');
const { lireConfig } = require('../config');
const A = require('./_empreinte-aide');
const TE = require('../identifier/temps-etapes');
const V = require('../identifier/voisins-empreinte');
const { v, vrai } = H;

const ENV = { MONGODB_BASE: 'test_scratch' };
const NOMS = { voisinsUneFois: 'V2_TE_VOISINS_UNE_FOIS', empreinteTot: 'V2_TE_EMPREINTE_TOT', finParallele: 'V2_TE_FIN_PARALLELE', orbUtile: 'V2_TE_ORB_UTILE' };

(async () => {
    console.log('=== 1. les quatre drapeaux : booleen() de la configuration, ÉTEINTS par défaut ===');
    {
        const c = lireConfig(ENV);
        v('défaut : tout éteint', c.tempsEtapes, { voisinsUneFois: false, empreinteTot: false, finParallele: false, orbUtile: false });
        for (const [cle, nom] of Object.entries(NOMS)) {
            const on = lireConfig({ ...ENV, [nom]: '1' }).tempsEtapes;
            v(`« 1 » allume ${cle} et rien d'autre`, Object.entries(on).filter(([, x]) => x).map(([k]) => k), [cle]);
            v(`« 0 » éteint ${cle}`, lireConfig({ ...ENV, [nom]: '0' }).tempsEtapes[cle], false);
            let leve = null; try { lireConfig({ ...ENV, [nom]: 'true' }); } catch (e) { leve = e.message; }
            vrai(`« true » rend la configuration invalide (booleen strict) pour ${nom}`, leve && leve.includes(nom));
        }
        vrai('la configuration est gelée (le drapeau ne se change pas en cours de route)', Object.isFrozen(c.tempsEtapes));
        v('reglages(cfg) lit cfg.tempsEtapes ; sans cfg, tout éteint', [TE.reglages(c), TE.reglages(null), TE.reglages({}), TE.reglages({ tempsEtapes: { finParallele: 'oui' } })].map(x => Object.values(x).some(Boolean)), [false, false, false, false]);
        v('reglages(cfg) : seul `true` allume (écrit par ce qu\'on AUTORISE)', TE.reglages({ tempsEtapes: { voisinsUneFois: true, empreinteTot: 1, finParallele: 'true', orbUtile: {} } }), { voisinsUneFois: true, empreinteTot: false, finParallele: false, orbUtile: false });
    }

    console.log('=== 2. le chronomètre : durées par étape, entières, sans rien d\'autre que des nombres ===');
    {
        let t = 1000, cpu = 0;
        const horloge = () => t, mesureCpu = () => ({ user: cpu * 1000, system: 0 });
        const C = TE.creerChrono({ horloge, cpu: mesureCpu, gc: (a, b) => (b > a ? 12.4 : 0), rss: () => 450.4 * 1048576 });
        const r = await C.mesurer('lecture', async () => { t += 2051.6; cpu += 40; return 'x'; });
        v('mesurer rend la valeur de la fonction', r, 'x');
        const s = C.mesurerSync('voisins', () => { t += 120; cpu += 110; return 7; });
        v('mesurerSync rend la valeur', s, 7);
        await C.mesurer('lecture', async () => { t += 10; cpu += 1; });
        C.poser('catalogue', 504.4, 30);
        C.poser('photo', 880);
        t += 5;
        const d = C.exporter();
        v('les durées s\'ADDITIONNENT par étape et sont arrondies à l\'entier', [d.lecture, d.voisins, d.catalogue, d.photo], [2062, 120, 504, 880]);
        v('le total court de la création du chronomètre à l\'export', d.total, 2187);
        v('le CPU est dit à part, étape par étape (millisecondes de CPU, pas de temps d\'attente)', d.cpu, { lecture: 41, catalogue: 30, voisins: 110 });
        v('le ramasse-miettes pendant le scan et la mémoire résidente sont dits à part', [d.gc, d.rssMo], [12, 450]);
        vrai('toutes les valeurs sont des entiers finis >= 0', Object.entries(d).every(([k, x]) => (k === 'cpu' ? Object.values(x).every(y => Number.isInteger(y) && y >= 0) : Number.isInteger(x) && x >= 0)));
        vrai('les seules clés possibles sont celles de la liste fermée, plus cpu / gc / rssMo (aucun nom libre ne peut porter une donnée)', Object.keys(d).every(k => ['cpu', 'gc', 'rssMo'].includes(k) || TE.ETAPES.includes(k)));
        let leve = 0; for (const mauvais of ['secret', '__proto__', 'constructor', '', 'Lecture', 'adresse']) { try { C.poser(mauvais, 1); } catch { leve++; } }
        v('un nom hors liste est refusé (6 essais)', leve, 6);
        const avant = JSON.stringify(C.exporter());
        for (const mauvaise of [NaN, Infinity, -5, '12', null, undefined, {}, []]) C.poser('base', mauvaise);
        v('une valeur qui n\'est pas un nombre fini >= 0 est ignorée (jamais NaN dans le journal)', JSON.stringify(C.exporter()), avant);
        let rejete = null;
        try { await C.mesurer('empreinte', async () => { t += 30; throw new Error('panne'); }); } catch (e) { rejete = e.message; }
        v('une fonction qui lève : la durée est notée ET l\'erreur remonte intacte', [rejete, C.exporter().empreinte], ['panne', 30]);
        v('exporter ne mute rien : deux exports d\'affilée (horloge arrêtée) sont identiques', JSON.stringify(C.exporter()) === JSON.stringify(C.exporter()), true);
    }
    {
        const C = TE.creerChrono();
        const x = await C.mesurer('base', async () => { await new Promise(r => setTimeout(r, 25)); return 1; });
        const d = C.exporter();
        vrai('horloge réelle : 25 ms d\'attente comptent (>= 20) et le total les contient', x === 1 && d.base >= 20 && d.total >= d.base);
        const fin = Date.now() + 60; let x1 = 0;
        await C.mesurer('empreinte', async () => { while (Date.now() < fin) x1 += Math.sqrt(x1 + 1); });
        vrai('un calcul de 60 ms d\'horloge compte du CPU (>= 10 ms ; process.cpuUsage, le processus entier)', C.exporter().cpu.empreinte >= 10);
        vrai('horloge réelle : `gc` (si l\'observateur existe) et `rssMo` sont des entiers plausibles', (d.gc === undefined || (Number.isInteger(d.gc) && d.gc >= 0)) && Number.isInteger(d.rssMo) && d.rssMo > 10);
        // le ramasse-miettes d'un scan : une pause provoquée PENDANT la fenêtre est vue (global.gc absent : on n'affirme que si le processus l'expose)
        if (typeof global.gc === 'function') {
            const C2 = TE.creerChrono(); global.gc(); await new Promise(r => setTimeout(r, 20));
            vrai('une pause de ramasse-miettes provoquée pendant la fenêtre est comptée', C2.exporter().gc >= 0);
        }
    }

    console.log('=== 3. preparerVecteur : UNE recherche des voisins par requête (memo), mêmes valeurs, jamais les mêmes objets ===');
    {
        A.installerIndex();
        const idx = A.etat.courante().index;
        let appels = 0; const vraie = idx.voisins.bind(idx);
        idx.voisins = (q, k) => { appels++; return vraie(q, k); };
        const env = () => V.lireEnveloppe({ empreintes: [A.entree(0, 3, true, false)], modeleEmpreinte: A.modeleAnnonce() }, 1);
        const voulu = A.modeleAnnonce();
        const sans1 = V.preparerVecteur({ entree: { empreintes: env() }, voulu, etat: A.etat });
        v('sans memo (défaut) : 1 recherche par appel', [sans1.ok, appels], [true, 1]);
        const e0 = { empreintes: env() };
        appels = 0;
        const a = V.preparerVecteur({ entree: e0, voulu, etat: A.etat, memo: true });
        const b = V.preparerVecteur({ entree: e0, voulu, etat: A.etat, memo: true });
        v('avec memo : UNE seule recherche pour deux appels sur la même requête', appels, 1);
        v('… et les deux résultats sont égaux en valeur (voisins, meilleur cosinus, vecteur, e0)', JSON.stringify([a.ok, a.trouve, Array.from(a.v.vecteur), a.v.meilleurCosinus, a.e0.photo]) === JSON.stringify([b.ok, b.trouve, Array.from(b.v.vecteur), b.v.meilleurCosinus, b.e0.photo]), true);
        v('… et égaux au résultat SANS memo (mêmes valeurs que la voie d\'avant)', JSON.stringify([a.ok, a.trouve, Array.from(a.v.vecteur), a.v.meilleurCosinus]) === JSON.stringify([sans1.ok, sans1.trouve, Array.from(sans1.v.vecteur), sans1.v.meilleurCosinus]), true);
        vrai('… mais jamais les MÊMES objets : un appelant qui modifie sa copie ne change pas celle de l\'autre', a.trouve !== b.trouve && a.trouve.top !== b.trouve.top && a.v.vecteur !== b.v.vecteur && a.trouve.top[0] !== b.trouve.top[0]);
        a.trouve.top[0][1] = -99; a.trouve.top.pop(); a.v.vecteur[0] = 123;                   // la copie du PREMIER appel est abîmée…
        b.trouve.top[0][1] = -77; b.trouve.top.pop(); b.trouve.top.pop(); b.v.vecteur[1] = 456;       // … et celle d'un appel SERVI PAR LA MÉMOIRE aussi
        const c = V.preparerVecteur({ entree: e0, voulu, etat: A.etat, memo: true });
        v('une copie modifiée n\'abîme pas la mémoire, qu\'elle vienne du 1er appel ou d\'un appel servi par la mémoire (3e appel intact, toujours 1 recherche)', [JSON.stringify(c.trouve) === JSON.stringify(sans1.trouve), c.v.vecteur[0] === sans1.v.vecteur[0], c.v.vecteur[1] === sans1.v.vecteur[1], appels], [true, true, true, 1]);
        // une AUTRE requête (autre enveloppe) ne profite jamais de la mémoire de la première
        appels = 0;
        V.preparerVecteur({ entree: { empreintes: env() }, voulu, etat: A.etat, memo: true });
        v('une autre requête (même contenu, autre objet) refait sa recherche', appels, 1);
        // l'index change entre les deux appels (rechargement) : la mémoire n'est plus valable
        appels = 0;
        const e1 = { empreintes: env() };
        V.preparerVecteur({ entree: e1, voulu, etat: A.etat, memo: true });
        const ancien = A.etat.courante();
        const autre = require('../identifier/index-empreintes').ouvrir(A.scelle(), A.SECRET, { modeleAttendu: A.MODELE });
        A.etat.installer(Object.freeze({ index: autre.index, meta: autre.meta }));
        let appels2 = 0; const vraie2 = autre.index.voisins.bind(autre.index); autre.index.voisins = (q, k) => { appels2++; return vraie2(q, k); };
        const apres = V.preparerVecteur({ entree: e1, voulu, etat: A.etat, memo: true });
        v('l\'index en place a changé entre deux appels : la recherche est refaite sur le NOUVEL index', [apres.ok, appels2, apres.courant === A.etat.courante()], [true, 1, true]);
        A.etat.installer(ancien);
        // les échecs ne sont jamais mémorisés
        const mauvais = { empreintes: V.lireEnveloppe({ empreintes: [A.entree(0, 3, true, false)], modeleEmpreinte: { id: 'autre', sha256: A.MODELE.sha256 } }, 1) };
        v('un modèle inconnu reste « modele-inconnu » avec memo, deux fois de suite', [V.preparerVecteur({ entree: mauvais, voulu, etat: A.etat, memo: true }), V.preparerVecteur({ entree: mauvais, voulu, etat: A.etat, memo: true })].map(x => x.code), ['modele-inconnu', 'modele-inconnu']);
        v('sans enveloppe : « invalide » avec memo (le WeakMap n\'est pas indexé sur undefined)', V.preparerVecteur({ entree: {}, voulu, etat: A.etat, memo: true }).code, 'invalide');
        // chronomètre branché : la recherche est mesurée une fois ; un appel servi par la mémoire ne mesure rien de plus
        const C = TE.creerChrono();
        const e2 = { empreintes: env() };
        V.preparerVecteur({ entree: e2, voulu, etat: A.etat, memo: true, chrono: C });
        const d1 = C.exporter().voisins;
        V.preparerVecteur({ entree: e2, voulu, etat: A.etat, memo: true, chrono: C });
        vrai('la recherche est comptée dans l\'étape « voisins » ; la seconde (mémoire) n\'ajoute pas de recherche', typeof d1 === 'number' && C.exporter().voisins <= d1 + 1);
    }

    console.log('=== 4. le dépôt de la photo : sa durée est gardée avec la photo, rendue au scan (nombres seulement) ===');
    {
        const { creerPhotosRecues } = require('../identifier/photos-recues');
        const { rattacherPhotos } = require('../identifier/routes');
        const m = creerPhotosRecues();
        const porteur = { type: 'installation', id: 'banc-te' }, cle = `${porteur.type}:${porteur.id}`;
        const id1 = m.deposer(cle, 0, Buffer.from('a'), null, { totalMs: 880.4, traitementMs: 610.2 });
        const id2 = m.deposer(cle, 0, Buffer.from('b'), null, { totalMs: 1200, traitementMs: 'secret-factice' });       // secret-factice
        const id3 = m.deposer(cle, 0, Buffer.from('c'), null, { totalMs: -3, traitementMs: NaN });
        const id4 = m.deposer(cle, 0, Buffer.from('d'));
        const lu = id => { const x = m.prendre(cle, id); return x && x.durees; };
        v('une durée valide est gardée telle quelle', lu(id1), { totalMs: 880.4, traitementMs: 610.2 });
        v('un texte, un négatif, un NaN : null (jamais gardés)', [lu(id2), lu(id3)], [{ totalMs: 1200, traitementMs: null }, { totalMs: null, traitementMs: null }]);
        v('sans durée : null', lu(id4), null);
        // rattacherPhotos : la plus longue des photos du scan
        const a = m.deposer(cle, 0, Buffer.from('a'), null, { totalMs: 300, traitementMs: 200 }), b = m.deposer(cle, 1, Buffer.from('b'), null, { totalMs: 900, traitementMs: 100 });
        const entree = { photoIds: [{ index: 0, photoId: a }, { index: 1, photoId: b }] };
        rattacherPhotos({ entree, v2: { porteur } }, { photosRecues: m }, null);
        v('rattacherPhotos : la photo la plus longue à déposer fixe la durée du scan (max par champ)', entree.photoDureesMs, { totalMs: 900, traitementMs: 200 });
        vrai('… non énumérable (jamais sérialisée avec l\'entrée)', !Object.keys(entree).includes('photoDureesMs') && !JSON.stringify(entree).includes('photoDureesMs'));
        const sans = { photoIds: [{ index: 0, photoId: m.deposer(cle, 0, Buffer.from('z')) }] };
        rattacherPhotos({ entree: sans, v2: { porteur } }, { photosRecues: m }, null);
        v('photos reçues sans durée : rien n\'est posé', 'photoDureesMs' in sans, false);
        m.arreter();
    }

    console.log('=== 5. POST /api/photo : le gestionnaire passe ses deux durées au magasin ===');
    {
        const { Readable } = require('stream');
        const sharp = require('sharp');
        const { traiterPhotoAvantScan } = require('../identifier/photo-avant-scan');
        const cfg = lireConfig(ENV);
        const jpeg = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 120, g: 80, b: 60 } } }).jpeg({ quality: 70 }).toBuffer();
        const dep = []; const faux = { deposer: (...a) => { dep.push(a); return 'a'.repeat(32); }, prendre() { return null; }, maintenant: () => Date.now() };
        const h = traiterPhotoAvantScan(cfg, { photosRecues: faux });
        const req = Object.assign(Readable.from([jpeg]), { headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.length) }, query: {}, v2: { porteur: { type: 'installation', id: 'banc-te-photo' } } });
        let sortie = null; const res = { once() { }, setHeader() { }, status(c) { this.c = c; return this; }, json(o) { sortie = { c: this.c, o }; return this; } };
        await h(req, res);
        vrai(`le dépôt répond 200 avec un photoId (${sortie && sortie.c})`, sortie && sortie.c === 200 && /^[a]{32}$/.test(sortie.o.photoId));
        const d5 = dep[0] && dep[0][4];
        vrai('le magasin reçoit en 5e argument { totalMs, traitementMs } : deux nombres >= 0, le total contient le traitement', d5 && Number.isFinite(d5.totalMs) && Number.isFinite(d5.traitementMs) && d5.traitementMs > 0 && d5.totalMs >= d5.traitementMs);
        vrai('… et les 4 premiers arguments sont ceux d\'avant (clé du porteur, index 0, octets, version réduite)', dep[0] && dep[0][0] === 'installation:banc-te-photo' && dep[0][1] === 0 && Buffer.isBuffer(dep[0][2]) && Buffer.isBuffer(dep[0][3]));
    }

    console.log('=== 6. la chaîne héritée (index.js) note ses durées pour la route v2 — et seulement pour elle ===');
    {
        // index.js n'est pas rejouable ici (c'est le gestionnaire entier, partagé avec la v1) : le banc lit le SOURCE et exige, pour chacune des trois mesures, la ligne gardée par `req.dureesChaine`
        const src = require('fs').readFileSync(process.env.TE_INDEX_SOURCE || require('path').join(__dirname, '..', '..', 'index.js'), 'utf8');       // TE_INDEX_SOURCE : la copie mutée d'index.js (mutations-temps-etapes.js) ; absente : le vrai fichier
        vrai('la lecture et l\'attente de l\'état sont notées, gardées par req.dureesChaine', /if \(req\.dureesChaine\) \{ req\.dureesChaine\.lecture = msIA; req\.dureesChaine\.etat = Date\.now\(\) - debutAttenteEtat; \}/.test(src));
        vrai('le catalogue + scoring est noté, gardé par req.dureesChaine', /if \(req\.dureesChaine\) req\.dureesChaine\.catalogue = msCatalogue;/.test(src));
        vrai('le départage par l\'image est noté (nombre fini seulement), gardé par req.dureesChaine', /if \(req\.dureesChaine && Number\.isFinite\(champsImage\.imageMs\)\) req\.dureesChaine\.image = champsImage\.imageMs;/.test(src));
        const mentions = src.split('\n').filter(l => /req\.dureesChaine/.test(l));
        v('aucune autre mention de req.dureesChaine, et chacune est gardée (la v1 n\'a pas ce champ : ces lignes ne font rien chez elle)', [mentions.length, mentions.every(l => /if \(req\.dureesChaine\b/.test(l))], [3, true]);
    }

    console.log('=== 7. l\'outil de décomposition (v2/mesures/decomposer-temps.js) : quantiles, appariement, durees ===');
    {
        const D = require('../mesures/decomposer-temps');
        v('quantile : rang le plus proche (nearest-rank), comme serie-essai.js', [D.quantile([5, 1, 3, 2, 4], 0.5), D.quantile([5, 1, 3, 2, 4], 0.95), D.quantile([], 0.5), D.quantile([NaN, undefined], 0.5)], [3, 5, null, null]);
        v('resume : le dénominateur ne compte que les nombres finis', D.resume([1, 2, NaN, undefined, 3]), { n: 3, p50: 2, p90: 3, p95: 3, max: 3 });
        const t0 = Date.parse('2026-10-25T22:00:00.000Z');
        const journal = [0, 1].map(i => ({ le: new Date(t0 + i * 10000 + 2800).toISOString(), msIA: 2000, msCatalogue: 500, msEtat: 1500, imageMs: i === 0 ? 0 : null }));
        const analyses = [0, 1].map(i => ({ creeLe: new Date(t0 + i * 10000 + 3300).toISOString() }));
        const debuts = [t0, t0 + 10000], clients = [4300, 4500];
        const d = D.decomposerJournal({ journal, analyses, debuts, clients });
        v('une ligne : chaîne = fin - début des logs ; reste = chaîne - modèle - catalogue - image ; après la chaîne = analyse - fin ; hors = client - (analyse - début)',
            [d.lignes[0].chaine, d.lignes[0].resteChaine, d.lignes[0].apresChaine, d.lignes[0].hors, d.lignes[1].image], [2800, 300, 500, 1000, 0]);
        v('les étapes ont leur dénominateur', [d.etapes.client.n, d.etapes.chaine.p50, d.etapes.hors.p95], [2, 2800, 1200]);
        let leve = null; try { D.decomposerJournal({ journal, analyses, debuts: [t0], clients }); } catch (e) { leve = e.message; }
        vrai('des listes de longueurs différentes : LÈVE (jamais une décomposition à moitié appariée)', leve && /appariement impossible/.test(leve));
        const dd = D.decomposerDurees([{ durees: { lecture: 2000, total: 4000, cpu: { lecture: 10 }, gc: 5, rssMo: 450 } }, { durees: { lecture: 2200, total: 4400, cpu: { lecture: 30 }, gc: 7, rssMo: 460 } }, {}, null]);
        v('decomposerDurees : seules les lignes qui portent `durees` comptent ; p50 par étape, CPU à part', [dd.n, dd.etapes.lecture.p50, dd.etapes.total.p95, dd.etapes.gc.max, dd.etapes.rssMo.max, dd.cpu.lecture.p50, 'cpu' in dd.etapes], [2, 2000, 4400, 7, 460, 10, false]);
    }

    console.log('=== 8. orbUtile : la règle G ne peut RIEN changer à un introuvable de la chaîne (preuve par grille exhaustive, sur le code de production) ===');
    {
        const { arbitrer } = require('../identifier/arbitrage-g');
        const { arbitrerAvecPromotion } = require('../identifier/promotion-g');
        const sorties = [{ issue: 'affirmee', produit: 1 }, { issue: 'affirmee', produit: 2 }, { issue: 'affirmee', produit: 99 }, { issue: 'question', candidats: [1, 2] }, { issue: 'question', candidats: [2, 3, 4] }, { issue: 'question', candidats: [] }];
        const chaines = [{ issue: 'introuvable', ids: [] }, { issue: 'introuvable', ids: [1] }, { issue: 'introuvable', ids: [1, 2, 3] }, { issue: 'introuvable', ids: [], confirmationNombreux: undefined }];
        const gardes = [undefined, null, { jugeable: true, contredit: false, concordante: true }, { jugeable: true, contredit: false, concordante: false }, { jugeable: true, contredit: true, concordante: false }, { jugeable: false, contredit: null, concordante: false }, { jugeable: true, contredit: null, concordante: false }, 'n-importe-quoi'];
        let cas = 0, gardes_ok = 0, promus = 0, memeAction = 0;
        for (const c of chaines) for (const g of sorties) for (const garde of gardes) {
            cas++;
            const a = arbitrer(c, g), p = arbitrerAvecPromotion(c, g, { garde });                 // la route : depuisIntrouvable absent (faux)
            if (a.action === 'garder') gardes_ok++;
            if (p.action === 'garder' && p.promotion === false) memeAction++;
            if (p.action === 'promouvoir' || p.promotion === true) promus++;
        }
        v(`${cas} cas (introuvable × ${sorties.length} sorties de G × ${gardes.length} gardes) : l'arbitrage rend « garder » dans tous`, [cas, gardes_ok, memeAction, promus], [cas, cas, cas, 0]);
        // la contre-épreuve : la grille SAURAIT dire non — si la route autorisait la promotion d'un introuvable, une affirmation de G bien jugée le promouvrait
        const permis = arbitrerAvecPromotion({ issue: 'introuvable', ids: [] }, { issue: 'affirmee', produit: 1 }, { garde: { jugeable: true, contredit: false, concordante: true }, depuisIntrouvable: true });
        v('contre-épreuve : avec depuisIntrouvable: true (ce que la route n\'autorise PAS), la même grille promouvrait', [permis.action, permis.promotion], ['promouvoir', true]);
        // la route lit bien le code de production : elle n'autorise jamais la promotion d'un introuvable
        const src = require('fs').readFileSync(process.env.TE_ROUTES_SOURCE || require('path').join(__dirname, '..', 'identifier', 'routes.js'), 'utf8');       // TE_ROUTES_SOURCE : la copie mutée de routes.js (mutations-temps-etapes.js)
        vrai('routes.js ne passe jamais depuisIntrouvable: true (le seul appel passe false)', !/depuisIntrouvable:\s*true/.test(src) && /depuisIntrouvable:\s*false/.test(src));
    }

    H.bilan();
})().catch(e => { console.error(e); process.exitCode = 1; });
