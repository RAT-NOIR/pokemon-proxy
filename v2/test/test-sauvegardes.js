'use strict';
// SAUVEGARDES (critère n° 10 de la liste de lancement) — export chiffré quotidien vers un bucket R2 PRIVÉ, restauration vérifiée, rétention.
// Aucun réseau, aucun bucket réel, aucune base réelle : faux client S3 en mémoire, base de banc (mongod en mémoire, hôte de loopback).
const H = require('./_harnais');
const { fauxS3, CLE_TEST, AUTRE_CLE, ENV_VALIDE } = require('./_aide-sauvegardes');
const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
const { Readable } = require('stream');
const lire = async (r) => { const m = []; for await (const c of r) m.push(Buffer.from(c)); return Buffer.concat(m); };
const source = (...bufs) => Readable.from(bufs.map(b => Buffer.from(b)));
const lever = async (f) => { try { await f(); return null; } catch (e) { return e && (e.code || e.name || 'erreur'); } };

(async () => {
    const banc = await H.ouvrirBancV2();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const alea = () => Math.random().toString(36).slice(2, 8);
    const Chiffre = require('../sauvegardes/chiffrement');
    const Cfg = require('../sauvegardes/config');
    const Stk = require('../sauvegardes/stockage-r2');
    const Exp = require('../sauvegardes/export');
    const Bail = require('../sauvegardes/bail');
    const Ret = require('../sauvegardes/retention');
    const Plan = require('../sauvegardes/planificateur');
    const Rest = require('../sauvegardes/restaurer');
    const { PREFIXE } = require('../sauvegardes/chemins');
    const cle = Chiffre.cleDepuisHex(CLE_TEST), autreCle = Chiffre.cleDepuisHex(AUTRE_CLE);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-sauv-'));

    // ═══ 1. chiffrement AES-256-GCM, en flux, étiquette vérifiée AVANT toute utilisation ═══
    {
        const clair = crypto.randomBytes(300000), aad = Buffer.from('rmsav1|b|i|c0001.rmsav');
        const chiffre = await lire(Chiffre.chiffrer(Readable.from([clair.subarray(0, 100000), clair.subarray(100000)]), { cle, aad }));
        H.vrai('1. le chiffré n\'est pas le clair, et contient l\'en-tête, le nonce et l\'étiquette (clair + 7 + 12 + 16 octets)', !chiffre.includes(clair.subarray(0, 64)) && chiffre.length === clair.length + 7 + 12 + 16);
        const f = path.join(tmp, 'a.bin');
        await Chiffre.dechiffrerVersFichier(source(chiffre), f, { cle, aad });
        H.vrai('   aller-retour exact', fs.readFileSync(f).equals(clair));
        const chiffre2 = await lire(Chiffre.chiffrer(source(clair), { cle, aad }));
        H.vrai('   le nonce est aléatoire : deux chiffrements du même clair diffèrent', !chiffre.equals(chiffre2));
        const refus = async (nom, octets, c = cle, a = aad) => {
            const g = path.join(tmp, `r-${nom}.bin`);
            const code = await lever(() => Chiffre.dechiffrerVersFichier(source(octets), g, { cle: c, aad: a }));
            return [code, fs.existsSync(g)];
        };
        H.v('   clé fausse : refus, AUCUN fichier de données laissé', await refus('cle', chiffre, autreCle), ['etiquette-refusee', false]);
        const milieu = Buffer.from(chiffre); milieu[150000] ^= 1;
        H.v('   un octet modifié au milieu : refus, aucun fichier', await refus('milieu', milieu), ['etiquette-refusee', false]);
        const fin = Buffer.from(chiffre); fin[fin.length - 1] ^= 1;
        H.v('   l\'étiquette modifiée : refus, aucun fichier', await refus('tag', fin), ['etiquette-refusee', false]);
        H.v('   un autre contexte (aad) : refus — un objet ne se fait pas passer pour un autre', await refus('aad', chiffre, cle, Buffer.from('rmsav1|b|i|c0002.rmsav')), ['etiquette-refusee', false]);
        H.v('   un objet tronqué : refus', await refus('tronque', chiffre.subarray(0, chiffre.length - 40)), ['etiquette-refusee', false]);
        H.v('   un objet qui n\'a pas l\'en-tête : refus', await refus('magie', Buffer.concat([Buffer.from('XXXXXXX'), chiffre.subarray(7)])), ['format-inconnu', false]);
        const codes = []; for (const k of ['ab', 'z'.repeat(64), '', undefined, '00'.repeat(32), 'ff'.repeat(32), 'a1'.repeat(32), '0123456789ABCDEF'.repeat(4)]) codes.push(await lever(() => Chiffre.cleDepuisHex(k)));
        H.v('   (codes) 4 refusées ; un seul octet répété (00…, ff…, a1a1…) refusé ; la majuscule hexadécimale variée est acceptée', codes, ['cle-invalide', 'cle-invalide', 'cle-invalide', 'cle-invalide', 'cle-invalide', 'cle-invalide', 'cle-invalide', null]);
        const b = await Chiffre.dechiffrerVersBuffer(source(chiffre), { cle, aad, max: 1e6 });
        H.vrai('   dechiffrerVersBuffer rend le clair', b.equals(clair));
        H.v('   dechiffrerVersBuffer refuse un clair plus grand que max', await lever(() => Chiffre.dechiffrerVersBuffer(source(chiffre), { cle, aad, max: 1000 })), 'trop-grand');
    }

    // ═══ 2. configuration : fermée par défaut, la garde du bucket écrite par ce qu'elle AUTORISE ═══
    {
        const ok = Cfg.lireConfigSauvegardes(ENV_VALIDE);
        H.vrai('2. toutes les variables, un bucket privé : la configuration est valide', ok.ok === true && ok.c.base === 'rm_essai' && ok.c.bucket === 'rm-prive-essai');
        H.vrai('   la clé est de 32 octets, jamais rendue en clair par la configuration sérialisée', ok.c.cle.length === 32 && !JSON.stringify(ok.c).includes(CLE_TEST) && !JSON.stringify(ok.c).includes('secret-essai-0001'));
        const vide = Cfg.lireConfigSauvegardes({});
        H.vrai('   aucune variable : éteinte, sans bruit (vide: true)', vide.ok === false && vide.vide === true);
        for (const nom of Object.keys(ENV_VALIDE)) {
            const e = { ...ENV_VALIDE }; delete e[nom];
            const r = Cfg.lireConfigSauvegardes(e);
            H.vrai(`   ${nom} absente : fermée, la raison la NOMME et ne porte aucune valeur`, r.ok === false && !r.vide && r.raison.includes(nom) && !Object.values(ENV_VALIDE).some(v => v.length > 8 && r.raison.includes(v)));
        }
        const avec = (c) => Cfg.lireConfigSauvegardes({ ...ENV_VALIDE, ...c });
        H.vrai('   clé mal formée : fermée', avec({ V2_SAUVEGARDE_CLE: 'abc' }).ok === false);
        H.vrai('   le bucket du site public (R2_BUCKET_IMAGES) est REFUSÉ', avec({ R2_BUCKET_IMAGES: 'rm-prive-essai' }).ok === false);
        H.vrai('   le bucket public de la galerie est REFUSÉ', avec({ V2_GALERIE_R2_BUCKET_PUBLIC: 'rm-prive-essai' }).ok === false);
        H.vrai('   un bucket nommé par une variable *BUCKET* inconnue est REFUSÉ (on ne devine pas son accès)', avec({ AUTRE_BUCKET_INCONNU: 'rm-prive-essai' }).ok === false);
        H.vrai('   les buckets privés NOMMÉS (archive des visuels, brut, galerie privée) sont admis', ['V2_VISUELS_R2_BUCKET', 'R2_BUCKET_BRUT', 'V2_GALERIE_R2_BUCKET_PRIVE'].every(n => avec({ [n]: 'rm-prive-essai' }).ok === true));
        H.vrai('   une adresse publique déclarée (V2_SAUVEGARDE_R2_URL_PUBLIQUE) : refusée', avec({ V2_SAUVEGARDE_R2_URL_PUBLIQUE: 'https://x.example' }).ok === false);
        for (const ep of ['https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev', 'http://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com', 'https://rat-market.fr', 'https://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com.evil.example', 'https://u:p@abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com'])
            H.vrai(`   endpoint refusé : ${ep.replace(/\/\/.*@/, '//***@')}`, avec({ V2_SAUVEGARDE_R2_ENDPOINT: ep }).ok === false);
        H.vrai('   endpoint de la juridiction UE (*.eu.r2.cloudflarestorage.com) : admis', avec({ V2_SAUVEGARDE_R2_ENDPOINT: 'https://abcdef0123456789abcdef0123456789.eu.r2.cloudflarestorage.com' }).ok === true);
        H.vrai('   nom de bucket mal formé : refusé', avec({ V2_SAUVEGARDE_R2_BUCKET: 'Mauvais/Nom' }).ok === false);
        H.vrai('   nom de base mal formé : refusé', avec({ V2_SAUVEGARDE_BASE: 'a b' }).ok === false);
    }

    // ═══ 3. stockage R2 : préfixe imposé, multipart en flux, abandon propre, opérations comptées ═══
    {
        const f = fauxS3();
        const st = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: f.client, partOctets: 1000 });
        const grosse = crypto.randomBytes(3500);
        const r = await st.envoyer(`${PREFIXE}x/gros.rmsav`, Readable.from([grosse.subarray(0, 1700), grosse.subarray(1700)]));
        H.vrai('3. un envoi de 3 500 octets en parties de 1 000 : 4 parties, objet identique', f.objets.get(`${PREFIXE}x/gros.rmsav`).corps.equals(grosse) && r.octets === 3500 && f.journalCmd.filter(c => c.nom === 'UploadPartCommand').length === 4);
        H.vrai('   jamais plus d\'une partie en mémoire côté envoi (le plus gros morceau ≤ la partie)', f.plusGrosMorceau() <= 1000);
        const petit = Buffer.from('petit');
        await st.envoyer(`${PREFIXE}x/petit.rmsav`, source(petit));
        H.vrai('   un petit objet part en un seul PutObject', f.objets.get(`${PREFIXE}x/petit.rmsav`).corps.equals(petit) && f.journalCmd.filter(c => c.cle === `${PREFIXE}x/petit.rmsav`).map(c => c.nom).join() === 'PutObjectCommand');
        H.v('   ce qui est écrit va dans le bucket nommé', [...new Set(f.journalCmd.map(c => c.bucket))], ['rm-prive-essai']);
        H.v('   une clé hors du préfixe : écriture refusée (envoyer)', await lever(() => st.envoyer('galerie/x', source('a'))), 'cle-hors-prefixe');
        H.v('   une clé hors du préfixe : suppression refusée', await lever(() => st.supprimer('banc-seau/x')), 'cle-hors-prefixe');
        H.v('   une clé qui remonte (..) : refusée', await lever(() => st.supprimer(`${PREFIXE}../galerie/x`)), 'cle-hors-prefixe');
        H.v('   une lecture hors préfixe : refusée aussi', await lever(() => st.tete('autre/x')), 'cle-hors-prefixe');
        const g = fauxS3({ echecApresOctets: 1500 });
        const st2 = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: g.client, partOctets: 1000 });
        H.vrai('   un envoi coupé au milieu échoue (jamais en silence)', (await lever(() => st2.envoyer(`${PREFIXE}x/coupe.rmsav`, Readable.from([grosse])))) !== null);
        H.vrai('   et laisse ni objet ni téléversement ouvert (AbortMultipartUpload)', !g.objets.has(`${PREFIXE}x/coupe.rmsav`) && g.televersements.size === 0 && g.journalCmd.some(c => c.nom === 'AbortMultipartUploadCommand'));
        H.vrai('   les opérations sont comptées par classe (A : écriture et liste, B : lecture)', (() => { const o = st.operations(); return o.A === f.ops.A && o.B === f.ops.B && o.A > 0; })());
        H.v('   un objet absent : tete rend null, lire refuse', [await st.tete(`${PREFIXE}x/absent`), await lever(() => st.lire(`${PREFIXE}x/absent`))], [null, 'objet-absent']);
        const m = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: fauxS3().client });
        H.v('   le marqueur du bucket est exigé avant la première écriture : absent => refus', await lever(() => m.verifierMarqueur()), 'marqueur-absent');
        await m.poserMarqueur(); await m.verifierMarqueur();
        H.vrai('   posé par l\'outil, il est reconnu', true);
    }

    // ═══ 4. export : tout ce que la base contient, chiffré, manifeste écrit EN DERNIER ═══
    const nomSrc = `rm_src_${alea()}`, src = client.db(nomSrc);
    const SECRET_CLAIR = 'courriel-secret-à-ne-jamais-voir-en-clair@exemple.test';
    await src.collection('comptes').insertMany(Array.from({ length: 1200 }, (_, i) => ({ _id: `c${i}`, courriel: i === 7 ? SECRET_CLAIR : `u${i}@x.test`, n: i, d: new Date(1e12 + i), grand: crypto.randomBytes(40).toString('hex') })));
    await src.collection('comptes').createIndex({ courriel: 1 }, { unique: true, name: 'courriel_1' });
    await src.collection('evenements').insertMany([{ a: 1 }, { a: 2 }, { a: 3 }]);
    await src.collection('evenements').createIndex({ a: 1 }, { name: 'a_ttl', expireAfterSeconds: 3600 });
    for (const k of ['z', 'a', 'm']) await src.collection('desordre').insertOne({ _id: k, ordre: 'inséré dans un autre ordre que celui des _id', entier: 5, decimal: new (require('bson').Double)(5), long: BigInt(2) ** 40n });
    await src.createCollection('vide');
    await src.createCollection('vue_comptes', { viewOn: 'comptes', pipeline: [] });
    await src.collection('sauvegardes_bail').insertOne({ _id: 'export', detenteur: null, expireLe: new Date(0) });
    const f4 = fauxS3(), st4 = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: f4.client, partOctets: 4096 });
    const t0 = new Date('2026-11-09T23:30:00Z');
    const rEx = await Exp.exporterBase({ db: src, stockage: st4, cle, base: nomSrc, commit: 'abcdef123456', maintenant: t0 });
    const manif = rEx.manifeste;
    H.v('4. le manifeste liste TOUTES les collections réelles (vides comprises, vue et bail exclus)', manif.collections.map(c => c.nom).sort(), ['comptes', 'desordre', 'evenements', 'vide']);
    H.v('   comptes : documents', manif.collections.find(c => c.nom === 'comptes').documents, 1200);
    H.v('   vide : zéro document, empreinte de l\'ensemble vide', [manif.collections.find(c => c.nom === 'vide').documents, manif.collections.find(c => c.nom === 'vide').sha256Clair], [0, crypto.createHash('sha256').digest('hex')]);
    H.vrai('   le manifeste porte la date, le commit, la taille chiffrée et la base', manif.date === t0.toISOString() && manif.commit === 'abcdef123456' && manif.octetsChiffres > 0 && manif.base === nomSrc);
    H.vrai('   les index sont sauvegardés (courriel unique, TTL)', manif.collections.find(c => c.nom === 'comptes').index.some(i => i.name === 'courriel_1' && i.unique === true) && manif.collections.find(c => c.nom === 'evenements').index.some(i => i.name === 'a_ttl' && i.expireAfterSeconds === 3600));
    const cles4 = [...f4.objets.keys()];
    H.vrai('   tout est sous le préfixe dédié et le dossier de la sauvegarde', cles4.every(k => k.startsWith(`${PREFIXE}${nomSrc}/${rEx.id}/`)));
    H.v('   l\'ordre d\'écriture : le manifeste vient en DERNIER', f4.journalCmd.filter(c => ['PutObjectCommand', 'CompleteMultipartUploadCommand'].includes(c.nom)).map(c => c.cle).pop(), `${PREFIXE}${nomSrc}/${rEx.id}/manifeste.rmsav`);
    H.vrai('   aucun octet stocké ne contient une donnée en clair (courriel, nom de collection, nom de base, champ)', [...f4.objets.values()].every(o => !o.corps.includes(Buffer.from(SECRET_CLAIR)) && !o.corps.includes(Buffer.from('comptes')) && !o.corps.includes(Buffer.from('courriel')) && !o.corps.includes(Buffer.from(nomSrc))));
    H.vrai('   le manifeste est chiffré : sans la clé, rien n\'est lisible', !f4.objets.get(`${PREFIXE}${nomSrc}/${rEx.id}/manifeste.rmsav`).corps.includes(Buffer.from('"collections"')));
    H.vrai('   l\'envoi se fait en flux : jamais plus d\'une partie (4 096 octets) en un morceau', f4.plusGrosMorceau() <= 4096);
    // collection NEUVE, sans changer le code
    const neuve = `zz_neuve_${alea()}`;
    await src.collection(neuve).insertMany([{ _id: 1, v: 'x' }, { _id: 2, v: 'y' }]);
    const rEx2 = await Exp.exporterBase({ db: src, stockage: st4, cle, base: nomSrc, commit: 'abcdef123456', maintenant: new Date(t0.getTime() + 1000) });
    H.vrai('   une collection créée après coup est prise sans toucher au code', rEx2.manifeste.collections.some(c => c.nom === neuve && c.documents === 2));
    // empreinte déterministe : même contenu => même empreinte, contenu changé => autre empreinte
    const emp1 = await Exp.empreinteCollection(src.collection('evenements'));
    await src.collection('evenements').updateOne({ a: 3 }, { $set: { a: 4 } });
    const emp2 = await Exp.empreinteCollection(src.collection('evenements'));
    H.vrai('   l\'empreinte change quand un document change (et pas le nombre)', emp1.documents === emp2.documents && emp1.sha256 !== emp2.sha256);
    await src.collection('evenements').updateOne({ a: 4 }, { $set: { a: 3 } });
    // la même donnée insérée dans un AUTRE ordre donne la même empreinte (lecture triée par _id) : deux exports du même contenu se comparent
    for (const k of ['a', 'm', 'z']) await src.collection('desordre2').insertOne({ _id: k, ordre: 'inséré dans un autre ordre que celui des _id', entier: 5, decimal: new (require('bson').Double)(5), long: BigInt(2) ** 40n });
    H.v('   la même donnée insérée dans un autre ordre : même empreinte (l\'empreinte ne dépend pas de l\'ordre physique)', (await Exp.empreinteCollection(src.collection('desordre2'))).sha256, (await Exp.empreinteCollection(src.collection('desordre'))).sha256);
    await src.collection('desordre2').drop();

    // ═══ 5. envoi coupé en cours d'export : pas de manifeste, donc pas une sauvegarde ; la précédente reste comptée ═══
    {
        const f = fauxS3(), st = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: f.client, partOctets: 4096 });
        const avant = await Exp.exporterBase({ db: src, stockage: st, cle, base: nomSrc, commit: 'c1', maintenant: new Date('2026-11-08T23:30:00Z') });
        const octetsAvant = [...f.objets.values()].reduce((n, o) => n + o.corps.length, 0);
        f.client.send = ((orig) => async (c) => { if (c.constructor.name === 'UploadPartCommand' && f.journalCmd.filter(x => x.nom === 'UploadPartCommand').length >= 3) throw Object.assign(new Error('coupure'), { name: 'ErreurReseauInjectee' }); return orig(c); })(f.client.send);
        const code = await lever(() => Exp.exporterBase({ db: src, stockage: st, cle, base: nomSrc, commit: 'c2', maintenant: new Date('2026-11-09T23:30:00Z') }));
        H.vrai('5. un envoi coupé au milieu : l\'export échoue', code !== null);
        const cles = [...f.objets.keys()];
        H.v('   aucun manifeste n\'est écrit pour la sauvegarde coupée (une seule sauvegarde complète)', cles.filter(k => k.endsWith('/manifeste.rmsav')).length, 1);
        const derniere = await Plan.derniereSauvegarde({ stockage: st, cle, base: nomSrc, maintenant: new Date('2026-11-10T00:00:00Z') });
        H.v('   la précédente reste la dernière sauvegarde RÉUSSIE', derniere && derniere.id, avant.id);
        H.vrai('   aucun téléversement n\'est resté ouvert', f.televersements.size === 0);
        H.vrai('   (contrôle) rien n\'a été écrit avant la panne qui change la précédente', [...f.objets.entries()].filter(([k]) => k.includes(`/${avant.id}/`)).reduce((n, [, o]) => n + o.corps.length, 0) === octetsAvant);
    }

    // ═══ 6. le bail : une seule instance exporte, expiration sur le rythme du battement, libération par son détenteur seul ═══
    {
        const col = src.collection(`bail_test_${alea()}`);
        let t = new Date('2026-11-09T23:00:00Z');
        const horloge = () => t;
        const A = Bail.creerBail({ col, ttlMs: 90000, maintenant: horloge }), B = Bail.creerBail({ col, ttlMs: 90000, maintenant: horloge });
        const [a, b] = await Promise.all([A.prendre(), B.prendre()]);
        H.v('6. deux instances qui prennent en même temps : une seule l\'obtient', [a, b].filter(Boolean).length, 1);
        const detenteur = a ? A : B, autre = a ? B : A;
        H.vrai('   l\'autre ne peut pas libérer le bail du détenteur (ni le battre)', (await autre.liberer()) === false && (await autre.battre()) === false && (await detenteur.battre()) === true);
        H.vrai('   toujours tenu par le détenteur après la tentative de l\'autre', (await autre.prendre()) === false);
        t = new Date(t.getTime() + 60000);
        await detenteur.battre();
        t = new Date(t.getTime() + 60000);
        H.vrai('   un battement repousse l\'expiration (120 s après la prise, toujours tenu)', (await autre.prendre()) === false);
        t = new Date(t.getTime() + 100000);
        H.vrai('   sans battement pendant plus du TTL, le bail expire : l\'autre le prend', (await autre.prendre()) === true);
        H.vrai('   l\'ancien détenteur a perdu : son battement est refusé (il doit s\'arrêter)', (await detenteur.battre()) === false);
        H.vrai('   et sa libération ne retire rien à l\'autre', (await detenteur.liberer()) === false && (await detenteur.prendre()) === false);
        H.vrai('   le détenteur libère : le bail redevient prenable', (await autre.liberer()) === true && (await detenteur.prendre()) === true);
    }

    // ═══ 7. le planificateur : l'âge de la dernière sauvegarde RÉUSSIE, le bail, l'échec jamais silencieux ═══
    {
        const logs = []; const orig = console.error; console.error = (...a) => { logs.push(a.join(' ')); };
        const f = fauxS3(), st = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: f.client, partOctets: 4096 });
        await st.poserMarqueur();
        const colBail = src.collection('sauvegardes_bail');
        const dep = (t, extra = {}) => ({ cfg: { base: nomSrc, cle }, db: src, stockage: st, commit: 'abc123456789', maintenant: () => t, etatMongo: () => 1, colBail, ...extra });
        const compter = () => [...f.objets.keys()].filter(k => k.endsWith('/manifeste.rmsav')).length;
        H.v('7. aucune sauvegarde : on en lance une', [await Plan.tourSauvegarde(dep(new Date('2026-11-09T10:00:00Z'))), compter()], ['faite', 1]);
        H.v('   la dernière a moins de 23 h : on n\'en lance pas', [await Plan.tourSauvegarde(dep(new Date('2026-11-10T08:59:00Z'))), compter()], ['recente', 1]);
        H.v('   à partir de 23 h : on en lance une', [await Plan.tourSauvegarde(dep(new Date('2026-11-10T09:01:00Z'))), compter()], ['faite', 2]);
        H.v('   Mongo pas prêt : rien, sans bruit', [await Plan.tourSauvegarde(dep(new Date('2026-11-12T00:00:00Z'), { etatMongo: () => 0 })), compter()], ['mongo-pas-pret', 2]);
        H.v('   la base connectée n\'est pas celle de la configuration : refus nommé, rien n\'est exporté', [await Plan.tourSauvegarde(dep(new Date('2026-11-12T00:00:00Z'), { cfg: { base: 'autre_base', cle } })), compter()], ['base-differente', 2]);
        const occupant = Bail.creerBail({ col: colBail, ttlMs: 90000, maintenant: () => new Date('2026-11-12T00:00:00Z') });
        await occupant.prendre();
        H.v('   le bail est tenu par une autre instance : elle attend, ne meurt pas, n\'exporte pas', [await Plan.tourSauvegarde(dep(new Date('2026-11-12T00:00:30Z'))), compter()], ['occupe', 2]);
        await occupant.liberer();
        const [r1, r2] = await Promise.all([Plan.tourSauvegarde(dep(new Date('2026-11-12T01:00:00Z'))), Plan.tourSauvegarde(dep(new Date('2026-11-12T01:00:00Z')))]);
        H.v('   deux instances en même temps : UNE sauvegarde (une « faite », l\'autre attend ou voit la sienne)', [[r1, r2].filter(x => x === 'faite').length, [r1, r2].every(x => ['faite', 'occupe', 'recente'].includes(x)), compter()], [1, true, 3]);
        const g = fauxS3(), st2 = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: g.client, partOctets: 4096 });
        await st2.poserMarqueur();
        g.client.send = ((o) => async (c) => { if (c.constructor.name === 'UploadPartCommand' || (c.constructor.name === 'PutObjectCommand' && String(c.input.Key).includes('/c0'))) throw Object.assign(new Error(`coupure ${SECRET_CLAIR}`), { name: 'ErreurReseauInjectee' }); return o(c); })(g.client.send);
        logs.length = 0;
        const sortie = await Plan.tourSauvegarde({ ...dep(new Date('2026-11-13T00:00:00Z')), stockage: st2 });
        console.error = orig;
        H.v('   un échec ne lève jamais (le service ne meurt pas) : il rend « echec »', sortie, 'echec');
        H.vrai('   et il est JOURNALISÉ au niveau erreur, sans donnée ni identifiant (ni courriel, ni nom de collection, ni nom de base)', logs.length >= 1 && logs.every(l => !l.includes(SECRET_CLAIR) && !l.includes('comptes') && !l.includes(nomSrc)) && logs.some(l => /sauvegardes/.test(l)));
        H.vrai('   le bail est libéré après un échec (la reprise de l\'heure suivante peut le prendre)', (await Bail.creerBail({ col: colBail, ttlMs: 90000, maintenant: () => new Date('2026-11-13T00:00:01Z') }).prendre()) === true);
        H.v('   le marqueur absent : l\'export n\'écrit rien et le dit', await (async () => { const h = fauxS3(), s3 = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: h.client }); const o = console.error; console.error = () => {}; const r = await Plan.tourSauvegarde({ ...dep(new Date('2026-11-14T00:00:00Z')), stockage: s3 }); console.error = o; return [r, h.objets.size]; })(), ['echec', 0]);
        // le bail perdu en cours d'export arrête l'export
        const h = fauxS3(), st3 = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: h.client, partOctets: 4096 });
        const code = await lever(() => Exp.exporterBase({ db: src, stockage: st3, cle, base: nomSrc, commit: 'c', maintenant: new Date(), battement: async () => false }));
        H.vrai('   un export dont le bail est perdu s\'arrête (rien de complet n\'est écrit)', code === 'bail-perdu' && ![...h.objets.keys()].some(k => k.endsWith('/manifeste.rmsav')));
    }

    // ═══ 8. rétention : 30 jours, au moins les 3 dernières sauvegardes complètes ET vérifiables, rien hors préfixe ═══
    {
        const base = 'rm_ret';
        const maintenant = new Date('2026-11-09T12:00:00Z');
        const ids = {};
        const f = fauxS3(), st = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: f.client, partOctets: 4096 });
        const poser = async (jours, { sansManifeste = false, mauvaiseCle = false, heures = 0 } = {}) => {
            const t = new Date(maintenant.getTime() - jours * 86400e3 - heures * 3600e3);
            const dbMin = client.db(`rm_ret_${alea()}`); await dbMin.collection('comptes').insertOne({ _id: 1 });
            const r = await Exp.exporterBase({ db: dbMin, stockage: st, cle: mauvaiseCle ? autreCle : cle, base, commit: 'x', maintenant: t });
            if (sansManifeste) await st.supprimer(`${PREFIXE}${base}/${r.id}/manifeste.rmsav`);
            // l'objet est « vieux » : sa date de modification est celle de la sauvegarde
            for (const [k, o] of f.objets) if (k.includes(`/${r.id}/`)) o.modifie = t;
            await dbMin.dropDatabase();
            return r.id;
        };
        for (const j of [1, 10, 20, 40, 50]) ids[j] = await poser(j);
        ids.orpheline = await poser(5, { sansManifeste: true });
        ids.recenteIncomplete = await poser(0, { sansManifeste: true, heures: 1 });
        ids.mauvaise = await poser(45, { mauvaiseCle: true });
        f.ajouter('galerie/depot/a', 'x', new Date('2020-01-01')); f.ajouter(`${PREFIXE}marqueur-prive.json`, '{}', new Date('2020-01-01')); f.ajouter(`${PREFIXE}${base}/intrus.txt`, 'x', new Date('2020-01-01')); f.ajouter(`${PREFIXE}${base}/20200101T000000Z-deadbeef/bizarre`, 'x', new Date('2020-01-01'));
        const sortie = await Ret.appliquerRetention({ stockage: st, cle, base, maintenant });
        const reste = (id) => [...f.objets.keys()].some(k => k.includes(`/${id}/`));
        H.v('8. 5 complètes (1, 10, 20, 40, 50 jours) : les 3 plus récentes restent', [1, 10, 20].map(j => reste(ids[j])), [true, true, true]);
        H.v('   celles de plus de 30 jours au-delà des 3 sont retirées (manifeste compris)', [40, 50].map(j => reste(ids[j])), [false, false]);
        H.vrai('   l\'orpheline (sans manifeste, 5 jours) est retirée ; la récente (1 heure, un envoi peut être en cours) reste', !reste(ids.orpheline) && reste(ids.recenteIncomplete));
        H.vrai('   un manifeste illisible avec cette clé (autre clé) : jamais retiré, jamais compté parmi les 3', reste(ids.mauvaise) && sortie.inverifiables.includes(ids.mauvaise));
        H.vrai('   aucun objet hors préfixe, ni sans la forme de ce mécanisme (marqueur, intrus, dossier au nom étranger), n\'est touché', f.objets.has('galerie/depot/a') && f.objets.has(`${PREFIXE}marqueur-prive.json`) && f.objets.has(`${PREFIXE}${base}/intrus.txt`) && f.objets.has(`${PREFIXE}${base}/20200101T000000Z-deadbeef/bizarre`));
        H.vrai('   les commandes de suppression ne visent que le préfixe', f.journalCmd.filter(c => c.nom === 'DeleteObjectCommand').every(c => c.cle.startsWith(PREFIXE)));
        // toutes vieilles : on garde les 3 dernières complètes, même vieilles
        const f2 = fauxS3(), st2 = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: f2.client, partOctets: 4096 });
        const ids2 = [];
        for (const j of [40, 50, 60, 70]) { const t = new Date(maintenant.getTime() - j * 86400e3); const d = client.db(`rm_ret_${alea()}`); await d.collection('comptes').insertOne({ _id: 1 }); const r = await Exp.exporterBase({ db: d, stockage: st2, cle, base, commit: 'x', maintenant: t }); for (const [k, o] of f2.objets) if (k.includes(`/${r.id}/`)) o.modifie = t; ids2.push(r.id); await d.dropDatabase(); }
        await Ret.appliquerRetention({ stockage: st2, cle, base, maintenant });
        const reste2 = (id) => [...f2.objets.keys()].some(k => k.includes(`/${id}/`));
        H.v('   toutes plus vieilles que 30 jours : les 3 plus récentes restent quand même', ids2.map(reste2), [true, true, true, false]);
        const f3 = fauxS3(), st3 = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: f3.client, partOctets: 4096 });
        const d3 = client.db(`rm_ret_${alea()}`); await d3.collection('comptes').insertOne({ _id: 1 });
        const seule = await Exp.exporterBase({ db: d3, stockage: st3, cle, base, commit: 'x', maintenant: new Date(maintenant.getTime() - 90 * 86400e3) });
        for (const o of f3.objets.values()) o.modifie = new Date(maintenant.getTime() - 90 * 86400e3);
        await Ret.appliquerRetention({ stockage: st3, cle, base, maintenant }); await d3.dropDatabase();
        H.vrai('   une seule sauvegarde, vieille de 90 jours : elle reste (il en reste toujours une)', [...f3.objets.keys()].some(k => k.includes(`/${seule.id}/`)));
        // une sauvegarde dont un objet manque n'est pas vérifiable : elle ne compte pas parmi les 3
        const f4b = fauxS3(), st4b = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: f4b.client, partOctets: 4096 });
        const idsB = [];
        for (const j of [1, 2, 3, 4]) { const t = new Date(maintenant.getTime() - (j + 35) * 86400e3); const d = client.db(`rm_ret_${alea()}`); await d.collection('comptes').insertOne({ _id: 1 }); const r = await Exp.exporterBase({ db: d, stockage: st4b, cle, base, commit: 'x', maintenant: t }); for (const [k, o] of f4b.objets) if (k.includes(`/${r.id}/`)) o.modifie = t; idsB.push(r.id); await d.dropDatabase(); }
        const casse = [...f4b.objets.keys()].find(k => k.includes(`/${idsB[0]}/`) && !k.endsWith('manifeste.rmsav')); f4b.objets.delete(casse);
        const sB = await Ret.appliquerRetention({ stockage: st4b, cle, base, maintenant });
        const resteB = (id) => [...f4b.objets.keys()].some(k => k.includes(`/${id}/`));
        H.vrai('   une sauvegarde à laquelle il manque un objet n\'est pas vérifiable : elle ne compte pas, et n\'est pas retirée', sB.inverifiables.includes(idsB[0]) && resteB(idsB[0]));
        H.v('   les 3 suivantes (vérifiables) sont gardées', idsB.slice(1).map(resteB), [true, true, true]);
    }

    // ═══ 9. restauration : base jetable seulement, étiquette vérifiée avant toute écriture, comparaison au manifeste ═══
    {
        const noms = ['rm_essai', 'test', 'cartes', 'test_scratch', 'rm_essai_restau', 'RM_ESSAI_RESTAU_x', 'xrm_essai_restau_a', 'rm_essai_restau_a/b', 'rm_essai_restau_a.b', 'rm_essai_restau_', 'rm_essai_restau_a b', '', 'admin', 'local', 'config', 'rm_essai_restau_' + 'a'.repeat(60)];
        const codes = []; for (const n of noms) codes.push(await lever(() => Rest.verifierNomBaseRestauration(n)));
        H.v('9. la garde du nom : tout ce qui ne commence pas par rm_essai_restau_ est refusé (rm_essai, test, cartes, test_scratch, admin…)', codes, noms.map(() => 'base-refusee'));
        H.v('   nom permis : rm_essai_restau_20261109 et rm_essai_restau_x1', [await lever(() => Rest.verifierNomBaseRestauration('rm_essai_restau_20261109')), await lever(() => Rest.verifierNomBaseRestauration('rm_essai_restau_x1'))], [null, null]);
        H.v('   un nom non texte : refusé', [await lever(() => Rest.verifierNomBaseRestauration(null)), await lever(() => Rest.verifierNomBaseRestauration(42)), await lever(() => Rest.verifierNomBaseRestauration({ toString: () => 'rm_essai_restau_a' }))], ['base-refusee', 'base-refusee', 'base-refusee']);

        const f = fauxS3(), st = Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: f.client, partOctets: 4096 });
        const exp = await Exp.exporterBase({ db: src, stockage: st, cle, base: nomSrc, commit: 'rest', maintenant: new Date('2026-11-09T23:30:00Z') });
        const nomRest = `rm_essai_restau_${alea()}`;
        const sortie = await Rest.restaurer({ stockage: st, cle, base: nomSrc, id: exp.id, client, nomBase: nomRest, dossierTmp: tmp });
        const dest = client.db(nomRest);
        const attendues = exp.manifeste.collections.map(c => c.nom).sort();
        H.v('   restaurée : les mêmes collections', (await dest.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).sort(), attendues);
        const comp = [];
        for (const c of exp.manifeste.collections) { const e = await Exp.empreinteCollection(dest.collection(c.nom)); comp.push([c.nom, e.documents === c.documents, e.sha256 === c.sha256Clair]); }
        H.vrai('   comptes ET empreintes identiques au manifeste, collection par collection', comp.length === attendues.length && comp.every(x => x[1] && x[2]));
        const idxDest = (await dest.collection('comptes').indexes()).map(i => `${i.name}:${JSON.stringify(i.key)}:${i.unique === true}`).sort();
        const idxSrc = (await src.collection('comptes').indexes()).map(i => `${i.name}:${JSON.stringify(i.key)}:${i.unique === true}`).sort();
        H.v('   les index sont recréés (courriel unique)', idxDest, idxSrc);
        H.vrai('   le TTL est recréé', (await dest.collection('evenements').indexes()).some(i => i.name === 'a_ttl' && i.expireAfterSeconds === 3600));
        H.vrai('   la restauration rend le compte rendu par collection', Array.isArray(sortie.collections) && sortie.collections.length === attendues.length && sortie.collections.every(c => c.documents >= 0));
        H.v('   restaurer dans une base déjà peuplée : refusé', await lever(() => Rest.restaurer({ stockage: st, cle, base: nomSrc, id: exp.id, client, nomBase: nomRest, dossierTmp: tmp })), 'base-non-vide');
        for (const n of ['rm_essai', 'test', 'cartes', 'test_scratch']) {
            const avant = (await client.db().admin().listDatabases()).databases.map(d => d.name).sort().join();
            const code = await lever(() => Rest.restaurer({ stockage: st, cle, base: nomSrc, id: exp.id, client, nomBase: n, dossierTmp: tmp }));
            const apres = (await client.db().admin().listDatabases()).databases.map(d => d.name).sort().join();
            H.vrai(`   la restauration vers « ${n} » est refusée AVANT toute écriture`, code === 'base-refusee' && avant === apres);
        }
        // un octet modifié dans une collection : refus, rien d'inséré
        const nomCorrompu = `rm_essai_restau_${alea()}`;
        const cleObjet = [...f.objets.keys()].find(k => /\/c0001\.rmsav$/.test(k));
        const corps = Buffer.from(f.objets.get(cleObjet).corps); corps[Math.floor(corps.length / 2)] ^= 1; const orig = f.objets.get(cleObjet).corps; f.objets.get(cleObjet).corps = corps;
        const codeC = await lever(() => Rest.restaurer({ stockage: st, cle, base: nomSrc, id: exp.id, client, nomBase: nomCorrompu, dossierTmp: tmp }));
        const apresC = (await client.db(nomCorrompu).listCollections({}, { nameOnly: true }).toArray()).length;
        H.v('   un octet modifié dans l\'objet d\'une collection : refus, et la base jetable ne contient rien', [codeC, apresC], ['etiquette-refusee', 0]);
        f.objets.get(cleObjet).corps = orig;
        const codeK = await lever(() => Rest.restaurer({ stockage: st, cle: autreCle, base: nomSrc, id: exp.id, client, nomBase: `rm_essai_restau_${alea()}`, dossierTmp: tmp }));
        H.v('   une clé fausse : refus au manifeste, aucune donnée', codeK, 'etiquette-refusee');
        const manifCle = `${PREFIXE}${nomSrc}/${exp.id}/manifeste.rmsav`; const mo = f.objets.get(manifCle); const sauve = mo.corps; mo.corps = Buffer.from(sauve); mo.corps[30] ^= 1;
        H.v('   un manifeste modifié : refus', await lever(() => Rest.restaurer({ stockage: st, cle, base: nomSrc, id: exp.id, client, nomBase: `rm_essai_restau_${alea()}`, dossierTmp: tmp })), 'etiquette-refusee');
        mo.corps = sauve;
        // un manifeste AUTHENTIQUE mais qui ne dit pas ce que les objets contiennent (une erreur de l'export, jamais une attaque) : refusé avant d'écrire
        const clairManif = JSON.parse((await Chiffre.dechiffrerVersBuffer(source(sauve), { cle, aad: Buffer.from(`rmsav1|${nomSrc}|${exp.id}|manifeste.rmsav`) })).toString('utf8'));
        clairManif.collections[0].sha256Clair = 'f'.repeat(64);
        mo.corps = await lire(Chiffre.chiffrer(source(JSON.stringify(clairManif)), { cle, aad: Buffer.from(`rmsav1|${nomSrc}|${exp.id}|manifeste.rmsav`) }));
        const nomDiff = `rm_essai_restau_${alea()}`;
        H.v('   un manifeste authentique dont l\'empreinte ne correspond pas aux objets : refus AVANT toute écriture', [await lever(() => Rest.restaurer({ stockage: st, cle, base: nomSrc, id: exp.id, client, nomBase: nomDiff, dossierTmp: tmp })), (await client.db(nomDiff).listCollections({}, { nameOnly: true }).toArray()).length], ['contenu-different-du-manifeste', 0]);
        mo.corps = sauve;
        H.v('   une sauvegarde sans manifeste n\'existe pas : refus nommé', await lever(() => Rest.restaurer({ stockage: st, cle, base: nomSrc, id: '20200101T000000Z-deadbeef', client, nomBase: `rm_essai_restau_${alea()}`, dossierTmp: tmp })), 'sauvegarde-introuvable');
        H.vrai('   aucun fichier temporaire de données ne reste dans le dossier de travail', fs.readdirSync(tmp).filter(n => /^rmsav-/.test(n)).length === 0);
        await client.db(nomRest).dropDatabase();
    }

    // ═══ 10. le montage : éteint sauf configuration complète, sans route, sans effet de bord à l'import ═══
    {
        const Monter = require('../sauvegardes/monter'), Plan2 = require('../sauvegardes/planificateur');
        const logs = []; const oe = console.error, ol = console.log; console.error = (...a) => logs.push(a.join(' ')); console.log = () => { };
        const posees = [];
        const faux = { setTimeout: (f, ms) => { posees.push(['t', ms]); return { unref() { } }; }, setInterval: (f, ms) => { posees.push(['i', ms]); return { unref() { } }; }, clearTimeout() { }, clearInterval() { } };
        const routeur = { use() { throw new Error('aucune route attendue'); }, get() { throw new Error('aucune route attendue'); }, post() { throw new Error('aucune route attendue'); } };
        Monter.routes(routeur, {}, { env: {}, minuteurs: faux });
        const e1 = [Monter.etat(), posees.length, logs.length];
        const incomplet = { ...ENV_VALIDE }; delete incomplet.V2_SAUVEGARDE_CLE;
        Monter.routes(routeur, {}, { env: incomplet, minuteurs: faux });
        const e2 = [Monter.etat(), posees.length, logs.length, logs[0] && logs[0].includes('V2_SAUVEGARDE_CLE') && !logs[0].includes('secret-essai-0001')];
        Monter.routes(routeur, {}, { env: ENV_VALIDE, minuteurs: faux, stockageSauvegardes: Stk.creerStockageR2({ bucket: 'rm-prive-essai' }, { client: fauxS3().client }), mongoose: { connection: { readyState: 0, db: null } } });
        const e3 = [Monter.etat(), posees.map(p => p.join(':')).join(',')];
        Monter.arreter(); const e4 = Monter.etat();
        console.error = oe; console.log = ol;
        H.v('10. sans variable : éteint, aucun minuteur, aucune ligne', e1, ['eteint', 0, 0]);
        H.v('    configuration incomplète : refusée, aucun minuteur, UNE ligne qui nomme la variable (jamais une valeur)', e2, ['refuse', 0, 1, true]);
        H.v('    configuration complète : armé, un différé de 2 min et un intervalle d\'une heure, aucune route', e3, ['actif', `t:${Plan2.DIFFERE_MS},i:${Plan2.INTERVALLE_MS}`]);
        H.v('    arrêté : éteint', e4, 'eteint');
        H.vrai('    le montage est dans la liste des lots de v2/index.js', fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8').includes("require('./sauvegardes/monter')"));
    }

    await client.db(nomSrc).dropDatabase();
    await client.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    await banc.arreter();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
