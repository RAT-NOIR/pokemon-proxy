// ============================================================
// Dépôt des fichiers du film d'accueil sur le bucket PUBLIC des images (R2), et contrôle par l'adresse publique.
// ============================================================
//   node deposer-film-r2.js --manifeste=<f>                                   plan : valide tout, aucun réseau
//   node deposer-film-r2.js --manifeste=<f> --ecrire --attendu=<N>            dépose
//   node deposer-film-r2.js --manifeste=<f> --controler --attendu=<N> --rapport=<f.json>   contrôle public
//
// Règles (chacune a son cas dans test-deposer-film-r2.js) :
//  1. clés sous film/accueil/v7/ ET sous le prefixeR2 du manifeste, uniques, sans « .. », type dans une liste fermée, sha256 hex, taille entière > 0 ;
//  2. avant tout dépôt : chaque fichier local existe, taille et sha256 égalent le manifeste — sinon rien n'est déposé ;
//  3. le compte égale --attendu ;
//  4. UNE CLÉ NE CHANGE JAMAIS DE CONTENU : présente et identique = « deja-la » ; présente et différente = ARRÊT avant toute écriture.
//     Aucune option ne l'autorise ; l'écriture porte en plus IfNoneMatch: '*' (le serveur refuse lui-même d'écraser) ;
//  5. ContentType du manifeste, CacheControl « public, max-age=31536000, immutable » ;
//  6. bucket = R2_BUCKET_IMAGES seulement, verifierBucket d'abord ; base publique = R2_IMAGES_BASE_URL, https obligatoire.
// La CLI s'écrit par ce qu'elle AUTORISE : tout argument inconnu est refusé avant toute connexion.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREFIXE_FILM = 'film/accueil/v7/';
const TYPES = new Set(['video/webm', 'video/mp4', 'image/avif', 'image/webp', 'image/jpeg']);
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const PAUSE_MS = 500;            // 2 requêtes par seconde au plus
const ATTENTE_429_MS = 30000;    // 30 s, 60 s, 90 s…
const ESSAIS_MAX = 5;
const ECHECS_DEBIT_ARRET = 3;
const DELAI_REQUETE_MS = 60000;  // délai maximal par requête (AbortSignal)

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const estVideo = ct => ct === 'video/webm' || ct === 'video/mp4';

// ---------- CLI ----------
function lireArgs(argv) {
    const BOOL = new Set(['ecrire', 'controler']);
    const VAL = new Set(['manifeste', 'attendu', 'rapport']);
    const o = {};
    for (const a of argv) {
        const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
        if (!m) throw new Error(`argument inconnu : « ${a} »`);
        const [, nom, val] = m;
        if (BOOL.has(nom) && val === undefined) { o[nom] = true; continue; }
        if (VAL.has(nom) && val !== undefined && val !== '') { o[nom] = val; continue; }
        throw new Error(`argument inconnu ou mal formé : « ${a} »`);
    }
    if (!o.manifeste) throw new Error('--manifeste=<fichier> est obligatoire');
    if (o.ecrire && o.controler) throw new Error('--ecrire et --controler sont exclusifs (pas ensemble)');
    let attendu = null;
    if (o.attendu !== undefined) {
        if (!/^\d+$/.test(o.attendu)) throw new Error('--attendu doit être un entier');
        attendu = Number(o.attendu);
    }
    const mode = o.ecrire ? 'ecrire' : o.controler ? 'controler' : 'plan';
    if (mode !== 'plan' && attendu === null) throw new Error('--attendu=<N> est obligatoire avec --ecrire et --controler');
    if (mode === 'controler' && !o.rapport) throw new Error('--rapport=<fichier.json> est obligatoire avec --controler');
    if (mode !== 'controler' && o.rapport) throw new Error('--rapport ne vaut qu\'avec --controler');
    return { mode, manifeste: o.manifeste, attendu, rapport: o.rapport || null };
}

// ---------- garde 1 : manifeste ----------
function validerManifeste(m) {
    const pre = m && m.prefixeR2;
    if (typeof pre !== 'string' || !pre.startsWith(PREFIXE_FILM)) throw new Error(`prefixeR2 « ${pre} » : doit commencer par ${PREFIXE_FILM}`);
    if (!Array.isArray(m.fichiers) || !m.fichiers.length) throw new Error('fichiers : liste absente ou vide');
    const vues = new Set();
    for (const f of m.fichiers) {
        const c = f && f.cleR2;
        if (typeof c !== 'string' || !c) throw new Error('cleR2 absente');
        if (!c.startsWith(PREFIXE_FILM) || !c.startsWith(pre)) throw new Error(`clé « ${c} » : hors préfixe ${PREFIXE_FILM} / ${pre}`);
        if (c.includes('..')) throw new Error(`clé « ${c} » : « .. » interdit`);
        if (c.length === pre.length) throw new Error(`clé « ${c} » : sans nom de fichier`);
        if (vues.has(c)) throw new Error(`clé « ${c} » dupliquée (les clés doivent être uniques)`);
        vues.add(c);
        if (!TYPES.has(f.contentType)) throw new Error(`clé « ${c} » : contentType « ${f.contentType} » hors liste fermée`);
        if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(`clé « ${c} » : sha256 invalide`);
        if (!Number.isInteger(f.taille) || f.taille <= 0) throw new Error(`clé « ${c} » : taille invalide (entier > 0 attendu)`);
    }
    return m.fichiers.length;
}

function verifierCompte(n, attendu) {
    if (n !== attendu) throw new Error(`compte du manifeste ${n} ≠ attendu ${attendu}`);
}

// ---------- garde 2 : fichiers locaux ----------
function verifierLocaux(m, { fs: fsx = fs, dossier = '.' } = {}) {
    for (const f of m.fichiers) {
        const p = path.resolve(dossier, f.chemin || '');
        let st;
        try { st = fsx.statSync(p); } catch { throw new Error(`fichier local absent : ${p} (n'existe pas)`); }
        if (!st.isFile()) throw new Error(`fichier local absent : ${p} (n'est pas un fichier)`);
        if (st.size !== f.taille) throw new Error(`${f.cleR2} : taille locale ${st.size} ≠ manifeste ${f.taille}`);
        const h = sha256(fsx.readFileSync(p));
        if (h !== f.sha256) throw new Error(`${f.cleR2} : sha256 locale ${h} ≠ manifeste ${f.sha256}`);
    }
}

function preparer(m, attendu, opts) {
    const n = validerManifeste(m);
    if (attendu !== null && attendu !== undefined) verifierCompte(n, attendu);
    verifierLocaux(m, opts);
    return n;
}

// ---------- dépôt ----------
const introuvable = e => e && (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound' || e.name === 'NoSuchKey');

async function deposer({ manifeste, attendu, s3, bucket, fs: fsx = fs, dossier = '.', log = () => {} }) {
    // NB : aucune option d'écrasement n'existe ; tout paramètre supplémentaire est ignoré.
    const { HeadObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
    const n = preparer(manifeste, attendu, { fs: fsx, dossier });
    // passe 1 : l'état de CHAQUE clé, avant d'écrire quoi que ce soit
    const aEcrire = [];
    let dejaLa = 0, deposes = 0;
    try {
        for (const f of manifeste.fichiers) {
            let tete = null;
            try { tete = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: f.cleR2 })); }
            catch (e) { if (!introuvable(e)) throw e; }
            if (!tete) { aEcrire.push(f); continue; }
            const meme = await memeContenu(tete, f, async () => {
                const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: f.cleR2 }));
                return Buffer.from(await r.Body.transformToByteArray());
            });
            if (!meme) throw new Error(`ARRÊT : la clé ${f.cleR2} existe avec un contenu différent du manifeste — jamais d'écrasement (aucune écriture faite)`);
            dejaLa++;
            log(`  deja-la  ${f.cleR2}`);
        }
        // passe 2 : écritures
        for (const f of aEcrire) {
            // UN SEUL Buffer : celui qu'on hache est celui qu'on envoie
            const corps = fsx.readFileSync(path.resolve(dossier, f.chemin));
            const h = sha256(corps);
            if (h !== f.sha256 || corps.length !== f.taille) throw new Error(`${f.cleR2} : le fichier a changé depuis la vérification (sha256 relue ${h} ≠ manifeste ${f.sha256}) — rien envoyé pour cette clé`);
            try {
                await s3.send(new PutObjectCommand({
                    Bucket: bucket, Key: f.cleR2, Body: corps,
                    ContentType: f.contentType, CacheControl: CACHE_CONTROL,
                    Metadata: { sha256: f.sha256 }, IfNoneMatch: '*'
                }));
            } catch (e) {
                if (e && (e.$metadata?.httpStatusCode === 412 || e.name === 'PreconditionFailed'))
                    throw new Error(`ARRÊT : 412 PreconditionFailed (IfNoneMatch) — la clé ${f.cleR2} a été créée entre-temps ; jamais d'écrasement`);
                throw e;
            }
            deposes++;
            log(`  depose   ${f.cleR2}`);
        }
    } catch (e) {
        log(`DÉPÔT INTERROMPU : ${deposes} déposés, ${dejaLa} déjà là, ${manifeste.fichiers.length - deposes - dejaLa} restants sur ${n}.`);
        throw e;
    }
    return { deposes, dejaLa, total: n };
}

async function memeContenu(tete, f, relire) {
    if (tete.ContentLength !== f.taille) return false;
    const meta = tete.Metadata && tete.Metadata.sha256;
    if (meta) return meta === f.sha256;
    return sha256(await relire()) === f.sha256;
}

// ---------- contrôle public ----------
function baseHttps(env) {
    const b = env.R2_IMAGES_BASE_URL;
    if (!b) throw new Error('R2_IMAGES_BASE_URL absente');
    if (!/^https:\/\/[^/\s]+/i.test(b)) throw new Error(`R2_IMAGES_BASE_URL doit être en https (reçu « ${b} »)`);
    return b.replace(/\/+$/, '');
}

async function controler({ manifeste, attendu, base, fetch: fetchx, sommeil, log = () => {} }) {
    const n = validerManifeste(manifeste);
    verifierCompte(n, attendu);
    let premiere = true;
    // une requête, sérialisée, ≤ 2/s ; 429 : attente croissante, 5 essais ; null = débit épuisé
    async function demander(url, headers) {
        for (let essai = 1; essai <= ESSAIS_MAX; essai++) {
            if (!premiere) await sommeil(PAUSE_MS);
            premiere = false;
            const r = await fetchx(url, { signal: AbortSignal.timeout(DELAI_REQUETE_MS), ...(headers ? { headers } : {}) });
            if (r.status !== 429) return r;
            log(`  429 ${url} (essai ${essai}/${ESSAIS_MAX})`);
            if (essai < ESSAIS_MAX) await sommeil(ATTENTE_429_MS * essai);
        }
        return null;
    }
    const cles = [];
    let echecsDebit = 0, arret = false;
    for (const f of manifeste.fichiers) {
        if (arret) { cles.push({ cle: f.cleR2, statut: 'non-controle', raison: 'arrêt : échecs de débit' }); continue; }
        const url = `${base}/${f.cleR2}`;
        const res = { cle: f.cleR2, statut: 'ok' };
        const ko = raison => { res.statut = 'ko'; res.raison = raison; };
        try {   // une exception réseau (rejet, coupure, délai, flux) marque CETTE clé ko ; elle ne perd pas le rapport
        const g = await demander(url);
        if (!g) { res.statut = 'debit'; res.raison = '429 persistant'; }
        else {
            const h = k => g.headers.get(k);
            res.http = g.status;
            res.entetes = { contentType: h('content-type'), cacheControl: h('cache-control'), acceptRanges: h('accept-ranges'), cors: h('access-control-allow-origin') };
            if (g.status !== 200) ko(`GET ${g.status}`);
            else if (res.entetes.contentType !== f.contentType) ko(`Content-Type « ${res.entetes.contentType} » ≠ manifeste « ${f.contentType} »`);
            else if (res.entetes.cacheControl !== CACHE_CONTROL) ko(`Cache-Control « ${res.entetes.cacheControl} » ≠ « ${CACHE_CONTROL} »`);
            else {
                const corps = Buffer.from(await g.arrayBuffer());
                res.taille = corps.length; res.sha256 = sha256(corps);
                if (corps.length !== f.taille) ko(`taille publique ${corps.length} ≠ ${f.taille}`);
                else if (res.sha256 !== f.sha256) ko('sha256 publique différente');
            }
            if (res.statut === 'ok' && estVideo(f.contentType)) {
                const r = await demander(url, { Range: 'bytes=0-1023' });
                if (!r) { res.statut = 'debit'; res.raison = '429 persistant (Range)'; }
                else {
                    res.range = { status: r.status, contentRange: r.headers.get('content-range'), acceptRanges: r.headers.get('accept-ranges') };
                    if (r.status !== 206) ko(`Range : ${r.status} rendu, 206 attendu`);
                    else if (!res.range.contentRange) ko('Range : Content-Range absent');
                }
            }
        }
        } catch (e) { ko(`erreur réseau : ${e && e.name === 'TimeoutError' ? 'délai dépassé (' + DELAI_REQUETE_MS + ' ms)' : (e && e.message || e)}`); }
        if (res.statut === 'debit') { echecsDebit++; if (echecsDebit >= ECHECS_DEBIT_ARRET) arret = true; }
        else echecsDebit = 0;
        cles.push(res);
    }
    const ok = cles.filter(c => c.statut === 'ok').length;
    const v = cles.find(c => c.entetes && estVideo(manifeste.fichiers.find(f => f.cleR2 === c.cle).contentType));
    return {
        base, genere: new Date().toISOString(), total: n, ok, arret,
        entetesVideo: v ? { cle: v.cle, ...v.entetes } : null,
        cles
    };
}

// ---------- main ----------
async function main(argv, env = process.env, deps = {}) {
    const log = deps.log || (l => console.log(l));
    let a = null;
    try {
        a = lireArgs(argv);                             // refus avant toute connexion
        const mf = path.resolve(a.manifeste);
        let bucket = null, base = null;
        if (a.mode === 'ecrire') {
            bucket = env.R2_BUCKET_IMAGES;
            if (!bucket) throw new Error('R2_BUCKET_IMAGES absente (seul bucket admis)');
        }
        if (a.mode === 'controler') base = baseHttps(env);
        const manifeste = JSON.parse(fs.readFileSync(mf, 'utf8'));
        const dossier = path.dirname(mf);
        if (a.mode === 'plan') {
            const n = preparer(manifeste, a.attendu, { dossier });
            log(`PLAN : ${n} fichiers valides, locaux conformes (taille + sha256), préfixe ${manifeste.prefixeR2}. Aucun réseau.`);
            return 0;
        }
        if (a.mode === 'ecrire') {
            preparer(manifeste, a.attendu, { dossier });   // tout ou rien : avant même la connexion
            const verifierBucket = deps.verifierBucket || require('./collecte-cartes/r2').verifierBucket;
            const creerClient = deps.creerClient || require('./collecte-cartes/r2').clientPour;
            const endpoint = await verifierBucket(bucket);
            const s3 = creerClient(endpoint);
            const r = await deposer({ manifeste, attendu: a.attendu, s3, bucket, dossier, log });
            log(`DÉPÔT : ${r.deposes} déposés, ${r.dejaLa} deja-la, sur ${r.total}.`);
            return 0;
        }
        const f = deps.fetch || globalThis.fetch;
        const sommeil = deps.sommeil || (ms => new Promise(r => setTimeout(r, ms)));
        const rap = await controler({ manifeste, attendu: a.attendu, base, fetch: f, sommeil, log });
        fs.writeFileSync(path.resolve(a.rapport), JSON.stringify(rap, null, 2));
        log(`CONTRÔLE : ${rap.ok}/${rap.total} ok${rap.arret ? ' — ARRÊT (débit)' : ''}. Rapport : ${a.rapport}`);
        return rap.ok === rap.total ? 0 : 1;
    } catch (e) {
        log(`🔴 ${e.message}`);
        // le rapport s'écrit dans TOUS les cas du contrôle, y compris quand tout a échoué avant la première requête
        if (a && a.mode === 'controler' && a.rapport) {
            try { fs.writeFileSync(path.resolve(a.rapport), JSON.stringify({ base: env.R2_IMAGES_BASE_URL || null, genere: new Date().toISOString(), total: null, ok: 0, arret: false, erreur: e.message, entetesVideo: null, cles: [] }, null, 2)); }
            catch (e2) { log(`🔴 rapport non écrit : ${e2.message}`); }
        }
        return 1;
    }
}

module.exports = { lireArgs, validerManifeste, verifierLocaux, deposer, controler, baseHttps, main, PREFIXE_FILM, CACHE_CONTROL };

if (require.main === module) {
    require('dotenv').config({ path: path.join(__dirname, '.env') });   // lanceur seulement : les bancs injectent leur environnement
    main(process.argv.slice(2)).then(c => process.exit(c));
}
