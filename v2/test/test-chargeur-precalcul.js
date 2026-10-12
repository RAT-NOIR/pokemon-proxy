'use strict';
// COTES-VISUELS, tours 1-2 — la voie « FICHIER PRÉCALCULÉ » de bout en bout : l'équivalence avec le calcul en ligne, le chargeur sur archive scellée, le MONTAGE (fermé par défaut, sans attendre la base),
// le PRODUCTEUR (doublons, aller-retour, 0 lien, garde des 10 % contre l'archive publiée, dépôt) et un serveur enfant. Aucun réseau réel : faux client R2, serveur enfant en banc (aucune connexion à cartes,
// prouvée par un écouteur local qui compte les connexions).
const net = require('net'); const fs = require('fs'); const os = require('os'); const path = require('path'); const zlib = require('zlib');
const H = require('./_harnais');
const E = require('../chargeur/etat'); const F = require('../chargeur/format'); const S = require('../chargeur/scellement');
const I = require('../chargeur');
const { fabriquerFichier } = require('../chargeur/precalcul');
const { demarrerPourConfig } = require('../chargeur/montage');
const { lireConfig } = require('../config');
const { principal } = require('../migrations/construire-fichier-visuels');

const SECRET = 'secret-hmac-de-banc-0123456789-abcdefghij';
const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
const im = (set, numero, n) => ({ set, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: vig(n), langue: 'en', source: 'tcgdex' });
const imp = (numero, exp = 'Set A') => ({ tirage: 'intl', expansion: exp, numero, total: '100', rarete: 'Rare' });
const SETS = [{ _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } },
    { _id: 'Set-B', idExpansion: 200, code: 'SB', nomAffichage: 'Set B', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set B' } }];
function donnees(n, { doublon = false, paires = false } = {}) {
    const docs = [], lignes = [];
    if (paires) {          // n produits, n/2 cartes : DEUX produits par fiche (les visuels ne bougent pas, les fiches liées tombent de moitié)
        for (let k = 1; k <= n / 2; k++) docs.push({ _id: k, nomEn: `Carte ${k}`, sets: ['Set-A'], impressions: [imp(String(k).padStart(3, '0'))], images: [im('Set-A', String(k).padStart(3, '0'), `c${k}`)] });
        for (let i = 1; i <= n; i++) lignes.push({ idProduct: 1000 + i, carteId: Math.ceil(i / 2), idExpansion: 100, numeroFiche: String(Math.ceil(i / 2)).padStart(3, '0'), slug: `P${i}-SA${i}`, slugSet: 'Set-A' });
        return { sets: SETS, docs, lignes };
    }
    for (let i = 1; i <= n; i++) {
        const num = String(i).padStart(3, '0');
        docs.push({ _id: i, nomEn: `Carte ${i}`, sets: ['Set-A'], impressions: [imp(num)], images: [im('Set-A', num, `c${i}`)] });
        lignes.push({ idProduct: 1000 + i, carteId: i, idExpansion: 100, numeroFiche: num, slug: `P${i}-SA${i}`, slugSet: 'Set-A' });
    }
    if (doublon) {           // le produit 1005 est AUSSI rattaché à une carte d'un autre set : decider émet DEUX entrées pour un même idProduct (CLAUDE.md §32)
        docs.push({ _id: 900, nomEn: 'Carte 900', sets: ['Set-B'], impressions: [imp('001', 'Set B')], images: [im('Set-B', '001', 'c900')] });
        lignes.push({ idProduct: 1005, carteId: 900, idExpansion: 200, numeroFiche: '001', slug: 'P5-SB1', slugSet: 'Set-B' });
    }
    return { sets: SETS, docs, lignes };
}
const catalogue = new Map(Array.from({ length: 40 }, (_, i) => [1001 + i, 5000 + (i % 4)]));
const source = d => async () => ({ ok: true, ...d, fermer: async () => { } });
const attendre = ms => new Promise(r => setTimeout(r, ms));
// un faux magasin R2 : Get / Put en mémoire, chaque commande notée
function magasin(initial = null) {
    const m = { objet: initial, commandes: [], send: async cmd => {
        m.commandes.push([cmd.constructor.name, cmd.input.Bucket, cmd.input.Key, cmd.input.ContentType ?? null]);
        if (cmd.constructor.name === 'PutObjectCommand') { m.objet = Buffer.from(cmd.input.Body); return {}; }
        if (m.objet === null) throw Object.assign(new Error('x'), { name: 'NoSuchKey' });
        return { ContentLength: m.objet.length, Body: (async function* () { yield m.objet; })() };
    } };
    return m;
}
const ENV_ECR = { V2_VISUELS_HMAC: SECRET, V2_VISUELS_R2_COMPTE: 'c', V2_VISUELS_R2_ECR_CLE_ID: 'k', V2_VISUELS_R2_ECR_SECRET: 's', V2_VISUELS_R2_BUCKET: 'seau-prive', V2_VISUELS_R2_OBJET: 'v2/visuels.rmv' };

(async () => {
    // ── 1. le fichier précalculé donne EXACTEMENT ce que le calcul en ligne donne
    const d = donnees(30);
    const enLigne = await I.executerEnLigne({ source: source(d) })({ catalogue });
    const f = await fabriquerFichier({ source: source(d), catalogue, secret: SECRET });
    const viaFichier = await I.executerDepuisFichier({ lireFichier: async () => f.scelle, secret: SECRET })();
    H.v('fichier scellé : ok, mêmes comptes que le calcul en ligne (30 visuels, 30 fiches)', [viaFichier.ok, viaFichier.comptes.visuels, viaFichier.comptes.fichesLiees, enLigne.comptes.visuels], [true, 30, 30, 30]);
    const ids = Array.from({ length: 30 }, (_, i) => 1001 + i);
    H.v('   chaque entrée identique (30), les métacartes et les fiches aussi', [ids.filter(id => JSON.stringify(viaFichier.version.entree(id)) === JSON.stringify(enLigne.version.entree(id))).length,
        JSON.stringify([5000, 5001, 5002, 5003].map(m => viaFichier.version.produitsDeMetacarte(m))) === JSON.stringify([5000, 5001, 5002, 5003].map(m => enLigne.version.produitsDeMetacarte(m))),
        JSON.stringify(viaFichier.version.fichesDuSet('Set-A')) === JSON.stringify(enLigne.version.fichesDuSet('Set-A'))], [30, true, true]);
    H.v('   les dénominateurs d\'entrée voyagent avec le fichier (sets, cartes, produits, catalogue)', [viaFichier.comptes.sets, viaFichier.comptes.cartes, viaFichier.comptes.produits, viaFichier.comptes.catalogue], [2, 30, 30, 40]);

    // ── 2. LE PRODUCTEUR n'écrit rien que le consommateur refuse (I2) et refuse l'amputé (P1, ruling 4)
    const dd = await fabriquerFichier({ source: source(donnees(30, { doublon: true })), catalogue, secret: SECRET });
    H.v('un produit rattaché à DEUX cartes (deux sets) aux visuels DIFFÉRENTS : deux entrées émises, AUCUN visuel servi pour ce produit (ruling 1), compté comme contradictoire', [dd.comptes.doublonsContradictoires, dd.comptes.doublons, dd.comptes.visuels], [1, 0, 29]);
    const lu = await I.executerDepuisFichier({ lireFichier: async () => dd.scelle, secret: SECRET })();
    H.v('   et le CONSOMMATEUR lit cette archive (aller-retour réel) : 29 visuels, le produit 1005 n\'a aucun visuel, les autres sont intacts', [lu.ok, lu.comptes.visuels, lu.version.entree(1005), lu.version.entree(1004).setNom, lu.comptes.doublonsContradictoires], [true, 29, null, 'Set A', 1]);
    const dm = donnees(30, { doublon: true }); dm.docs[dm.docs.length - 1].images = [im('Set-B', '001', 'c5')];      // la carte du Set B porte le MÊME fichier (cleR2 et vignette) que la carte 5 du Set A
    const ddm = await fabriquerFichier({ source: source(dm), catalogue, secret: SECRET });
    H.v('   le même produit rattaché à deux cartes au MÊME visuel : une seule entrée gardée, compté comme doublon identique, pas contradictoire', [ddm.comptes.doublons, ddm.comptes.doublonsContradictoires, ddm.comptes.visuels], [1, 0, 30]);
    const sansImage = donnees(3); sansImage.docs.forEach(x => { x.images = []; });
    let m0 = null; try { await fabriquerFichier({ source: source(sansImage), catalogue, secret: SECRET }); } catch (e) { m0 = e.motif; }
    H.v('rien d\'admissible (aucune image) : AUCUN fichier produit, motif nommé', /0 visuel.*aucun fichier/.test(m0 || ''), true);
    let m1 = null; try { await fabriquerFichier({ source: source(donnees(5)), catalogue, secret: SECRET, decider: async ({ sink }) => { sink.entree({ idProduct: 1001, visuel: 'du-set', mention: null, idMetacard: 5000, numero: '001', rarete: 'Rare', total: '10', variante: null, setNom: 'S', lien: null, grande: null, vignette: { cle: 'v/1.webp', w: 1, h: 1 } }); return { denominateurs: { setsAvecLiens: 0, produitsLies: 0 } }; } }); } catch (e) { m1 = e.motif; }
    H.v('0 lien fiche → produits (des entrées, aucun lien) : AUCUN fichier produit, motif nommé', /0 lien.*aucun fichier/.test(m1 || ''), true);
    // JUMEAU-V2 : le fichier porte la colonne des jumeaux (relue à l'identique) ; un producteur qui ne l'émet pas ne publie rien
    H.v('JUMEAU-V2 : l\'archive porte la colonne des jumeaux, relue à l\'identique du calcul en ligne (jumeaux de chaque produit)', [viaFichier.version.colonneJumeaux, ids.every(id => JSON.stringify(viaFichier.version.jumeauxDe(id)) === JSON.stringify(enLigne.version.jumeauxDe(id)))], [true, true]);
    let m2 = null; try { await fabriquerFichier({ source: source(donnees(5)), catalogue, secret: SECRET, decider: a => require('../chargeur/decision').decider({ ...a, sink: { entree: a.sink.entree, lien: a.sink.lien } }) }); } catch (e) { m2 = e.motif; }
    H.v('   un producteur qui n\'émet pas les jumeaux : AUCUN fichier produit, motif nommé', /colonne des jumeaux.*aucun fichier/.test(m2 || ''), true);

    // ── 3. le chargeur sur archive scellée : bascule, refus d'une archive abîmée, version gardée
    E.vider();
    const journal = [];
    const ch = lire => I.creerChargeur({ catalogue: async () => new Map(), executer: I.executerDepuisFichier({ lireFichier: lire, secret: SECRET }), journal: m => journal.push(m), pret: async () => true });
    const r1 = await ch(async () => f.scelle).charger();
    H.v('chargeur sur fichier scellé : ok, 30 visuels en place', [r1.ok, E.version().comptes.visuels], [true, 30]);
    H.vrai('   le journal dit la date de l\'archive et son âge', journal.some(m => /archive du \d{4}-\d{2}-\d{2}T.*âge \d+ h/.test(m)));
    const garde = E.version();
    const gz = zlib.gunzipSync(zlib.gzipSync(f.brut));
    for (const [nom, octets] of [['archive tronquée', f.scelle.subarray(0, f.scelle.length >> 1)], ['pas du tout une archive', Buffer.from('pas du gzip')], ['octet retourné', (() => { const b = Buffer.from(f.scelle); b[b.length >> 1] ^= 1; return b; })()], ['vide', Buffer.alloc(0)]]) {
        const r = await ch(async () => octets).charger();
        H.v(`${nom} : refusée, version précédente gardée`, [r.ok, E.version() === garde], [false, true]);
    }
    const rPanne = await ch(async () => { throw new Error('panne'); }).charger();
    H.v('lecture de l\'objet qui échoue : échec, version gardée', [rPanne.ok, E.version() === garde], [false, true]);
    // une archive plus ANCIENNE que celle en place est refusée (M5)
    const vieille = await fabriquerFichier({ source: source(d), catalogue, secret: SECRET });
    const viellie = F.reecrireEntete(vieille.brut, { ...F.lireEntete(vieille.brut), chargeLe: '2020-01-01T00:00:00.000Z' });
    const rv = await ch(async () => S.sceller(await F.compresser(viellie), SECRET)).charger();
    H.v('archive plus ancienne que celle en place : refusée, motif nommé', [rv.ok, /plus ancienne/.test(rv.motif || '')], [false, true]);
    E.vider();

    // ── 4. le MONTAGE : fermé par défaut ; la voie fichier n'attend PAS la base ; banc = aucun réseau
    const cfgBanc = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const cfgProd = lireConfig({ MONGODB_BASE: 'test' });
    let creations = 0; const jm = [];
    I.arreterChargeur(); E.vider();
    H.v('production, variables absentes : AUCUN chargeur, « sans visuel », le journal NOMME les variables (jamais une valeur)', [demarrerPourConfig(cfgProd, { env: {}, journal: m => jm.push(m), client: { send: () => { creations++; } } }), /V2_VISUELS_R2_COMPTE/.test(jm[0] || ''), /V2_VISUELS_HMAC/.test(jm[0] || ''), creations], [null, true, true, 0]);
    jm.length = 0;
    H.v('   une seule variable manquante (le secret HMAC) : fermé', [demarrerPourConfig(cfgProd, { env: { ...ENV_ECR, V2_VISUELS_R2_CLE_ID: 'k', V2_VISUELS_R2_SECRET: 's', V2_VISUELS_HMAC: undefined }, journal: m => jm.push(m) }), /V2_VISUELS_HMAC/.test(jm[0] || '')], [null, true]);
    jm.length = 0;
    H.v('   un secret HMAC trop court : fermé, le journal le dit', [demarrerPourConfig(cfgProd, { env: { ...ENV_ECR, V2_VISUELS_R2_CLE_ID: 'k', V2_VISUELS_R2_SECRET: 's', V2_VISUELS_HMAC: 'court' }, journal: m => jm.push(m) }), /trop court/.test(jm[0] || '')], [null, true]);
    const mag = magasin(f.scelle);
    const envLecture = { V2_VISUELS_R2_COMPTE: 'c', V2_VISUELS_R2_CLE_ID: 'k', V2_VISUELS_R2_SECRET: 's', V2_VISUELS_R2_BUCKET: 'seau-prive', V2_VISUELS_R2_OBJET: 'v2/visuels.rmv', V2_VISUELS_HMAC: SECRET };
    const t0 = Date.now(); const c = demarrerPourConfig(cfgProd, { env: envLecture, client: mag });
    H.v('variables présentes : chargeur démarré, rien de lu au montage (le montage rend la main sans attendre)', [c !== null, mag.commandes.length, Date.now() - t0 < 100], [true, 0, true]);
    for (let k = 0; k < 40 && !E.version(); k++) await attendre(25);
    H.v('   la voie fichier N\'ATTEND PAS la base de l\'API (aucune connexion ici) : l\'archive est installée en moins d\'une seconde', [E.version() && E.version().comptes.visuels, Date.now() - t0 < 1000], [30, true]);
    H.v('   lue sur le bucket et l\'objet DES VARIABLES (GetObject), rien d\'autre', mag.commandes.map(x => x.slice(0, 3)), [['GetObjectCommand', 'seau-prive', 'v2/visuels.rmv']]);
    I.arreterChargeur(); E.vider();
    // N4 (ruling 4) : le plafond de LECTURE du montage (16 Mo + 64) est celui de format.js — annoncé trop grand : refusé SANS lire un octet ; annonce menteuse : lecture ARRÊTÉE au plafond
    const MAX_LECTURE = F.PLAFONDS.archive + 64;
    const lectureDu = async (client) => {
        const jr = []; I.arreterChargeur(); E.vider();
        const ch2 = demarrerPourConfig(cfgProd, { env: envLecture, client, journal: m => jr.push(m) });
        for (let k = 0; k < 40 && ch2 && !jr.some(m => /sans chargement|échec/.test(m)); k++) await attendre(25);
        I.arreterChargeur();
        return jr.join(' | ');
    };
    let lus = 0;
    const morceaux = (n, taille = 1048576) => (async function* () { for (let i = 0; i < n; i++) { lus++; yield Buffer.alloc(taille, 1); } })();
    const trop = await lectureDu({ send: async () => ({ ContentLength: MAX_LECTURE + 1, Body: morceaux(40) }) });
    H.v('objet annoncé plus grand que 16 Mo + 64 : refusé, motif nommé, AUCUN octet lu', [/plus grand que la taille permise \(annoncée\)/.test(trop), lus], [true, 0]);
    lus = 0;
    const menteur = await lectureDu({ send: async () => ({ ContentLength: 1000, Body: morceaux(40) }) });
    H.v('   annonce menteuse (1 000 octets, 40 Mo servis) : refusé « lue », la lecture S\'ARRÊTE au plafond (≤ 18 blocs de 1 Mo lus sur 40)', [/plus grand que la taille permise \(lue\)/.test(menteur), lus <= 18], [true, true]);
    const mauvais = magasin(S.sceller(f.gz, SECRET.replace('s', 'z')));
    demarrerPourConfig(cfgProd, { env: envLecture, client: mauvais });
    await attendre(300);
    H.v('un objet scellé avec un AUTRE secret : jamais installé (« sans visuel »)', E.version(), null);
    I.arreterChargeur();
    H.v('banc sans archive : aucun chargeur, aucun réseau', [demarrerPourConfig(cfgBanc, { env: { BANC_ISOLE: '1', ...envLecture }, client: { send: () => { creations++; } } }), creations], [null, 0]);
    const fichierBanc = path.join(os.tmpdir(), `archive-banc-${process.pid}.rmv.gz`); fs.writeFileSync(fichierBanc, zlib.gzipSync(f.brut));
    demarrerPourConfig({ ...cfgBanc, visuels: { ...cfgBanc.visuels, fichierBanc } }, { env: { BANC_ISOLE: '1' } });
    H.v('banc avec archive locale : installée TOUT DE SUITE (30 visuels)', E.version() && E.version().comptes.visuels, 30);
    E.vider(); fs.writeFileSync(fichierBanc, 'abîmée'); const jb = [];
    demarrerPourConfig({ ...cfgBanc, visuels: { ...cfgBanc.visuels, fichierBanc } }, { env: { BANC_ISOLE: '1' }, journal: m => jb.push(m) });
    H.v('banc avec archive abîmée : refusée, « sans visuel », journalisé', [E.version(), jb.length], [null, 1]);
    fs.writeFileSync(fichierBanc, zlib.gzipSync(zeros250())); E.vider();
    demarrerPourConfig({ ...cfgBanc, visuels: { ...cfgBanc.visuels, fichierBanc } }, { env: { BANC_ISOLE: '1' }, journal: m => jb.push(m) });
    H.v('banc avec une bombe gzip : refusée aussi (mêmes plafonds que la voie réelle)', E.version(), null);
    fs.unlinkSync(fichierBanc);
    const cc = demarrerPourConfig(lireConfig({ MONGODB_BASE: 'test', V2_VISUELS_SOURCE: 'calcul' }), { env: {} });
    H.v('production, source calcul : un chargeur (fil), toujours rien de lu au montage', cc !== null, true);
    I.arreterChargeur(); E.vider();

    // ── 5. le script PRODUCTEUR : garde des 10 % contre l'archive publiée, dépôt scellé, refus sans publication
    const lancer = async (argv, env, deps) => {
        const sortie = []; const lo = console.log, le = console.error; console.log = m => sortie.push(String(m)); console.error = m => sortie.push(String(m));
        try { const code = await principal(['node', 'script', ...argv], env, deps); return { code, texte: sortie.join('\n') }; } finally { console.log = lo; console.error = le; }
    };
    const cat100 = new Map(Array.from({ length: 100 }, (_, i) => [1001 + i, 5000 + (i % 4)]));
    const m5 = magasin();
    const p1 = await lancer(['--deposer'], ENV_ECR, { source: source(donnees(100)), catalogue: cat100, client: m5 });
    H.v('première publication : code 0, dite (rien à comparer), PutObject sur le bucket et l\'objet des variables, Content-Type binaire', [p1.code, /première publication/.test(p1.texte), m5.commandes.filter(x => x[0] === 'PutObjectCommand').map(x => x.slice(1)).flat()], [0, true, ['seau-prive', 'v2/visuels.rmv', 'application/octet-stream']]);
    const publie = m5.objet;
    H.v('   l\'objet publié est SCELLÉ et se lit avec le code du consommateur (100 visuels)', (await I.executerDepuisFichier({ lireFichier: async () => publie, secret: SECRET })()).comptes.visuels, 100);
    const p2 = await lancer(['--deposer'], ENV_ECR, { source: source(donnees(95)), catalogue: cat100, client: m5 });
    H.v('une baisse de 5 % : publiée, comparaison dite', [p2.code, /chute ≤ 10 %/.test(p2.texte)], [0, true]);
    const apres2 = m5.objet;
    m5.commandes.length = 0;
    const p3 = await lancer(['--deposer'], ENV_ECR, { source: source(donnees(60)), catalogue: cat100, client: m5 });
    H.v('une chute de 37 % (95 → 60) : REFUSÉE, code 1, journal à l\'appui, AUCUN PutObject, l\'objet publié est inchangé', [p3.code, /chute de plus de 10 % des visuels.*\(95 → 60\)/.test(p3.texte) || p3.texte.slice(0, 300), m5.commandes.some(x => x[0] === 'PutObjectCommand'), m5.objet.equals(apres2)], [1, true, false, true]);
    m5.objet = Buffer.from('objet précédent corrompu');
    const p4 = await lancer(['--deposer'], ENV_ECR, { source: source(donnees(100)), catalogue: cat100, client: m5 });
    H.v('archive précédente ILLISIBLE : « je ne sais pas » ⇒ refus, AUCUNE publication', [p4.code, /illisible/.test(p4.texte), m5.objet.equals(Buffer.from('objet précédent corrompu'))], [1, true, true]);
    const p5 = await lancer(['--deposer', '--ignorer-precedente'], ENV_ECR, { source: source(donnees(100)), catalogue: cat100, client: m5 });
    H.v('   --ignorer-precedente (l\'acte explicite) : publiée', [p5.code, m5.objet.equals(Buffer.from('objet précédent corrompu'))], [0, false]);
    // N5 (ruling 4) : l'archive précédente n'a pas pu être LUE (R2 refuse, ou secret différent) ⇒ on ne publie pas, règle écrite : « je ne sais pas » est un refus ; l'acte explicite passe outre.
    // Justification : publier à l'aveugle peut remplacer une bonne archive par une amputée ; refuser ne coûte qu'une journée avec l'archive de la veille.
    const getRefuse = { commandes: [], send: async cmd => { getRefuse.commandes.push(cmd.constructor.name); if (cmd.constructor.name === 'PutObjectCommand') return {}; throw Object.assign(new Error('x'), { name: 'AccessDenied' }); } };
    const p6 = await lancer(['--deposer'], ENV_ECR, { source: source(donnees(100)), catalogue: cat100, client: getRefuse });
    H.v('archive précédente NON LISIBLE (R2 refuse la lecture) : code 1, la raison est dite, AUCUN PutObject', [p6.code, /précédente n'a pas pu être lue/.test(p6.texte), getRefuse.commandes.includes('PutObjectCommand')], [1, true, false]);
    getRefuse.commandes.length = 0;
    const p7 = await lancer(['--deposer', '--ignorer-precedente'], ENV_ECR, { source: source(donnees(100)), catalogue: cat100, client: getRefuse });
    H.v('   --ignorer-precedente : publiée malgré tout', [p7.code, getRefuse.commandes.includes('PutObjectCommand')], [0, true]);
    const mAutre = magasin(S.sceller(f.gz, SECRET.replace('s', 'z')));
    const p8 = await lancer(['--deposer'], ENV_ECR, { source: source(donnees(100)), catalogue: cat100, client: mAutre });
    H.v('archive précédente scellée avec un AUTRE secret : refus (illisible pour nous), AUCUN PutObject', [p8.code, mAutre.commandes.some(x => x[0] === 'PutObjectCommand')], [1, false]);
    // N6 : la garde des 10 % juge AUSSI les fiches liées (100 visuels, 100 fiches → 100 visuels, 50 fiches)
    const m6 = magasin();
    await lancer(['--deposer'], ENV_ECR, { source: source(donnees(100)), catalogue: cat100, client: m6 });
    const avant6 = m6.objet; m6.commandes.length = 0;
    const p9 = await lancer(['--deposer'], ENV_ECR, { source: source(donnees(100, { paires: true })), catalogue: cat100, client: m6 });
    H.v('fiches liées 100 → 50 à visuels CONSTANTS (100) : REFUSÉE, code 1, les fiches liées sont nommées, AUCUN PutObject, objet inchangé', [p9.code, /chute de plus de 10 % des fiches liées.*\(100 → 50\)/.test(p9.texte) || p9.texte.slice(0, 300), m6.commandes.some(x => x[0] === 'PutObjectCommand'), m6.objet.equals(avant6)], [1, true, false, true]);
    // le dénominateur des doublons est IMPRIMÉ par le producteur
    const p10 = await lancer(['--deposer'], ENV_ECR, { source: source(donnees(100, { doublon: true })), catalogue: cat100, client: magasin() });
    H.v('le producteur imprime les doublons : identiques et CONTRADICTOIRES (produits sans visuel)', [p10.code, /doublons d'idProduct identiques 0/.test(p10.texte), /contradictoires 1/.test(p10.texte)], [0, true, true]);
    const sansHmac = await lancer(['--deposer'], { ...ENV_ECR, V2_VISUELS_HMAC: undefined }, { source: source(donnees(100)), catalogue: cat100, client: magasin() });
    H.v('sans secret HMAC : code 1, rien n\'est calculé ni publié', [sansHmac.code, /V2_VISUELS_HMAC/.test(sansHmac.texte)], [1, true]);
    const sansEcr = await lancer(['--deposer'], { V2_VISUELS_HMAC: SECRET }, { source: source(donnees(100)), catalogue: cat100, client: magasin() });
    H.v('sans variables d\'écriture R2 : code 1, elles sont NOMMÉES', [sansEcr.code, /V2_VISUELS_R2_ECR_CLE_ID/.test(sansEcr.texte)], [1, true]);
    const vide0 = await lancer([], ENV_ECR, { source: source(donnees(100)), catalogue: cat100 });
    H.v('ni --deposer ni --vers : code 1', vide0.code, 1);
    const fv = path.join(os.tmpdir(), `sortie-script-${process.pid}.rmv`);
    const pv = await lancer([`--vers=${fv}`], { V2_VISUELS_HMAC: SECRET }, { source: source(donnees(100)), catalogue: cat100 });
    H.v('--vers : le fichier local est SCELLÉ et lisible par le consommateur', [pv.code, (await I.executerDepuisFichier({ lireFichier: async () => fs.readFileSync(fv), secret: SECRET })()).comptes.visuels], [0, 100]);
    fs.unlinkSync(fv);
    const erreurs = []; const ancienne = console.error; console.error = m => erreurs.push(String(m));
    let code1, code3;
    try {
        code1 = await principal(['node', 'script', '--deposer', '--vers=x'], { V2_VISUELS_HMAC: SECRET, ...ENV_ECR });
        code3 = await principal(['node', 'script', '--vers=x'], { V2_VISUELS_HMAC: SECRET, MONGODB_CARTES_LECTURE_URI: 'mongodb+srv://u:x@h.exemple.net/cartes', MONGODB_CARTES_URI: 'mongodb+srv://u:y@h.exemple.net/cartes' });
    } finally { console.error = ancienne; }
    H.v('script sans variable de lecture de cartes : code 1, refus nommé AVANT toute connexion', [code1, /MONGODB_CARTES_LECTURE_URI/.test(erreurs[0] || '')], [1, true]);
    H.v('script avec le même utilisateur en lecture et en écriture : code 1 AVANT toute connexion', [code3, /utilisateur/.test(erreurs[1] || '')], [1, true]);

    // ── 6. serveur enfant : interrupteur éteint = aucune connexion à cartes ; allumé en banc = aucune non plus (écouteur local qui compte)
    await H.ouvrirBancV2();
    let connexions = 0; const ecouteur = net.createServer(sock => { connexions++; sock.destroy(); });
    await new Promise(r => ecouteur.listen(0, '127.0.0.1', r));
    const port = ecouteur.address().port;
    const { demarrer } = require('../../verrou/serveur');
    const base = { VERROU_CHARGES: path.join(__dirname, '..', '..', 'verrou', 'charges.json'), JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '',
        MONGODB_CARTES_LECTURE_URI: `mongodb://lecteur:x@127.0.0.1:${port}/cartes`, MONGODB_CARTES_URI: `mongodb://ecrivain:x@127.0.0.1:${port}/cartes` };
    for (const [nom, v2] of [['éteinte', ''], ['allumée (banc)', '1']]) {
        const srv = await demarrer(path.join(__dirname, 'faux-reseau-v2.js'), { ...base, RM_API_V2: v2 });
        try { if (!await srv.attendreMongo()) throw new Error('Mongo non connecté'); await attendre(2500); }
        finally { srv.enfant.kill(); }
        H.v(`serveur enfant, v2 ${nom} : aucune connexion à l'adresse de cartes (les deux URI pointent l'écouteur)`, connexions, 0);
    }
    ecouteur.close();
    await H.arreterBanc();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

function zeros250() { return Buffer.alloc(60 * 1048576); }
