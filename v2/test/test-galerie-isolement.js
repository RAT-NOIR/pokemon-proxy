'use strict';
// GALERIE, TOUR 1 — L'ISOLEMENT, écrit par ce qu'il AUTORISE (relecture 2 : C1, C2, I1, I2). Avec le drapeau allumé, la Communauté ne démarre que si :
//   (a) la grappe de MONGO_URI_GALERIE est EXACTEMENT V2_GALERIE_GRAPPE (déclarée, obligatoire) ; (b) elle diffère de chaque grappe connue posée ;
//   (c) la base porte le document MARQUEUR `galerie_meta`/`marqueur`, posé par l'outil d'initialisation seul ; (d) toutes ses collections sont dans la liste fermée de la Communauté ;
//   et côté R2 : DEUX buckets (privé pour depot/ et attente/, public pour pub/), chacun avec son objet marqueur posé par l'outil d'initialisation, chacun différent de tous les buckets connus.
// Toute autre situation BLOQUE avec une cause nommée. Les cas sont fabriqués (mémoire, faux client S3) et chaque garde a son mutant sur le code RÉEL (le texte du module, un fragment retiré).
const A = require('./_aide-galerie');
const H = A.H;
const mongoose = require('mongoose'), fs = require('fs'), path = require('path');

const avec = (c) => { const e = { ...A.ENV_VALIDE, ...c }; for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]; return e; };

(async () => {
    await H.ouvrirBac('test-galerie-isolement.js');
    const G = require('../galerie/base'), Gr = require('../galerie/grappe'), R2 = require('../galerie/r2');
    const { RefusGalerie } = require('../galerie/refus');
    const init = require('../galerie/outils/initialiser-base'), initR2 = require('../galerie/outils/initialiser-r2');
    const client = mongoose.connection.client;
    const dbG = () => client.db('rm_galerie_essai');
    const vider = async () => { await dbG().dropDatabase(); };
    const HOTE = 'cluster0-shard-00-00.dedie11.mongodb.net:27017';
    const creer = () => async () => ({ db: dbG(), host: HOTE, close: async () => { } });
    const issue = async (g = Gr, env = A.ENV_VALIDE) => { try { await g.ouvrir({ env, creer: creer() }); return 'ouverte'; } catch (e) { return e instanceof RefusGalerie ? e.cause : `autre:${e && e.name}`; } };

    // ═══ 1. (a) la grappe attendue est DÉCLARÉE et obligatoire ═══
    const j = (c) => Gr.jugerGrappe(avec(c));
    H.v('1. tout en ordre : OUI', j({}).ok, true);
    H.v('   V2_GALERIE_GRAPPE absente : NON, cause « variable-absente », la raison nomme la variable', [j({ V2_GALERIE_GRAPPE: undefined }).ok, j({ V2_GALERIE_GRAPPE: undefined }).cause, /V2_GALERIE_GRAPPE/.test(j({ V2_GALERIE_GRAPPE: undefined }).raison)], [false, 'variable-absente', true]);
    H.v('   MONGO_URI_GALERIE absente : NON, cause « variable-absente »', [j({ MONGO_URI_GALERIE: undefined }).ok, j({ MONGO_URI_GALERIE: undefined }).cause], [false, 'variable-absente']);
    H.v('   grappe déclarée différente de celle de l\'adresse : NON, cause « grappe-differente »', [j({ V2_GALERIE_GRAPPE: 'autre22.mongodb.net' }).ok, j({ V2_GALERIE_GRAPPE: 'autre22.mongodb.net' }).cause], [false, 'grappe-differente']);
    H.v('   MONGODB_CARTES_URI et MONGODB_ESSAI_URI ABSENTES du processus (la production seule posée) : une grappe quelconque non déclarée ne passe plus', j({ MONGODB_CARTES_URI: undefined, MONGODB_ESSAI_URI: undefined, V2_GALERIE_GRAPPE: undefined, MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.nimporte.mongodb.net/' }).ok, false);
    H.v('   la même grappe que la production, déclarée comme telle : NON « grappe-differente » (la déclaration ne dispense pas du reste)', [j({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.prodxx.mongodb.net/', V2_GALERIE_GRAPPE: 'prodxx.mongodb.net' }).ok, j({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.prodxx.mongodb.net/', V2_GALERIE_GRAPPE: 'prodxx.mongodb.net' }).cause], [false, 'grappe-differente']);

    // ═══ 2. (c) le marqueur et (d) la liste fermée des collections, jugés sur une VRAIE base ═══
    await vider();
    H.v('2. base vierge, sans marqueur : bloquée, cause « marqueur-absent »', await issue(), 'marqueur-absent');
    const r0 = await init.initialiserBase(dbG());
    H.v('   l\'outil d\'initialisation pose le marqueur (id fixe) et les index', [r0.ok, (await dbG().collection('galerie_meta').findOne({ _id: 'marqueur' })).base, (await dbG().collection('votes').indexes()).some(i => i.name === 'vote_unique')], [true, 'rm_galerie_essai', true]);
    H.v('   base initialisée : OUVERTE', await issue(), 'ouverte');
    const t0 = (await dbG().collection('galerie_meta').findOne({ _id: 'marqueur' })).poseLe;
    await init.initialiserBase(dbG());
    H.v('   l\'outil est idempotent (le marqueur n\'est pas réécrit)', (await dbG().collection('galerie_meta').findOne({ _id: 'marqueur' })).poseLe.getTime(), t0.getTime());
    await dbG().collection('comptes').insertOne({ email: 'x@y.fr' });
    const etr = await Gr.ouvrir({ env: A.ENV_VALIDE, creer: creer() }).then(() => null, e => e);
    H.v('   une collection étrangère (« comptes », la forme d\'une grappe de production) : bloquée, cause « collection-inconnue », qui NOMME la collection', [etr && etr.cause, etr && etr.detail], ['collection-inconnue', ['comptes']]);
    await dbG().collection('comptes').drop();
    await dbG().collection('numeros_cartes').insertOne({ n: 1 });
    H.v('   idem pour « numeros_cartes »', await issue(), 'collection-inconnue');
    const refusInit = await init.initialiserBase(dbG());
    H.v('   l\'outil REFUSE d\'initialiser une base qui porte une collection étrangère (et ne pose rien de plus)', [refusInit.ok, refusInit.cause], [false, 'collection-inconnue']);
    await vider();
    await dbG().collection('votes').insertOne({ compte: 'x' });
    H.v('   une base qui n\'a que des collections de la liste mais PAS de marqueur : bloquée (un alias vers une base homonyme ne passe pas)', await issue(), 'marqueur-absent');
    await vider(); await dbG().collection('galerie_meta').insertOne({ _id: 'marqueur', galerie: true, base: 'autre_base' });
    H.v('   un marqueur qui nomme une autre base : bloqué, cause « marqueur-incorrect »', await issue(), 'marqueur-incorrect');
    await vider(); await dbG().collection('galerie_meta').insertOne({ _id: 'autre', galerie: true, base: 'rm_galerie_essai' });
    H.v('   un document de galerie_meta qui n\'a pas l\'identifiant fixe n\'est pas le marqueur', await issue(), 'marqueur-absent');
    await vider();
    H.v('   le marqueur n\'est posé QUE par l\'outil d\'initialisation : aucun autre fichier du lot n\'écrit galerie_meta', (() => {
        const dossier = path.join(__dirname, '..', 'galerie'), out = [];
        (function parcourir(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) parcourir(p); else if (e.name.endsWith('.js') && /col\('galerie_meta'\)\s*\.\s*(insertOne|updateOne|replaceOne|findOneAndUpdate|deleteOne|drop)|collection\('galerie_meta'\)\s*\.\s*(insertOne|updateOne|replaceOne|findOneAndUpdate)/.test(fs.readFileSync(p, 'utf8'))) out.push(path.relative(dossier, p).replace(/\\/g, '/')); } })(dossier);
        return out;
    })(), ['outils/initialiser-base.js']);

    // ═══ 3. R2 : deux buckets déclarés, différents de tous les buckets connus, chacun avec son marqueur ═══
    const c = (x) => R2.lireConfigR2(avec(x));
    H.v('3. configuration à deux buckets : admise, bucket privé et public distincts', [c({}).ok, c({}).c.bucketPrive, c({}).c.bucketPublic], [true, 'rm-galerie-essai-prive', 'rm-galerie-essai-public']);
    const NON = [
        ['bucket privé non déclaré', { V2_GALERIE_R2_BUCKET_PRIVE: undefined }], ['bucket public non déclaré', { V2_GALERIE_R2_BUCKET_PUBLIC: undefined }],
        ['l\'ancienne variable à un seul bucket ne suffit plus', { V2_GALERIE_R2_BUCKET_PRIVE: undefined, V2_GALERIE_R2_BUCKET_PUBLIC: undefined, V2_GALERIE_R2_BUCKET: 'rm-galerie-essai' }],
        ['privé = public', { V2_GALERIE_R2_BUCKET_PUBLIC: 'rm-galerie-essai-prive' }],
        ['privé = R2_BUCKET_IMAGES', { V2_GALERIE_R2_BUCKET_PRIVE: 'rat-market-images' }], ['public = R2_BUCKET_IMAGES', { V2_GALERIE_R2_BUCKET_PUBLIC: 'rat-market-images' }],
        ['public = V2_VISUELS_PROD_BUCKET', { V2_VISUELS_PROD_BUCKET: 'rm-galerie-essai-public' }], ['privé = V2_VISUELS_ESSAI_BUCKET', { V2_VISUELS_ESSAI_BUCKET: 'rm-galerie-essai-prive' }],
        ['public = R2_BUCKET_BANC', { R2_BUCKET_BANC: 'rm-galerie-essai-public' }], ['privé = une variable *BUCKET* inconnue de la liste', { AUTRE_BUCKET_X: 'rm-galerie-essai-prive' }],
        ['adresse publique = l\'hôte public de production (r2.dev des visuels)', { V2_GALERIE_R2_URL_PUBLIQUE: 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev' }],
        ['adresse publique = rat-market.fr', { V2_GALERIE_R2_URL_PUBLIQUE: 'https://rat-market.fr/galerie' }]
    ];
    for (const [nom, x] of NON) H.v(`   NON — ${nom}`, c(x).ok, false);
    H.vrai('   aucune raison ne montre une valeur de variable', NON.every(([, x]) => !/rat-market-images|cle-id-essai|secret-essai/.test(c(x).raison || '')));

    // le VRAI stockage sur un faux client S3 : le routage par bucket, les marqueurs, la copie entre buckets
    const cfgR2 = c({}).c;
    const s3 = A.fauxClientS3(), st = R2.creerStockage(cfgR2, { env: A.ENV_VALIDE, client: s3 });
    await st.ecrire('galerie/depot/ab/cd', Buffer.from('1'), 'image/webp'); await st.ecrire('galerie/attente/x.webp', Buffer.from('2'), 'image/webp'); await st.ecrire('galerie/pub/x.webp', Buffer.from('3'), 'image/webp');
    const buckets = n => s3.envoyees.filter(e => e[0] === 'PutObjectCommand' && e[2] === n)[0][1];
    H.v('3b. depot/ et attente/ vont au bucket PRIVÉ, pub/ au bucket PUBLIC', [buckets('galerie/depot/ab/cd'), buckets('galerie/attente/x.webp'), buckets('galerie/pub/x.webp')], ['rm-galerie-essai-prive', 'rm-galerie-essai-prive', 'rm-galerie-essai-public']);
    const bucketPubX = buckets('galerie/pub/x.webp');
    s3.envoyees.length = 0;
    await st.copier('galerie/attente/x.webp', 'galerie/pub/y.webp');
    H.v('   la copie attente → pub traverse les buckets : lecture au privé, écriture au public, jamais un CopyObject', s3.envoyees.map(e => `${e[0]}:${e[1]}`), ['GetObjectCommand:rm-galerie-essai-prive', 'PutObjectCommand:rm-galerie-essai-public']);
    const lu = new URL(st.presignerDepot({ cle: 'galerie/depot/ab/cd', type: 'image/webp', octets: 5, expire: 300 }));
    H.v('   l\'URL de dépôt vise le bucket privé ; une URL signée de lecture n\'existe que pour le privé (jamais pour pub/)', [lu.pathname.startsWith('/rm-galerie-essai-prive/'), new URL(st.presignerLecture({ cle: 'galerie/attente/x.webp', expire: 3600 })).pathname.startsWith('/rm-galerie-essai-prive/'), (() => { try { st.presignerLecture({ cle: 'galerie/pub/x.webp', expire: 60 }); return 'signe'; } catch { return 'refus'; } })()], [true, true, 'refus']);
    const causeR2 = async (stk) => { try { await stk.verifierMarqueurs(); return 'ok'; } catch (e) { return e instanceof RefusGalerie ? e.cause : `autre:${e && e.name}`; } };
    const vierge = R2.creerStockage(cfgR2, { env: A.ENV_VALIDE, client: A.fauxClientS3() });
    H.v('   sans AUCUN marqueur (ce que serait un bucket de production) : bloqué, cause « marqueur-r2-absent »', await causeR2(vierge), 'marqueur-r2-absent');
    const seulPrive = A.fauxClientS3(); const stP = R2.creerStockage(cfgR2, { env: A.ENV_VALIDE, client: seulPrive });
    seulPrive.objets.set(`rm-galerie-essai-prive/${A.MARQUEURS.prive}`, { corps: Buffer.from(JSON.stringify({ galerie: true, role: 'prive' })), modifie: new Date() });
    H.v('   le marqueur du privé seul : bloqué (le public n\'a pas le sien)', await causeR2(stP), 'marqueur-r2-absent');
    const faux = A.fauxClientS3(); const stF = R2.creerStockage(cfgR2, { env: A.ENV_VALIDE, client: faux });
    faux.objets.set(`rm-galerie-essai-prive/${A.MARQUEURS.prive}`, { corps: Buffer.from(JSON.stringify({ galerie: true, role: 'public' })), modifie: new Date() });
    faux.objets.set(`rm-galerie-essai-public/${A.MARQUEURS.public}`, { corps: Buffer.from(JSON.stringify({ galerie: true, role: 'public' })), modifie: new Date() });
    H.v('   un marqueur qui dit le MAUVAIS rôle (deux buckets intervertis) : bloqué, cause « marqueur-r2-incorrect »', await causeR2(stF), 'marqueur-r2-incorrect');
    const pose = A.fauxClientS3(); const stOk = R2.creerStockage(cfgR2, { env: A.ENV_VALIDE, client: pose });
    const rpose = await initR2.poserMarqueurs(stOk);
    H.v('   l\'outil d\'initialisation R2 pose les DEUX marqueurs, chacun dans son bucket ; ensuite le stockage est admis', [rpose.ok, pose.objets.has(`rm-galerie-essai-prive/${A.MARQUEURS.prive}`), pose.objets.has(`rm-galerie-essai-public/${A.MARQUEURS.public}`), await causeR2(stOk)], [true, true, true, 'ok']);

    // ═══ 4. le montage : la cause nommée, les routes en 503 tant que le marqueur manque ═══
    const express = require('express');
    const monter = require('../galerie/monter');
    const { lireConfig } = require('../config'); const { lireGalerie } = require('../galerie/config');
    const cfg = { ...lireConfig({ MONGODB_BASE: 'test_scratch' }), galerie: lireGalerie(A.ENV_VALIDE) };
    const monte = async (st2, opts = {}) => { await monter.arreter(); const r = express.Router(); monter.routes(r, cfg, { env: A.ENV_VALIDE, stockage: st2, ouvrirBase: () => Gr.ouvrir({ env: A.ENV_VALIDE, creer: creer() }), balayage: false, ...opts }); try { await monter.pret(); return 'branchee'; } catch (e) { return monter.cause(); } };
    await vider();
    H.v('4. le montage sur une base sans marqueur : la base n\'est PAS branchée, la cause est nommée', [await monte(A.fauxStockage()), G.branche()], ['marqueur-absent', false]);
    await init.initialiserBase(dbG());
    const stSansMarqueur = A.fauxStockage(); stSansMarqueur.marqueursPoses = false;
    H.v('   base initialisée mais bucket sans marqueur : PAS branchée, cause « marqueur-r2-absent »', [await monte(stSansMarqueur), G.branche()], ['marqueur-r2-absent', false]);
    H.v('   base et buckets initialisés : branchée', [await monte(A.fauxStockage()), G.branche()], ['branchee', true]);
    await monter.arreter();

    // ═══ 5. MUTANTS sur le code RÉEL : retirer la garde change le verdict ═══
    {
        const m = A.charger('grappe.js', [["if (!declaree) return refus(", "if (false) return refus("], ["if (declaree !== cles[0]) return refus(", "if (false) return refus("]]);
        H.v('5. MUTANT « la grappe déclarée n\'est plus exigée » : sans déclaration, le réel dit NON, le mutant dit OUI', [j({ V2_GALERIE_GRAPPE: undefined }).ok, m.jugerGrappe(avec({ V2_GALERIE_GRAPPE: undefined })).ok], [false, true]);
        await vider();
        const mMarq = A.charger('grappe.js', [["if (!marqueur) throw new RefusGalerie('marqueur-absent'", "if (!marqueur) return; if (false) throw new RefusGalerie('marqueur-absent'"]]);
        const ouvreM = async (g) => { try { await g.ouvrir({ env: A.ENV_VALIDE, creer: creer() }); return 'ouverte'; } catch (e) { return e.cause; } };
        H.v('   MUTANT « le marqueur n\'est plus exigé » : une base vierge est refusée par le réel, OUVERTE par le mutant', [await ouvreM(Gr), await ouvreM(mMarq)], ['marqueur-absent', 'ouverte']);
        await dbG().collection('comptes').insertOne({ x: 1 }); await dbG().collection('galerie_meta').insertOne({ _id: 'marqueur', galerie: true, base: 'rm_galerie_essai' });
        const mColl = A.charger('grappe.js', [["if (inconnues.length) throw new RefusGalerie('collection-inconnue'", "if (false) throw new RefusGalerie('collection-inconnue'"]]);
        H.v('   MUTANT « la liste fermée des collections n\'est plus jugée » : la collection étrangère est refusée par le réel, admise par le mutant', [await ouvreM(Gr), await ouvreM(mColl)], ['collection-inconnue', 'ouverte']);
        await vider();
        const mR2a = A.charger('r2.js', [["if (privee === publique) return refus(", "if (false) return refus("]]);
        H.v('   MUTANT « privé et public peuvent être le même bucket » : le réel dit NON, le mutant OUI', [c({ V2_GALERIE_R2_BUCKET_PUBLIC: 'rm-galerie-essai-prive' }).ok, mR2a.lireConfigR2(avec({ V2_GALERIE_R2_BUCKET_PUBLIC: 'rm-galerie-essai-prive' })).ok], [false, true]);
        const mR2b = A.charger('r2.js', [["if (HOTES_PUBLICS_PRODUCTION.includes(", "if (false && HOTES_PUBLICS_PRODUCTION.includes("]]);
        H.v('   MUTANT « l\'adresse publique n\'est plus comparée à celles de production »', [c({ V2_GALERIE_R2_URL_PUBLIQUE: 'https://rat-market.fr/g' }).ok, mR2b.lireConfigR2(avec({ V2_GALERIE_R2_URL_PUBLIQUE: 'https://rat-market.fr/g' })).ok], [false, true]);
        const mR2c = A.charger('r2.js', [["if (!objet) throw new RefusGalerie('marqueur-r2-absent'", "if (!objet) continue; if (false) throw new RefusGalerie('marqueur-r2-absent'"]]);
        const stM = mR2c.creerStockage(cfgR2, { env: A.ENV_VALIDE, client: A.fauxClientS3() });
        H.v('   MUTANT « le marqueur R2 n\'est plus exigé » : un bucket sans marqueur est refusé par le réel, admis par le mutant', [await causeR2(vierge), await causeR2(stM)], ['marqueur-r2-absent', 'ok']);
        const mR2d = A.charger('r2.js', [["if (cle.startsWith('galerie/pub/')) return 'public';", "if (false) return 'public';"]]);
        const s3m = A.fauxClientS3(); const stR = mR2d.creerStockage(cfgR2, { env: A.ENV_VALIDE, client: s3m });
        await stR.ecrire('galerie/pub/z.webp', Buffer.from('1'), 'image/webp');
        H.v('   MUTANT « pub/ n\'est plus routé vers le bucket public » : l\'écriture publique part au PRIVÉ', [bucketPubX, s3m.envoyees[0][1]], ['rm-galerie-essai-public', 'rm-galerie-essai-prive']);
        const mInit = A.charger('outils/initialiser-base.js', [["if (etrangeres.length) return { ok: false", "if (false) return { ok: false"]]);
        await dbG().collection('comptes').insertOne({ x: 1 });
        H.v('   MUTANT « l\'outil d\'initialisation ne regarde plus les collections » : il marquerait une base de production', [(await init.initialiserBase(dbG())).ok, (await mInit.initialiserBase(dbG())).ok], [false, true]);
        await vider();
    }
    await H.fermerBac();
    H.bilan();
})();
