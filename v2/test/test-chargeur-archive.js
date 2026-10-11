'use strict';
// COTES-VISUELS, tour 2 — l'ARCHIVE telle que l'API la reçoit : plafonds (la bombe gzip de la revue I1), scellement HMAC avant toute décompression, validation de CHAQUE entrée (I3), objet R2 privé lu
// avec un FAUX client (I8) : variables fermées par défaut, taille annoncée et lue, délai. Aucun réseau, aucun bucket réel.
const zlib = require('zlib'); const { Readable } = require('stream');
const H = require('./_harnais');
const F = require('../chargeur/format'); const S = require('../chargeur/scellement'); const R2 = require('../chargeur/r2-prive'); const I = require('../chargeur');
const E = require('../chargeur/etat'); const VB = require('./_visuels-banc');

const SECRET = 'secret-hmac-de-banc-0123456789-abcdefghij';       // 42 caractères
const CM = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles';
const entrees = n => Array.from({ length: n }, (_, i) => VB.doc(7000 + i, { numero: String(i + 1), rarete: 'Rare', lien: `${CM}/Base-Set/P${i}-BS${i + 1}`, idMetacard: 880 + (i % 3) }));
const gzDe = async (v, entree = null) => F.compresser(F.serialiser(v, { entree }));
const attendre = ms => new Promise(r => setTimeout(r, ms));
const refus = async (fn) => { try { await fn(); return null; } catch (e) { return e.name === 'FormatInvalide' ? e.motif : `AUTRE:${e.name}:${e.message}`; } };

(async () => {
    const v = VB.construire(entrees(40), [['Set-A', '1|001', [7000]], ['Set-A', '2|002', [7001, 7002]]]);
    const gz = await gzDe(v, { sets: 1, cartes: 40, produits: 40, catalogue: 40 });

    // ── 1. LES PLAFONDS (I1 : une archive minuscule ne fait pas tomber l'instance en boucle)
    H.v('plafonds écrits : archive 16 Mo compressée, 48 Mo décompressée (l\'archive réelle : 2,8 et 11 Mo)', [F.PLAFONDS.archive, F.PLAFONDS.decompresse], [16 * 1048576, 48 * 1048576]);
    // la sonde de la revue : ~255 Ko de gzip qui s'ouvrent en 250 Mo
    const zeros = await new Promise((ok, ko) => { const g = zlib.createGzip(); const m = []; g.on('data', d => m.push(d)); g.on('end', () => ok(Buffer.concat(m))); g.on('error', ko); for (let i = 0; i < 250; i++) g.write(Buffer.alloc(1048576)); g.end(); });
    H.vrai(`la sonde : ${(zeros.length / 1024).toFixed(0)} Ko compressés pour 250 Mo décompressés`, zeros.length < 400 * 1024);
    const avant = process.memoryUsage().rss;
    const m1 = await refus(() => F.decompresser(zeros));
    const apres = process.memoryUsage().rss;
    H.v('   décompression PAR DÉFAUT : refus nommé (plafond décompressé), échec de chargement — pas un redémarrage', /plus grande que la taille permise/.test(m1 || ''), true);
    H.vrai(`   ... sans que la mémoire du processus monte au-delà du plafond (+${((apres - avant) / 1048576).toFixed(0)} Mo, borne 150 Mo ; sans plafond : +250 Mo)`, apres - avant < 150 * 1048576);
    const m1b = await refus(() => F.decompresser(zeros, {}));
    H.v('   ... et AUCUN réglage appelant ne la rend permissive par défaut (options vides)', /plus grande/.test(m1b || ''), true);
    const trop = Buffer.alloc(16 * 1048576 + 1, 7);
    H.v('archive compressée de 16 Mo + 1 octet : refusée AVANT d\'ouvrir (la mention « compressée »)', /compressée/.test(await refus(() => F.decompresser(trop)) || ''), true);
    H.v('   un tampon de 16 Mo pile n\'est pas refusé pour sa taille (refusé comme gzip illisible)', /gzip illisible/.test(await refus(() => F.decompresser(Buffer.alloc(16 * 1048576, 7))) || ''), true);
    const g = await I.executerDepuisFichier({ lireFichier: async () => S.sceller(zeros, SECRET), secret: SECRET })();
    H.v('   par le chargeur : échec de chargement journalisable, ancienne version intacte (raison nommée)', [g.ok, /plus grande que la taille permise/.test(g.raison || '')], [false, true]);

    // ── 2. LE SCELLEMENT : un HMAC faux n'ouvre rien, vérifié AVANT la décompression
    const scelle = S.sceller(gz, SECRET);
    H.v('archive scellée : s\'ouvre avec le bon secret', S.ouvrir(scelle, SECRET).equals(gz), true);
    H.v('   un autre secret : refusé, motif « HMAC faux »', /HMAC faux/.test(await refus(() => S.ouvrir(scelle, SECRET.replace('a', 'b'))) || ''), true);
    H.v('   un octet de l\'archive retourné : refusé', /HMAC faux/.test(await refus(() => { const b = Buffer.from(scelle); b[10] ^= 1; S.ouvrir(b, SECRET); }) || ''), true);
    H.v('   un octet de la balise retourné : refusé', /HMAC faux/.test(await refus(() => { const b = Buffer.from(scelle); b[b.length - 1] ^= 1; S.ouvrir(b, SECRET); }) || ''), true);
    H.v('   magie fausse, trop court, secret absent ou trop court : refusés', [await refus(() => S.ouvrir(Buffer.concat([Buffer.from('XXXX'), scelle.subarray(4)]), SECRET)), await refus(() => S.ouvrir(Buffer.alloc(10), SECRET)), await refus(() => S.ouvrir(scelle, undefined)), await refus(() => S.ouvrir(scelle, 'court'))].map(x => typeof x === 'string' && !x.startsWith('AUTRE')), [true, true, true, true]);
    // le HMAC est jugé AVANT la décompression : un faux HMAC sur un gzip ILLISIBLE donne « HMAC faux », jamais « gzip illisible »
    const faux = Buffer.concat([Buffer.from('RMVS'), Buffer.from('pas du gzip du tout'), Buffer.alloc(32, 1)]);
    const rf = await I.executerDepuisFichier({ lireFichier: async () => faux, secret: SECRET })();
    H.v('chargeur : faux HMAC sur un contenu non gzip ⇒ « HMAC faux » (donc vérifié avant d\'ouvrir)', [rf.ok, /HMAC faux/.test(rf.raison || '')], [false, true]);
    const sans = await I.executerDepuisFichier({ lireFichier: async () => scelle })();
    H.v('chargeur SANS secret (fermé par défaut) : aucune archive ouverte', [sans.ok, /V2_VISUELS_HMAC/.test(sans.raison)], [false, true]);
    const ok = await I.executerDepuisFichier({ lireFichier: async () => scelle, secret: SECRET })();
    H.v('chargeur avec le bon secret : 40 visuels', [ok.ok, ok.comptes.visuels], [true, 40]);

    // ── 3. LA VALIDATION D'ENTRÉE sur CHAQUE entrée chargée (I3, ruling 4) : un fichier cohérent, bien scellé, mais MENTEUR est refusé en entier
    const brut = F.serialiser(v);
    const mentir = (patch) => { const e = F.lireEntete(brut); return F.compresser(F.reecrireEntete(brut, patch(e))); };
    const lienEtranger = await mentir(e => ({ ...e, prefixe: 'https://exemple.test/' }));
    const r3 = await I.executerDepuisFichier({ lireFichier: async () => S.sceller(lienEtranger, SECRET), secret: SECRET })();
    H.v('liens Cardmarket remplacés par un hôte étranger (structure juste, HMAC juste) : REFUSÉ par la validation d\'entrée, motif nommé', [r3.ok, /entrée\(s\) rejetée\(s\)/.test(r3.raison || ''), /lien/.test(r3.raison || '')], [false, true, true]);
    E.vider(); VB.installer(entrees(3));
    const garde = E.version();
    const rc = await I.creerChargeur({ catalogue: async () => new Map(), executer: I.executerDepuisFichier({ lireFichier: async () => S.sceller(lienEtranger, SECRET), secret: SECRET }), journal: () => { }, pret: async () => true }).charger();
    H.v('   par le chargeur : échec, version précédente gardée', [rc.ok, E.version() === garde], [false, true]);
    E.vider();
    // header qui ment sur les comptes (F4) : refusé, jamais un « 0 perte » trompeur
    const menteur = await mentir(e => ({ ...e, comptes: { ...e.comptes, visuels: e.comptes.visuels + 1000 } }));
    H.v('en-tête qui annonce plus de visuels que les colonnes n\'en portent : refusé', /comptes de l'en-tête/.test((await I.executerDepuisFichier({ lireFichier: async () => S.sceller(menteur, SECRET), secret: SECRET })()).raison || ''), true);
    const menteur2 = await mentir(e => ({ ...e, comptes: { ...e.comptes, fichesLiees: 0 } }));
    H.v('   ... ou annonce 0 fiche liée : refusé (le critère « 0 lien » ne peut pas être contourné par l\'en-tête)', /comptes de l'en-tête/.test((await I.executerDepuisFichier({ lireFichier: async () => S.sceller(menteur2, SECRET), secret: SECRET })()).raison || ''), true);
    // une archive VIDE (0 entrée) est refusée
    const vide = await refus(() => F.deserialiser(F.serialiser(Object.assign(Object.create(null), v, { paquet: () => { const p = v.paquet(); const d = p.donnees; return { donnees: { ...d, cols: Object.fromEntries(Object.keys(d.cols).map(k => [k, new Int32Array(0)])) }, tampons: [] }; } }))));
    H.vrai('   une archive sans aucune entrée : refusée', typeof vide === 'string' && !vide.startsWith('AUTRE'));

    // ── 4. L'OBJET R2 PRIVÉ, avec un FAUX client
    const commandes = [];
    const faux2 = (corps, o = {}) => ({ send: async (cmd, opts) => { commandes.push([cmd.constructor.name, cmd.input, opts && Boolean(opts.abortSignal)]); if (o.leve) throw o.leve; return { ContentLength: o.longueur ?? corps.length, Body: Readable.from([corps]) }; } });
    const lu = await R2.lireObjet({ client: faux2(scelle), bucket: 'seau-prive', objet: 'v2/visuels.rmv', max: 16e6 });
    H.v('lecture : GetObject sur le bucket et l\'objet DES VARIABLES, avec un délai', [lu.equals(scelle), commandes[0][0], commandes[0][1], commandes[0][2]], [true, 'GetObjectCommand', { Bucket: 'seau-prive', Key: 'v2/visuels.rmv' }, true]);
    const rr = async (client, o = {}) => refus(() => R2.lireObjet({ client, bucket: 'b', objet: 'o', max: 1000, ...o }));
    H.v('   taille annoncée trop grande : refusée', /annoncée/.test(await rr(faux2(Buffer.alloc(10), { longueur: 5000 })) || ''), true);
    H.v('   taille lue trop grande (annonce menteuse) : refusée', /lue/.test(await rr(faux2(Buffer.alloc(5000), { longueur: 10 })) || ''), true);
    H.v('   objet vide : refusé', /vide/.test(await rr(faux2(Buffer.alloc(0))) || ''), true);
    H.v('   404 : refusé, nommé (ou null si l\'appelant l\'accepte)', [/absent/.test(await rr(faux2(null, { leve: Object.assign(new Error('x'), { name: 'NoSuchKey' }) })) || ''), await R2.lireObjet({ client: faux2(null, { leve: Object.assign(new Error('x'), { name: 'NoSuchKey' }) }), bucket: 'b', objet: 'o', max: 10, siAbsent: 'null' })], [true, null]);
    H.v('   accès refusé : « R2 indisponible ou accès refusé » sans le texte du client', /R2 indisponible/.test(await rr(faux2(null, { leve: Object.assign(new Error('clé SECRETE-123'), { name: 'AccessDenied' }) })) || '') && !JSON.stringify(await rr(faux2(null, { leve: Object.assign(new Error('clé SECRETE-123'), { name: 'AccessDenied' }) }))).includes('SECRETE'), true);
    const muet = { send: (cmd, opts) => new Promise((_, ko) => opts.abortSignal.addEventListener('abort', () => ko(Object.assign(new Error('t'), { name: 'TimeoutError' })))) };
    const veille = setTimeout(() => { }, 5000);                 // AbortSignal.timeout est « unref » : sans cette veille le banc sortirait avant l'échéance
    H.v('   un client qui ne répond jamais : DÉLAI (borné par delaiMs)', /délai/.test(await rr(muet, { delaiMs: 40 }) || ''), true);
    clearTimeout(veille);
    commandes.length = 0;
    await R2.deposerObjet({ client: faux2(Buffer.alloc(1)), bucket: 'seau-prive', objet: 'v2/visuels.rmv', corps: scelle });
    H.v('dépôt : PutObject, Content-Type binaire, AUCUN Content-Encoding (M4)', [commandes[0][0], commandes[0][1].ContentType, 'ContentEncoding' in commandes[0][1]], ['PutObjectCommand', 'application/octet-stream', false]);

    // ── 5. LES VARIABLES : fermées par défaut, des NOMS dans le journal
    const tout = { V2_VISUELS_R2_COMPTE: 'c', V2_VISUELS_R2_CLE_ID: 'k', V2_VISUELS_R2_SECRET: 's', V2_VISUELS_R2_BUCKET: 'b', V2_VISUELS_R2_OBJET: 'o', V2_VISUELS_HMAC: SECRET };
    H.v('lecture : toutes présentes ⇒ ok', R2.configLecture(tout).ok, true);
    for (const n of R2.NOMS_LECTURE) { const e = { ...tout }; delete e[n]; const r = R2.configLecture(e); H.v(`   ${n} absente ⇒ fermé, la raison NOMME la variable et aucune valeur`, [r.ok, r.raison.includes(n), /secret-hmac|\bs\b=/.test(r.raison)], [false, true, false]); }
    H.v('   écriture : variables d\'ÉCRITURE distinctes de celles de lecture (jamais les mêmes clés)', [R2.NOMS_ECRITURE.filter(n => /_ECR_/.test(n)), R2.NOMS_LECTURE.some(n => /_ECR_/.test(n))], [['V2_VISUELS_R2_ECR_CLE_ID', 'V2_VISUELS_R2_ECR_SECRET'], false]);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
