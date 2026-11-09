'use strict';
// SAUVEGARDES, tour 1 de corrections (après trois relectures) : B sauvegarde vide · C « dernière sauvegarde » vérifiée · D échecs répétés, bail, SIGTERM · E contexte authentifié (aad) · F restauration · G vues écartées.
// Aucun réseau, aucun bucket réel, aucune base réelle : faux client S3 en mémoire, mongod de banc en mémoire.
const H = require('./_harnais');
const { fauxS3, CLE_TEST, AUTRE_CLE } = require('./_aide-sauvegardes');
const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const lever = async (f) => { try { await f(); return null; } catch (e) { return e && (e.code || e.name || 'erreur'); } };
const source = (...bufs) => Readable.from(bufs.map(b => Buffer.from(b)));
const lire = async (r) => { const m = []; for await (const c of r) m.push(Buffer.from(c)); return Buffer.concat(m); };

(async () => {
    const banc = await H.ouvrirBancV2();
    const { MongoClient } = require('mongodb');
    const bson = require('bson');
    const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
    const alea = () => Math.random().toString(36).slice(2, 8);
    const Chiffre = require('../sauvegardes/chiffrement'), Stk = require('../sauvegardes/stockage-r2'), Exp = require('../sauvegardes/export'), Ret = require('../sauvegardes/retention');
    const Plan = require('../sauvegardes/planificateur'), Rest = require('../sauvegardes/restaurer'), Man = require('../sauvegardes/manifeste'), Ch = require('../sauvegardes/chemins');
    const cle = Chiffre.cleDepuisHex(CLE_TEST);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-sauv1-'));
    const neuf = () => { const f = fauxS3(); return { f, st: Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: f.client, partOctets: 4096 }) }; };
    const T0 = new Date('2026-12-01T00:00:00Z');
    const mini = async (nom = `rm_mini_${alea()}`) => { const d = client.db(nom); await d.collection('comptes').insertOne({ _id: 1, n: 1 }); return d; };
    /** Une sauvegarde FABRIQUÉE : un manifeste authentique (chiffré avec la clé) qui dit ce qu'on veut, sans objet de données. */
    const fabriquer = async (st, base, date, collections, cleUtilisee = cle) => {
        const id = Ch.nouvelId(date, crypto.randomBytes(4).toString('hex'));
        const m = { version: 1, id, base, date: date.toISOString(), commit: null, octetsChiffres: 0, collections };
        await st.envoyer(Ch.cleManifeste(base, id), Chiffre.chiffrer(source(JSON.stringify(m)), { cle: cleUtilisee, aad: Ch.aadDe(base, id, 'manifeste.rmsav') }));
        return id;
    };
    const exporter = (st, db, base, date) => Exp.exporterBase({ db, stockage: st, cle, base, commit: 'c', maintenant: date });
    const reste = (f, id) => [...f.objets.keys()].some(k => k.includes(`/${id}/`));

    // ═══ B. une sauvegarde VIDE n'existe pas ═══
    {
        const { f, st } = neuf();
        const vide = client.db(`rm_vide_${alea()}`);
        H.v('B1. une base sans aucune collection : refus « base-vide », aucune commande S3 envoyée', [await lever(() => exporter(st, vide, 'x', T0)), f.journalCmd.length], ['base-vide', 0]);
        const sans = client.db(`rm_sans_${alea()}`); await sans.collection('autre').insertOne({ a: 1 });
        H.v('    `comptes` absente : refus, aucune commande S3 envoyée', [await lever(() => exporter(st, sans, 'x', T0)), f.journalCmd.length], ['collection-exigee-absente', 0]);
        const videC = client.db(`rm_videc_${alea()}`); await videC.createCollection('comptes'); await videC.collection('autre').insertOne({ a: 1 });
        H.v('    `comptes` vide : refus, aucune commande S3 envoyée (pas même une collection avant le contrôle)', [await lever(() => exporter(st, videC, 'x', T0)), f.journalCmd.length], ['collection-exigee-vide', 0]);
        // la rétention : une sauvegarde sans collection (ou sans comptes) n'est JAMAIS vérifiable, ne compte pas parmi les 3 gardées
        const g = neuf(), base = 'rm_ret_b';
        const reelles = [];
        for (const j of [40, 50, 60, 70]) { const d = await mini(); const r = await exporter(g.st, d, base, new Date(+T0 - j * 86400e3)); reelles.push(r.id); await d.dropDatabase(); }
        const videsIds = [];
        for (const j of [1, 2, 3]) videsIds.push(await fabriquer(g.st, base, new Date(+T0 - j * 86400e3), []));
        // deux sauvegardes AUTHENTIQUES et COMPLÈTES (l'objet listé existe, à la taille annoncée) qui ne valent rien : `comptes` vide, et `comptes` absente (une autre collection à la place)
        const avecObjet = async (date, collections) => { const id = await fabriquer(g.st, base, date, collections); g.f.ajouter(`${Ch.dossier(base, id)}c0001.rmsav`, Buffer.alloc(40)); return id; };
        videsIds.push(await avecObjet(new Date(+T0 - 0.5 * 86400e3), [{ nom: 'comptes', objet: 'c0001.rmsav', documents: 0, sha256Clair: 'a'.repeat(64), octetsChiffres: 40, index: [] }]));
        videsIds.push(await avecObjet(new Date(+T0 - 0.4 * 86400e3), [{ nom: 'autre', objet: 'c0001.rmsav', documents: 5, sha256Clair: 'a'.repeat(64), octetsChiffres: 40, index: [] }]));
        const sortie = await Ret.appliquerRetention({ stockage: g.st, cle, base, maintenant: T0 });
        H.v('    la rétention : 4 vraies sauvegardes (40 à 70 j) et 4 « vides » plus récentes : les 3 vraies les plus récentes restent, la 4e (> 30 j) part', reelles.map(id => reste(g.f, id)), [true, true, true, false]);
        H.vrai('    les « vides » ne sont jamais retirées (invérifiables : un humain décide) et ne comptent pas parmi les 3', videsIds.every(id => reste(g.f, id) && sortie.inverifiables.includes(id)) && sortie.gardes.length === 3);
        // trois exports vides de suite ne font perdre aucune vraie sauvegarde
        const h = neuf(); const dbB = client.db(`rm_trois_${alea()}`); await dbB.collection('comptes').insertOne({ _id: 1 });
        const vraie = await exporter(h.st, dbB, dbB.databaseName, new Date(+T0 - 90 * 86400e3));
        await dbB.collection('comptes').deleteMany({});
        const codes = [];
        for (let i = 0; i < 3; i++) { codes.push(await lever(() => exporter(h.st, dbB, dbB.databaseName, new Date(+T0 - (3 - i) * 3600e3)))); await Ret.appliquerRetention({ stockage: h.st, cle, base: dbB.databaseName, maintenant: T0 }); }
        H.vrai('    trois exports vides de suite (comptes vidée) : refusés, et la seule vraie sauvegarde (90 j) reste', codes.every(c => c === 'collection-exigee-vide') && reste(h.f, vraie.id) && [...h.f.objets.keys()].filter(k => k.endsWith('manifeste.rmsav')).length === 1);
        await dbB.dropDatabase();
    }

    // ═══ C. « dernière sauvegarde » : un manifeste réellement déchiffré et vérifié, jamais un nom ═══
    {
        const { f, st } = neuf(); const d = await mini(); const base = d.databaseName;
        const ancienne = await exporter(st, d, base, new Date(+T0 - 30 * 3600e3));
        const maintenant = T0;
        H.v('C1. une sauvegarde valide de 30 h : la dernière', (await Plan.derniereSauvegarde({ stockage: st, cle, base, maintenant })).id, ancienne.id);
        const futureProche = await exporter(st, d, base, new Date(+T0 + 30 * 60e3));
        H.v('    datée 30 min dans le futur (dérive d\'horloge) : admise', (await Plan.derniereSauvegarde({ stockage: st, cle, base, maintenant })).id, futureProche.id);
        const futureLointaine = await exporter(st, d, base, new Date(+T0 + 2 * 3600e3));
        H.v('    datée 2 h dans le futur : IGNORÉE', (await Plan.derniereSauvegarde({ stockage: st, cle, base, maintenant })).id, futureProche.id);
        f.ajouter(Ch.cleManifeste(base, '20261201T000100Z-deadbeef'), 'du bruit qui porte seulement le nom d\'un manifeste récent');
        H.v('    un objet qui n\'a que le NOM d\'un manifeste récent (octets quelconques) : ignoré', (await Plan.derniereSauvegarde({ stockage: st, cle, base, maintenant })).id, futureProche.id);
        const faux = await fabriquer(st, base, new Date(+T0 - 60e3), []);
        H.v('    un manifeste authentique mais sans collection, plus récent : ignoré', (await Plan.derniereSauvegarde({ stockage: st, cle, base, maintenant })).id, futureProche.id);
        const autreCle = await fabriquer(st, base, new Date(+T0 - 30e3), [{ nom: 'comptes', objet: 'c0001.rmsav', documents: 1, sha256Clair: 'b'.repeat(64), octetsChiffres: 99, index: [] }], Chiffre.cleDepuisHex(AUTRE_CLE));
        H.v('    un manifeste chiffré avec une autre clé : ignoré', (await Plan.derniereSauvegarde({ stockage: st, cle, base, maintenant })).id, futureProche.id);
        H.v('    aucune sauvegarde vérifiable : null', await Plan.derniereSauvegarde({ stockage: neuf().st, cle, base, maintenant }), null);
        // le planificateur : un manifeste forgé « récent » n'empêche pas la sauvegarde
        const n2 = neuf(); const d2 = await mini(); const b2 = d2.databaseName; await n2.st.poserMarqueur();
        n2.f.ajouter(Ch.cleManifeste(b2, Ch.nouvelId(new Date(+T0 - 60e3), 'deadbeef')), 'forgé');
        const logs = []; const oe = console.error; console.error = (...a) => logs.push(a.join(' '));
        const r = await Plan.tourSauvegarde({ cfg: { base: b2, cle }, db: d2, stockage: n2.st, commit: 'c', maintenant: () => T0, etatMongo: () => 1 });
        console.error = oe;
        H.v('    le planificateur ne se fie pas au nom : un manifeste forgé « récent » n\'empêche pas la sauvegarde', [r, [...n2.f.objets.keys()].filter(k => k.endsWith('manifeste.rmsav')).length], ['faite', 2]);
        // la restauration sans --id prend la dernière VÉRIFIABLE
        const rest = await Rest.restaurer({ stockage: st, cle, base, id: null, client, nomBase: `rm_essai_restau_${alea()}`, dossierTmp: tmp, maintenant });
        H.v('    restaurer sans id : la dernière vérifiable (pas le dernier nom, ni une future, ni un manifeste vide)', rest.id, futureProche.id);
        await client.db(rest.nomBase).dropDatabase();
        // la liste tronquée
        const t1 = neuf(); t1.f.ajouter(`${Ch.PREFIXE}b/20261201T000000Z-aaaaaaaa/manifeste.rmsav`, 'x'); t1.f.ajouter(`${Ch.PREFIXE}b/20261201T000000Z-aaaaaaaa/c0001.rmsav`, 'x');
        const sj = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: fauxS3({ liste: 'sans-jeton' }).client });
        const inf = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: fauxS3({ liste: 'infinie' }).client });
        H.v('    liste tronquée sans jeton de continuation : lister LÈVE', await lever(() => sj.lister(`${Ch.PREFIXE}b/`)), 'liste-tronquee');
        H.v('    liste qui ne finit pas (plafond de pages) : lister LÈVE', await lever(() => inf.lister(`${Ch.PREFIXE}b/`)), 'liste-tronquee');
        const pag = fauxS3({ pageTaille: 2 }); for (let i = 0; i < 7; i++) pag.ajouter(`${Ch.PREFIXE}p/o${i}`, 'x');
        H.v('    la pagination normale rend les 7 objets', (await Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: pag.client }).lister(`${Ch.PREFIXE}p/`)).length, 7);
        const tr = fauxS3({ liste: 'sans-jeton' }); const strc = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: tr.client, partOctets: 4096 });
        for (const k of ['20200101T000000Z-aaaaaaaa', '20200102T000000Z-bbbbbbbb']) tr.ajouter(`${Ch.PREFIXE}b/${k}/manifeste.rmsav`, 'x');
        H.v('    la rétention sur une liste tronquée : lève et ne retire RIEN', [await lever(() => Ret.appliquerRetention({ stockage: strc, cle, base: 'b', maintenant: T0 })), tr.ops.supprimes], ['liste-tronquee', 0]);
    }

    // ═══ D. échecs répétés : frein exponentiel PERSISTÉ ; bail : perdu seulement sur refus ou TTL ; SIGTERM ═══
    {
        const { f, st } = neuf(); await st.poserMarqueur();
        const nom = `rm_frein_${alea()}`; const db = client.db(nom); await db.collection('comptes').insertOne({ _id: 1 });
        const client2 = new MongoClient(process.env.MONGODB_URI); await client2.connect();
        const logs = []; const oe = console.error; console.error = (...a) => logs.push(a.join(' '));
        let dateCourante = T0; let reussir = false;
        const cfg = { base: nom, cle };
        const tourA = (dbX, t) => { dateCourante = t; return Plan.tourSauvegarde({ cfg, db: dbX, stockage: st, commit: 'c', maintenant: () => t, etatMongo: () => 1, exporter: async () => { if (!reussir) throw Object.assign(new Error(`panne ${nom}`), { code: 'PANNE_INJECTEE' }); } }); };
        const min = 60e3, etat = async () => client.db(nom).collection('sauvegardes_bail').findOne({ _id: 'etat' });
        const fails = [0]; for (const d of [60, 120, 240, 480, 720, 720]) fails.push(fails[fails.length - 1] + d);   // minutes des essais : 0, 60, 180, 420, 900, 1620, 2340
        const resultats = [], echecs = [];
        for (let k = 0; k < fails.length; k++) {
            if (k > 0) resultats.push(await tourA(k % 2 ? client2.db(nom) : db, new Date(+T0 + (fails[k] - 1) * min)));      // une minute avant : le frein tient (une fois sur deux par une AUTRE connexion)
            resultats.push(await tourA(db, new Date(+T0 + fails[k] * min)));
            echecs.push((await etat()).echecs);
        }
        console.error = oe;
        H.v('D1. frein 1, 2, 4, 8, 12, 12 h : une minute avant l\'échéance, « frein » ; à l\'échéance, un nouvel essai', resultats, ['echec', 'frein', 'echec', 'frein', 'echec', 'frein', 'echec', 'frein', 'echec', 'frein', 'echec', 'frein', 'echec']);
        H.v('    le nombre d\'échecs et l\'heure du dernier sont PERSISTÉS en base', [echecs, (await etat()).dernierEchecLe.toISOString()], [[1, 2, 3, 4, 5, 6, 7], new Date(+T0 + fails[6] * min).toISOString()]);
        H.vrai('    chaque échec est journalisé au niveau erreur, sans donnée ni identifiant (ni base, ni message)', logs.filter(l => /sauvegarde échouée \(PANNE_INJECTEE\)/.test(l)).length === 7 && logs.every(l => !l.includes(nom)));
        reussir = true;
        const t8 = new Date(+T0 + (fails[6] + 720) * min);
        const ok = await tourA(db, t8);
        const e8 = await etat();
        H.v('    un succès remet le compteur à zéro et date le dernier succès', [ok, e8.echecs, e8.dernierSuccesLe.toISOString()], ['faite', 0, t8.toISOString()]);
        H.vrai('    l\'état est dans la collection du bail, exclue de l\'export', (await Exp.exporterBase({ db, stockage: neuf().st, cle, base: nom, maintenant: T0 })).manifeste.collections.every(c => c.nom !== 'sauvegardes_bail'));
        await client2.close();

        // le bail : coupure d'une seconde ≠ perte
        const scenario = async (battreScript, avancerMs, sansCb = false) => {
            let t = 1000000, cb = null, mesures = [];
            const faux = { setInterval: (fn) => { cb = fn; return { unref() { } }; }, clearInterval() { }, setTimeout: () => ({ unref() { } }), clearTimeout() { } };
            let i = 0; const bailFaux = () => ({ prendre: async () => true, liberer: async () => true, battre: async () => { const r = battreScript[Math.min(i++, battreScript.length - 1)]; if (r === 'coupure') throw new Error('coupure réseau'); return r; } });
            const n = neuf(); await n.st.poserMarqueur(); const d = await mini(); const b = d.databaseName;
            const ex = async ({ battement }) => { mesures.push(await battement()); for (const a of avancerMs) { t += a; if (!sansCb) await cb(); mesures.push(await battement()); } };
            await Plan.tourSauvegarde({ cfg: { base: b, cle }, db: d, stockage: n.st, maintenant: () => T0, etatMongo: () => 1, exporter: ex, minuteurs: faux, creerBailFn: bailFaux, horloge: () => t, retention: async () => { } });
            return mesures;
        };
        H.v('D2. un battement qui échoue sur une coupure d\'une seconde : le bail n\'est PAS perdu', await scenario(['coupure', true], [1000, 30000]), [true, true, true]);
        H.v('    des coupures sans fin : perdu seulement une fois le TTL (90 s) dépassé', await scenario(['coupure'], [30000, 30000, 31000]), [true, true, true, false]);
        H.v('    un refus explicite (un autre détient le bail) : perdu aussitôt', await scenario([false], [1000]), [true, false]);
        H.v('    même sans battement exécuté, un silence de plus que le TTL rend perdu', await scenario([true], [100000], true), [true, false]);

        // SIGTERM : l'export est marqué perdu, l'abandon multipart se fait, puis le processus sort (143)
        const s = neuf(); await s.st.poserMarqueur();
        const proc = new EventEmitter(); const sorties = [];
        const sig = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: s.f.client, partOctets: 4096 });
        const origine = s.f.client.send; let emis = false;
        s.f.client.send = async (c) => { if (c.constructor.name === 'UploadPartCommand' && !emis) { emis = true; proc.emit('SIGTERM'); } return origine(c); };
        const dsig = client.db(`rm_sigterm_${alea()}`); await dsig.collection('comptes').insertMany(Array.from({ length: 3000 }, (_, i) => ({ _id: i, v: crypto.randomBytes(30).toString('hex') })));
        console.error = () => { };
        const rs = await Plan.tourSauvegarde({ cfg: { base: dsig.databaseName, cle }, db: dsig, stockage: sig, maintenant: () => T0, etatMongo: () => 1, processus: proc, quitter: c => sorties.push(c) });
        console.error = oe;
        H.v('D3. SIGTERM pendant un envoi : « arret », le processus sort en 143 après l\'abandon', [rs, sorties], ['arret', [143]]);
        H.vrai('    l\'abandon du téléversement s\'est fait (AbortMultipartUpload), rien n\'est ouvert, aucun manifeste', s.f.journalCmd.some(c => c.nom === 'AbortMultipartUploadCommand') && s.f.televersements.size === 0 && ![...s.f.objets.keys()].some(k => k.endsWith('manifeste.rmsav')));
        H.vrai('    l\'écouteur SIGTERM est retiré, ce n\'est pas compté comme un échec, le bail est libéré', proc.listenerCount('SIGTERM') === 0 && !(await dsig.collection('sauvegardes_bail').findOne({ _id: 'etat' })) && (await dsig.collection('sauvegardes_bail').findOne({ _id: 'export' })).detenteur === null);
        // les orphelines sont retirées aussi après un échec
        const o = neuf(); await o.st.poserMarqueur(); const dor = await mini(); const bor = dor.databaseName;
        const idOrph = Ch.nouvelId(new Date(+T0 - 3 * 3600e3), 'cafecafe');
        o.f.ajouter(`${Ch.PREFIXE}${bor}/${idOrph}/c0001.rmsav`, 'orpheline'); o.f.ajouter(`${Ch.PREFIXE}${bor}/${idOrph}/c0002.rmsav`, 'orpheline');
        console.error = () => { };
        const ro = await Plan.tourSauvegarde({ cfg: { base: bor, cle }, db: dor, stockage: o.st, maintenant: () => T0, etatMongo: () => 1, exporter: async () => { throw Object.assign(new Error('x'), { code: 'PANNE' }); } });
        console.error = oe;
        H.v('D4. après un échec, les orphelines (sans manifeste, de plus d\'une heure) sont retirées', [ro, reste(o.f, idOrph)], ['echec', false]);
        // une erreur inattendue (ici : la base coupe pendant la prise du bail) ne lève jamais : le service ne meurt pas
        console.error = () => { };
        const rp = await lever(() => Plan.tourSauvegarde({ cfg: { base: bor, cle }, db: dor, stockage: o.st, maintenant: () => T0, etatMongo: () => 1, creerBailFn: () => ({ prendre: async () => { throw new Error('mongo coupé'); }, liberer: async () => true }) }));
        const rq = await Plan.tourSauvegarde({ cfg: { base: bor, cle }, db: dor, stockage: o.st, maintenant: () => new Date(+T0 + 1000 * 86400e3), etatMongo: () => 1, creerBailFn: () => ({ prendre: async () => { throw new Error('mongo coupé'); }, liberer: async () => true }) });
        console.error = oe;
        H.v('D5. une erreur inattendue pendant le tour (prise du bail impossible) : le tour ne lève pas, il rend « echec »', [rp, rq], [null, 'echec']);
    }

    // ═══ E. le contexte authentifié (aad) : pas d'échange d'objets, pas de rejeu sous un autre identifiant ═══
    {
        H.vrai('E0. l\'aad dépend de la base, de l\'identifiant ET de l\'objet', (() => { const a = Ch.aadDe('b', 'i1', 'o'); return !a.equals(Ch.aadDe('b', 'i2', 'o')) && !a.equals(Ch.aadDe('b', 'i1', 'p')) && !a.equals(Ch.aadDe('c', 'i1', 'o')); })());
        const { f, st } = neuf(); const d = client.db(`rm_aad_${alea()}`); const base = d.databaseName;
        await d.collection('comptes').insertMany([{ _id: 1, a: 1 }, { _id: 2, a: 2 }]); await d.collection('deuxieme').insertMany([{ _id: 1, a: 'x' }, { _id: 2, a: 'y' }, { _id: 3, a: 'z' }]);
        const A = await exporter(st, d, base, new Date(+T0 - 5 * 3600e3)), B = await exporter(st, d, base, new Date(+T0 - 3600e3));
        const cleDe = (id, n) => `${Ch.PREFIXE}${base}/${id}/c000${n}.rmsav`;
        const vers = `rm_essai_restau_${alea()}`;
        const sortie = async (id) => { const c = await lever(() => Rest.restaurer({ stockage: st, cle, base, id, client, nomBase: vers, dossierTmp: tmp })); const dbs = (await client.db().admin().listDatabases({ nameOnly: true })).databases.map(x => x.name); return [c, dbs.includes(vers)]; };
        // rejeu : l'objet c0001 de A placé sous l'identifiant de B (même base, même nom d'objet, même contenu clair)
        const origB = f.objets.get(cleDe(B.id, 1)).corps; f.objets.get(cleDe(B.id, 1)).corps = f.objets.get(cleDe(A.id, 1)).corps;
        H.v('E1. rejeu d\'un objet d\'une autre sauvegarde (c0001 de A sous l\'identifiant de B) : refus d\'étiquette, aucune base créée', await sortie(B.id), ['etiquette-refusee', false]);
        f.objets.get(cleDe(B.id, 1)).corps = origB;
        // échange : c0001 et c0002 de A permutés
        const a1 = f.objets.get(cleDe(A.id, 1)).corps, a2 = f.objets.get(cleDe(A.id, 2)).corps;
        f.objets.get(cleDe(A.id, 1)).corps = a2; f.objets.get(cleDe(A.id, 2)).corps = a1;
        H.v('E2. échange de deux objets c0001 / c0002 : refus d\'étiquette, aucune base créée', await sortie(A.id), ['etiquette-refusee', false]);
        f.objets.get(cleDe(A.id, 1)).corps = a1; f.objets.get(cleDe(A.id, 2)).corps = a2;
        H.v('    (contrôle) les objets remis en place, la même restauration réussit', (await lever(() => Rest.restaurer({ stockage: st, cle, base, id: A.id, client, nomBase: vers, dossierTmp: tmp }))), null);
        await client.db(vers).dropDatabase(); await d.dropDatabase();
    }

    // ═══ F. restauration ═══
    {
        const env = { MONGODB_URI: 'mongodb+srv://u1:p1@cluster0.abcde.mongodb.net/prod?retryWrites=true', MONGODB_CARTES_URI: 'mongodb+srv://u2:p2@cluster1.fghij.mongodb.net/cartes' };
        const g = (uri) => lever(() => Rest.verifierGrappeRestauration(uri, env));
        H.v('F1. grappe de restauration : refusée si égale à MONGODB_URI, à la grappe de MONGODB_URI sous un autre compte ou un hôte de shard, à celle de MONGODB_CARTES_URI, illisible ou absente',
            [await g(env.MONGODB_URI), await g('mongodb+srv://autre:mdp@cluster0.abcde.mongodb.net/x'), await g('mongodb://autre:mdp@cluster0-shard-00-00.abcde.mongodb.net:27017/x'), await g(env.MONGODB_CARTES_URI), await g('pas une uri'), await g(undefined)],
            ['grappe-refusee', 'grappe-refusee', 'grappe-refusee', 'grappe-refusee', 'grappe-refusee', 'grappe-refusee']);
        H.v('    une autre grappe (jetable) est admise', await g('mongodb+srv://u:p@essai.zzzzz.mongodb.net/'), null);
        H.v('    sans MONGODB_URI connue : une URI lisible est admise (rien à comparer), une illisible reste refusée', [await lever(() => Rest.verifierGrappeRestauration('mongodb://127.0.0.1:27017/', {})), await lever(() => Rest.verifierGrappeRestauration('x', {}))], [null, 'grappe-refusee']);

        const nomF = `rm_srcf_${alea()}`, srcF = client.db(nomF);
        const { Double, Decimal128, Int32, Long, Binary, ObjectId } = bson;
        await srcF.collection('comptes').insertMany([{ _id: 1, c: 'a' }, { _id: 2, c: 'b' }]);
        await srcF.collection('types').insertOne({ _id: new ObjectId('64b7f0c2a1b2c3d4e5f60718'), d: new Date(0), d2: new Date('2026-11-09T07:48:48.123Z'), dec: Decimal128.fromString('1.234567890123456789'), negz: new Double(-0), nan: new Double(NaN), inf: new Double(-Infinity), i32: new Int32(7), l: Long.fromString('9007199254740993'), bin: new Binary(Buffer.from([0, 1, 2, 255])), imbrique: { liste: [new Double(1), new Int32(1), null, 'é'] } });
        await srcF.createCollection('ttlvalid');
        await srcF.collection('ttlvalid').insertMany([{ _id: 1, d: new Date('2001-01-01') }, { _id: 2, x: 1, d: new Date() }]);
        await srcF.collection('ttlvalid').createIndex({ d: 1 }, { name: 'ttl_d', expireAfterSeconds: 2e9 });
        await srcF.collection('ttlvalid').createIndex({ x: 1 }, { name: 'x_partiel', unique: true, partialFilterExpression: { x: { $exists: true } } });
        await srcF.command({ collMod: 'ttlvalid', validator: { x: { $exists: true } }, validationLevel: 'strict', validationAction: 'error' });   // le document 1 est INVALIDE sous ce validateur
        await srcF.createCollection('vue', { viewOn: 'comptes', pipeline: [] });
        let serie = true; try { await srcF.createCollection('serie', { timeseries: { timeField: 't' } }); } catch { serie = false; }
        const { f, st } = neuf();
        const exp = await exporter(st, srcF, nomF, T0);
        H.v('G1. les vues et séries temporelles écartées sont LISTÉES dans le manifeste (pas exportées, pas ignorées en silence)', exp.manifeste.ecartees, [{ nom: 'vue', type: 'view' }, ...(serie ? [{ nom: 'serie', type: 'timeseries' }] : [])].sort((a, b) => (a.nom < b.nom ? -1 : 1)));
        H.v('    et les collections exportées', exp.manifeste.collections.map(c => c.nom), ['comptes', 'ttlvalid', 'types']);
        // ordre des opérations
        const evts = [];
        const emballerCol = (c, nom) => new Proxy(c, { get(t, p) { const v = t[p]; if (['insertMany', 'createIndexes', 'find'].includes(p)) return (...a) => { evts.push(`${p}:${nom}${p === 'createIndexes' ? ':' + a[0].map(x => x.name).join(',') : ''}`); return v.apply(t, a); }; return typeof v === 'function' ? v.bind(t) : v; } });
        const emballerDb = (d) => new Proxy(d, { get(t, p) { const v = t[p]; if (p === 'collection') return (n) => emballerCol(t.collection(n), n); if (p === 'command') return async (c, ...r) => { evts.push(`cmd:${Object.keys(c)[0]}:${c.collMod || ''}`); return t.command(c, ...r); }; return typeof v === 'function' ? v.bind(t) : v; } });
        const clientEmb = { db: (n) => emballerDb(client.db(n)) };
        const vers = `rm_essai_restau_${alea()}`;
        const r = await Rest.restaurer({ stockage: st, cle, base: nomF, id: exp.id, client: clientEmb, nomBase: vers, dossierTmp: tmp });
        const idx = (m) => evts.findIndex(e => e.startsWith(m)), dernier = (m) => evts.map((e, i) => (e.startsWith(m) ? i : -1)).filter(i => i >= 0).pop();
        H.vrai('F2. restauration complète : 3 collections identiques (comptes, empreintes, spécifications d\'index, options)', r.collections.length === 3 && r.collections.every(c => c.identique && c.indexIdentiques && c.optionsIdentiques));
        H.vrai('    le validateur (document 1 invalide sous le validateur) n\'a pas empêché les insertions, et il est posé ensuite', evts.some(e => e === 'cmd:collMod:ttlvalid') && idx('cmd:collMod') > dernier('insertMany') && idx('cmd:collMod') > idx('find:ttlvalid'));
        H.vrai('    l\'index TTL est posé APRÈS les insertions et APRÈS la relecture ; les autres index AVANT la relecture', idx('createIndexes:ttlvalid:ttl_d') > dernier('insertMany') && idx('createIndexes:ttlvalid:ttl_d') > idx('find:ttlvalid') && idx('createIndexes:ttlvalid:x_partiel') < idx('find:ttlvalid'));
        const dest = client.db(vers);
        const ttl = (await dest.collection('ttlvalid').indexes()).find(i => i.name === 'ttl_d');
        H.vrai('    le TTL et l\'index unique partiel sont restaurés avec leurs options, le validateur aussi', ttl && ttl.expireAfterSeconds === 2e9 && (await dest.collection('ttlvalid').indexes()).find(i => i.name === 'x_partiel').unique === true && (await dest.listCollections({ name: 'ttlvalid' }).toArray())[0].options.validator.x.$exists === true);
        const o = await dest.collection('types').findOne({}, { promoteValues: false, promoteLongs: false });
        H.vrai('    types BSON : Date, ObjectId, Decimal128, -0, NaN, -Infinity, Int32, Long, Binary, imbriqué — identiques, à la valeur près',
            o._id.toHexString() === '64b7f0c2a1b2c3d4e5f60718' && +o.d === 0 && o.d2.toISOString() === '2026-11-09T07:48:48.123Z' && o.dec.toString() === '1.234567890123456789' && Object.is(o.negz.value, -0) && Number.isNaN(o.nan.value) && o.inf.value === -Infinity
            && o.i32 instanceof Int32 && o.l.toString() === '9007199254740993' && Buffer.from(o.bin.buffer).equals(Buffer.from([0, 1, 2, 255])) && o.imbrique.liste[0] instanceof Double && o.imbrique.liste[1] instanceof Int32 && o.imbrique.liste[2] === null && o.imbrique.liste[3] === 'é');
        H.vrai('    le compte rendu dit de lancer la réconciliation après une restauration, et ce script existe', r.aFaire.some(m => m.includes('v2/argent/reconcilier.js')) && Rest.MESSAGE_RECONCILIER.includes('instantané') && fs.existsSync(path.join(__dirname, '..', 'argent', 'reconcilier.js')));
        await dest.dropDatabase();
        // la spécification d'index : les OPTIONS comptent, pas seulement le nom
        const S = Rest.specIndex;
        H.vrai('    specIndex distingue deux index de même nom et de même clé aux options différentes (unique, TTL)', S({ name: 'a', key: { a: 1 }, unique: true }) !== S({ name: 'a', key: { a: 1 } }) && S({ name: 'a', key: { a: 1 }, expireAfterSeconds: 5 }) !== S({ name: 'a', key: { a: 1 }, expireAfterSeconds: 6 }));
        H.vrai('    … ignore v, ns et l\'ordre des propriétés, mais PAS l\'ordre des champs de la clé', S({ v: 2, name: 'a', key: { a: 1, b: -1 }, ns: 'x.y' }) === S({ key: { a: 1, b: -1 }, name: 'a' }) && S({ name: 'a', key: { a: 1, b: -1 } }) !== S({ name: 'a', key: { b: -1, a: 1 } }));
        // échec après la première écriture : la base créée par cette exécution est supprimée
        const m0 = JSON.parse((await Chiffre.dechiffrerVersBuffer(await st.lire(Ch.cleManifeste(nomF, exp.id)), { cle, aad: Ch.aadDe(nomF, exp.id, 'manifeste.rmsav') })).toString('utf8'));
        const garde = f.objets.get(Ch.cleManifeste(nomF, exp.id)).corps;
        m0.collections[2].index = [{ key: { c: 1 }, name: 'mauvais', partialFilterExpression: 5 }];       // une spécification que MongoDB refusera, APRÈS l'insertion des documents
        f.objets.get(Ch.cleManifeste(nomF, exp.id)).corps = await lire(Chiffre.chiffrer(source(JSON.stringify(m0)), { cle, aad: Ch.aadDe(nomF, exp.id, 'manifeste.rmsav') }));
        const vers2 = `rm_essai_restau_${alea()}`;
        const c2 = await lever(() => Rest.restaurer({ stockage: st, cle, base: nomF, id: exp.id, client, nomBase: vers2, dossierTmp: tmp }));
        const apres = (await client.db().admin().listDatabases({ nameOnly: true })).databases.map(x => x.name);
        H.vrai('F3. un échec après la première écriture : refus et la base que cette exécution venait de créer est SUPPRIMÉE', c2 !== null && !apres.includes(vers2));
        f.objets.get(Ch.cleManifeste(nomF, exp.id)).corps = garde;
        // une base déjà peuplée n'est jamais supprimée par un refus
        const pre = `rm_essai_restau_${alea()}`; await client.db(pre).collection('autre').insertOne({ _id: 1 });
        const c3 = await lever(() => Rest.restaurer({ stockage: st, cle, base: nomF, id: exp.id, client, nomBase: pre, dossierTmp: tmp }));
        H.v('    une base déjà peuplée : refus « base-non-vide », et elle reste intacte (jamais supprimée)', [c3, await client.db(pre).collection('autre').countDocuments()], ['base-non-vide', 1]);
        await client.db(pre).dropDatabase(); await srcF.dropDatabase();
        // le client S3 réel (jamais appelé : aucun réseau) : réglages mémoire mesurés
        const reel = Stk.creerClient({ endpoint: 'https://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com', cleId: 'id-essai', secret: 'secret-essai', bucket: 'rm-prive-essai' });
        H.v('M1. le client réel : sommes de contrôle du SDK à la demande (réglage mesuré), partie de 5 Mio (le minimum de R2)', [await reel.config.requestChecksumCalculation(), Stk.PART_OCTETS], ['WHEN_REQUIRED', 5 * 1024 * 1024]);
    }

    await client.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    await banc.arreter();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
