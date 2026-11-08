// Banc de deposer-film-r2.js : faux S3, faux fetch, faux sommeil. Aucun réseau, aucun R2, aucun dossier du testeur (dossier temporaire propre).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { S3Client } = require('@aws-sdk/client-s3');
const D = require('./deposer-film-r2.js');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const PRE = 'film/accueil/v7/';
const CC = 'public, max-age=31536000, immutable';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-r2-banc-'));
const contenus = { 'a.webm': Buffer.from('webm-contenu-aaa'), 'b.mp4': Buffer.from('mp4-contenu-bbbbbb'), 'c.avif': Buffer.from('avif-ccc') };
const types = { 'a.webm': 'video/webm', 'b.mp4': 'video/mp4', 'c.avif': 'image/avif' };
for (const [n, b] of Object.entries(contenus)) fs.writeFileSync(path.join(dir, n), b);
function manifeste(surcharge = {}) {
    return {
        prefixeR2: PRE,
        fichiers: Object.keys(contenus).map(n => ({ fichier: n, chemin: path.join(dir, n), cleR2: PRE + n, contentType: types[n], taille: contenus[n].length, sha256: sha(contenus[n]) })),
        ...surcharge
    };
}
const clone = m => JSON.parse(JSON.stringify(m));

// faux S3 : reconnaît les commandes par leur nom
function fauxS3(initial = {}) {
    const store = new Map(Object.entries(initial));
    const appels = [];
    return {
        store, appels,
        async send(cmd) {
            const nom = cmd.constructor.name, i = cmd.input;
            appels.push({ nom, input: i });
            if (nom === 'HeadObjectCommand') {
                const o = store.get(i.Key);
                if (!o) { const e = new Error('NotFound'); e.name = 'NotFound'; e.$metadata = { httpStatusCode: 404 }; throw e; }
                return { ContentLength: o.Body.length, ContentType: o.ContentType, Metadata: o.Metadata };
            }
            if (nom === 'GetObjectCommand') {
                const o = store.get(i.Key);
                return { Body: { transformToByteArray: async () => new Uint8Array(o.Body) } };
            }
            if (nom === 'PutObjectCommand') { store.set(i.Key, { Body: i.Body, ContentType: i.ContentType, CacheControl: i.CacheControl, Metadata: i.Metadata }); return {}; }
            throw new Error('commande inattendue ' + nom);
        }
    };
}
const ecritures = s3 => s3.appels.filter(a => a.nom === 'PutObjectCommand').length;

// faux fetch : serveur public simulé
function fauxFetch({ corps = contenus, base = 'https://img.test/', rep429 = {}, sans206 = false, tousLes429 = false, ctype = types } = {}) {
    const appels = [];
    const f = async (url, opts = {}) => {
        appels.push({ url, range: opts.headers && opts.headers.Range });
        const cle = url.slice(base.length).slice(PRE.length);
        const b = corps[cle];
        const h = {};
        const rep = (status, body, extra = {}) => ({ status, headers: { get: k => (extra[k.toLowerCase()] ?? h[k.toLowerCase()] ?? null) }, arrayBuffer: async () => { const u = new Uint8Array(body); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); } });
        if (tousLes429 || (rep429[cle] || 0) > 0) { if (!tousLes429) rep429[cle]--; return rep(429, Buffer.alloc(0)); }
        if (!b) return rep(404, Buffer.alloc(0));
        Object.assign(h, { 'content-type': ctype[cle], 'cache-control': CC, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' });
        if (opts.headers && opts.headers.Range && !sans206) return rep(206, b.subarray(0, 1024), { 'content-range': `bytes 0-${Math.min(1023, b.length - 1)}/${b.length}` });
        return rep(200, b);
    };
    f.appels = appels;
    return f;
}
const fauxSommeil = () => { const a = []; const s = async ms => { a.push(ms); }; s.appels = a; return s; };

const tests = [];
const t = (nom, fn) => tests.push([nom, fn]);

// ---------- CLI ----------
t('CLI : argument inconnu refusé', () => assert.throws(() => D.lireArgs(['--manifeste=x', '--force']), /inconnu/));
t('CLI : option inconnue avec valeur refusée', () => assert.throws(() => D.lireArgs(['--manifeste=x', '--ecraser=1']), /inconnu/));
t('CLI : argument nu refusé', () => assert.throws(() => D.lireArgs(['--manifeste=x', 'truc']), /inconnu/));
t('CLI : --ecrire sans --attendu refusé', () => assert.throws(() => D.lireArgs(['--manifeste=x', '--ecrire']), /attendu/));
t('CLI : --attendu non entier refusé', () => assert.throws(() => D.lireArgs(['--manifeste=x', '--ecrire', '--attendu=abc']), /attendu/));
t('CLI : --controler sans --rapport refusé', () => assert.throws(() => D.lireArgs(['--manifeste=x', '--controler', '--attendu=3']), /rapport/));
t('CLI : --ecrire et --controler ensemble refusés', () => assert.throws(() => D.lireArgs(['--manifeste=x', '--ecrire', '--controler', '--attendu=3', '--rapport=r.json']), /ensemble|exclusi/));
t('CLI : --manifeste obligatoire', () => assert.throws(() => D.lireArgs(['--ecrire']), /manifeste/));
t('CLI : plan valide', () => assert.deepStrictEqual(D.lireArgs(['--manifeste=x.json']).mode, 'plan'));
t('CLI : argument inconnu = refus AVANT toute connexion (main)', async () => {
    let connecte = 0;
    const code = await D.main(['--manifeste=x', '--bidule'], {}, { verifierBucket: async () => { connecte++; }, log() {} });
    assert.strictEqual(code, 1); assert.strictEqual(connecte, 0);
});

// ---------- garde 1 : validation du manifeste ----------
t('garde 1 : manifeste nominal accepté', () => D.validerManifeste(manifeste()));
t('garde 1 : clé hors préfixe film/accueil/v7/', () => { const m = clone(manifeste()); m.fichiers[0].cleR2 = 'film/accueil/v6/a.webm'; assert.throws(() => D.validerManifeste(m), /préfixe|prefixe/); });
t('garde 1 : clé hors prefixeR2 du manifeste', () => { const m = clone(manifeste()); m.prefixeR2 = PRE + 'sous/'; assert.throws(() => D.validerManifeste(m), /préfixe|prefixe/); });
t('garde 1 : clés dupliquées', () => { const m = clone(manifeste()); m.fichiers[1].cleR2 = m.fichiers[0].cleR2; assert.throws(() => D.validerManifeste(m), /dupliqu|unique/); });
t('garde 1 : « .. » dans la clé', () => { const m = clone(manifeste()); m.fichiers[0].cleR2 = PRE + '../x.webm'; assert.throws(() => D.validerManifeste(m), /\.\./); });
t('garde 1 : contentType hors liste fermée', () => { const m = clone(manifeste()); m.fichiers[0].contentType = 'text/html'; assert.throws(() => D.validerManifeste(m), /contentType/); });
t('garde 1 : sha256 invalide', () => { const m = clone(manifeste()); m.fichiers[0].sha256 = 'xyz'; assert.throws(() => D.validerManifeste(m), /sha256/); });
t('garde 1 : sha256 majuscules refusé', () => { const m = clone(manifeste()); m.fichiers[0].sha256 = m.fichiers[0].sha256.toUpperCase(); assert.throws(() => D.validerManifeste(m), /sha256/); });
t('garde 1 : taille nulle', () => { const m = clone(manifeste()); m.fichiers[0].taille = 0; assert.throws(() => D.validerManifeste(m), /taille/); });
t('garde 1 : taille non entière', () => { const m = clone(manifeste()); m.fichiers[0].taille = 12.5; assert.throws(() => D.validerManifeste(m), /taille/); });
t('garde 1 : fichiers vide', () => assert.throws(() => D.validerManifeste({ prefixeR2: PRE, fichiers: [] }), /fichiers/));

// ---------- garde 3 : compte ----------
t('garde 3 : compte ≠ attendu, rien déposé', async () => {
    const s3 = fauxS3();
    await assert.rejects(D.deposer({ manifeste: manifeste(), attendu: 4, s3, bucket: 'b', fs }), /attendu/);
    assert.strictEqual(s3.appels.length, 0);
});

// ---------- garde 2 : fichiers locaux ----------
t('garde 2 : fichier local absent = rien déposé', async () => {
    const m = clone(manifeste()); m.fichiers[2].chemin = path.join(dir, 'absent.avif');
    const s3 = fauxS3();
    await assert.rejects(D.deposer({ manifeste: m, attendu: 3, s3, bucket: 'b', fs }), /absent|existe/);
    assert.strictEqual(s3.appels.length, 0);
});
t('garde 2 : taille locale différente = rien déposé', async () => {
    const m = clone(manifeste()); m.fichiers[1].taille += 1;
    const s3 = fauxS3();
    await assert.rejects(D.deposer({ manifeste: m, attendu: 3, s3, bucket: 'b', fs }), /taille/);
    assert.strictEqual(s3.appels.length, 0);
});
t('garde 2 : sha locale différente (dernier fichier) = 0 écriture même pour les premiers', async () => {
    const m = clone(manifeste()); m.fichiers[2].sha256 = '0'.repeat(64);
    const s3 = fauxS3();
    await assert.rejects(D.deposer({ manifeste: m, attendu: 3, s3, bucket: 'b', fs }), /sha256/);
    assert.strictEqual(ecritures(s3), 0);
});

// ---------- dépôt nominal + garde 5 ----------
t('dépôt nominal : 3 écrits, en-têtes exacts, sha en métadonnée', async () => {
    const s3 = fauxS3();
    const r = await D.deposer({ manifeste: manifeste(), attendu: 3, s3, bucket: 'bucket-images', fs });
    assert.deepStrictEqual([r.deposes, r.dejaLa, r.total], [3, 0, 3]);
    const puts = s3.appels.filter(a => a.nom === 'PutObjectCommand');
    assert.strictEqual(puts.length, 3);
    for (const p of puts) {
        assert.strictEqual(p.input.Bucket, 'bucket-images');
        assert.strictEqual(p.input.CacheControl, CC);
        assert.strictEqual(p.input.ContentType, types[p.input.Key.slice(PRE.length)]);
        assert.strictEqual(p.input.Metadata.sha256, sha(contenus[p.input.Key.slice(PRE.length)]));
        assert.ok(!('ACL' in p.input));
    }
});
t('dépôt : IfNoneMatch posé (jamais d’écrasement côté serveur)', async () => {
    const s3 = fauxS3();
    await D.deposer({ manifeste: manifeste(), attendu: 3, s3, bucket: 'b', fs });
    for (const p of s3.appels.filter(a => a.nom === 'PutObjectCommand')) assert.strictEqual(p.input.IfNoneMatch, '*');
});

// ---------- garde 4 : jamais d'écrasement ----------
t('garde 4 : clé présente identique (métadonnée) = deja-la, pas réécrite', async () => {
    const m = manifeste();
    const s3 = fauxS3({ [PRE + 'a.webm']: { Body: contenus['a.webm'], ContentType: 'video/webm', Metadata: { sha256: sha(contenus['a.webm']) } } });
    const r = await D.deposer({ manifeste: m, attendu: 3, s3, bucket: 'b', fs });
    assert.deepStrictEqual([r.deposes, r.dejaLa], [2, 1]);
    assert.strictEqual(ecritures(s3), 2);
});
t('garde 4 : présente sans métadonnée, même taille, sha relue identique = deja-la', async () => {
    const s3 = fauxS3({ [PRE + 'c.avif']: { Body: contenus['c.avif'], ContentType: 'image/avif' } });
    const r = await D.deposer({ manifeste: manifeste(), attendu: 3, s3, bucket: 'b', fs });
    assert.deepStrictEqual([r.deposes, r.dejaLa], [2, 1]);
});
t('garde 4 : présente, même taille, contenu différent (sha relue) = ARRÊT, 0 écriture', async () => {
    const autre = Buffer.alloc(contenus['c.avif'].length, 'z');
    const s3 = fauxS3({ [PRE + 'c.avif']: { Body: autre, ContentType: 'image/avif' } });
    await assert.rejects(D.deposer({ manifeste: manifeste(), attendu: 3, s3, bucket: 'b', fs }), /différent|differ/);
    assert.strictEqual(ecritures(s3), 0);
});
t('garde 4 : présente, taille différente = ARRÊT, 0 écriture (même pour les clés absentes)', async () => {
    const s3 = fauxS3({ [PRE + 'b.mp4']: { Body: Buffer.from('court'), ContentType: 'video/mp4', Metadata: { sha256: 'a'.repeat(64) } } });
    await assert.rejects(D.deposer({ manifeste: manifeste(), attendu: 3, s3, bucket: 'b', fs }), /différent|differ/);
    assert.strictEqual(ecritures(s3), 0);
});
t('garde 4 : métadonnée sha différente = ARRÊT', async () => {
    const s3 = fauxS3({ [PRE + 'a.webm']: { Body: contenus['a.webm'], ContentType: 'video/webm', Metadata: { sha256: 'b'.repeat(64) } } });
    await assert.rejects(D.deposer({ manifeste: manifeste(), attendu: 3, s3, bucket: 'b', fs }), /différent|differ/);
    assert.strictEqual(ecritures(s3), 0);
});
t('garde 4 : aucune option d’écrasement (lireArgs et deposer l’ignorent)', async () => {
    assert.throws(() => D.lireArgs(['--manifeste=x', '--ecrire', '--attendu=3', '--ecraser']), /inconnu/);
    const s3 = fauxS3({ [PRE + 'a.webm']: { Body: Buffer.from('autre'), ContentType: 'video/webm' } });
    await assert.rejects(D.deposer({ manifeste: manifeste(), attendu: 3, s3, bucket: 'b', fs, ecraser: true }), /différent|differ/);
    assert.strictEqual(ecritures(s3), 0);
});
t('garde 4 : erreur S3 autre que 404 au Head = arrêt, 0 écriture', async () => {
    const s3 = fauxS3(); const o = s3.send.bind(s3);
    s3.send = async c => { if (c.constructor.name === 'HeadObjectCommand') { const e = new Error('boom'); e.$metadata = { httpStatusCode: 500 }; throw e; } return o(c); };
    await assert.rejects(D.deposer({ manifeste: manifeste(), attendu: 3, s3, bucket: 'b', fs }), /boom/);
    assert.strictEqual(ecritures(s3), 0);
});

// ---------- garde 6 : bucket et base ----------
t('garde 6 : R2_BUCKET_IMAGES absent = refus avant connexion', async () => {
    let connecte = 0;
    const mf = path.join(dir, 'm.json'); fs.writeFileSync(mf, JSON.stringify(manifeste()));
    const code = await D.main([`--manifeste=${mf}`, '--ecrire', '--attendu=3'], {}, { verifierBucket: async () => { connecte++; }, log() {} });
    assert.strictEqual(code, 1); assert.strictEqual(connecte, 0);
});
t('garde 6 : bucket pris UNIQUEMENT dans R2_BUCKET_IMAGES (R2_BUCKET_BRUT ignoré)', async () => {
    const mf = path.join(dir, 'm.json'); fs.writeFileSync(mf, JSON.stringify(manifeste()));
    let vu = null; const s3 = fauxS3();
    const code = await D.main([`--manifeste=${mf}`, '--ecrire', '--attendu=3'], { R2_BUCKET_IMAGES: 'img', R2_BUCKET_BRUT: 'brut' }, { verifierBucket: async b => { vu = b; }, creerClient: () => s3, log() {} });
    assert.strictEqual(code, 0); assert.strictEqual(vu, 'img');
    assert.ok(s3.appels.every(a => a.input.Bucket === 'img'));
});
t('garde 6 : verifierBucket qui échoue = rien d’écrit, code 1', async () => {
    const mf = path.join(dir, 'm.json'); fs.writeFileSync(mf, JSON.stringify(manifeste()));
    const s3 = fauxS3();
    const code = await D.main([`--manifeste=${mf}`, '--ecrire', '--attendu=3'], { R2_BUCKET_IMAGES: 'img' }, { verifierBucket: async () => { throw new Error('AccessDenied'); }, creerClient: () => s3, log() {} });
    assert.strictEqual(code, 1); assert.strictEqual(s3.appels.length, 0);
});
t('garde 6 : base http refusée (contrôle) avant tout fetch', async () => {
    const mf = path.join(dir, 'm.json'); fs.writeFileSync(mf, JSON.stringify(manifeste()));
    const f = fauxFetch();
    const code = await D.main([`--manifeste=${mf}`, '--controler', '--attendu=3', `--rapport=${path.join(dir, 'r.json')}`], { R2_IMAGES_BASE_URL: 'http://img.test' }, { fetch: f, sommeil: fauxSommeil(), log() {} });
    assert.strictEqual(code, 1); assert.strictEqual(f.appels.length, 0);
});
t('garde 6 : base absente refusée (contrôle)', async () => {
    const mf = path.join(dir, 'm.json'); fs.writeFileSync(mf, JSON.stringify(manifeste()));
    const f = fauxFetch();
    const code = await D.main([`--manifeste=${mf}`, '--controler', '--attendu=3', `--rapport=${path.join(dir, 'r.json')}`], {}, { fetch: f, sommeil: fauxSommeil(), log() {} });
    assert.strictEqual(code, 1); assert.strictEqual(f.appels.length, 0);
});
t('plan : sans réseau, sans variables, compte imprimé', async () => {
    const mf = path.join(dir, 'm.json'); fs.writeFileSync(mf, JSON.stringify(manifeste()));
    const lignes = [];
    const code = await D.main([`--manifeste=${mf}`], {}, { verifierBucket: async () => { throw new Error('réseau !'); }, fetch: () => { throw new Error('réseau !'); }, log: l => lignes.push(l) });
    assert.strictEqual(code, 0); assert.ok(lignes.join('\n').includes('3'));
});
t('plan : manifeste invalide = code 1', async () => {
    const m = clone(manifeste()); m.fichiers[0].cleR2 = 'autre/a.webm';
    const mf = path.join(dir, 'mbad.json'); fs.writeFileSync(mf, JSON.stringify(m));
    assert.strictEqual(await D.main([`--manifeste=${mf}`], {}, { log() {} }), 1);
});

// ---------- contrôle public ----------
const base = 'https://img.test';
t('contrôle nominal : 3/3 ok, Range 206 pour les 2 vidéos, rapport complet', async () => {
    const f = fauxFetch(); const so = fauxSommeil();
    const r = await D.controler({ manifeste: manifeste(), attendu: 3, base, fetch: f, sommeil: so });
    assert.strictEqual(r.ok, 3); assert.strictEqual(r.total, 3); assert.strictEqual(r.arret, false);
    assert.strictEqual(r.base, base);
    assert.strictEqual(f.appels.filter(a => a.range).length, 2);
    assert.ok(f.appels.every(a => a.url.startsWith(base + '/' + PRE)));
    const v = r.cles.find(c => c.cle.endsWith('.webm'));
    assert.strictEqual(v.range.status, 206); assert.ok(v.range.contentRange.startsWith('bytes 0-')); assert.strictEqual(v.range.acceptRanges, 'bytes');
    assert.strictEqual(r.entetesVideo.contentType, 'video/webm'); assert.strictEqual(r.entetesVideo.cacheControl, CC);
    assert.strictEqual(r.entetesVideo.acceptRanges, 'bytes'); assert.strictEqual(r.entetesVideo.cors, '*');
});
t('contrôle : au plus 2 requêtes par seconde (pause ≥ 500 ms entre requêtes)', async () => {
    const f = fauxFetch(); const so = fauxSommeil();
    await D.controler({ manifeste: manifeste(), attendu: 3, base, fetch: f, sommeil: so });
    assert.ok(so.appels.length >= f.appels.length - 1);
    assert.ok(so.appels.filter(ms => ms >= 500).length >= f.appels.length - 1);
});
t('contrôle : requêtes sérialisées (jamais deux en vol)', async () => {
    let enVol = 0, max = 0; const f0 = fauxFetch();
    const f = async (u, o) => { enVol++; max = Math.max(max, enVol); await new Promise(r => setImmediate(r)); const x = await f0(u, o); enVol--; return x; };
    await D.controler({ manifeste: manifeste(), attendu: 3, base, fetch: f, sommeil: fauxSommeil() });
    assert.strictEqual(max, 1);
});
t('contrôle : compte ≠ attendu, aucune requête', async () => {
    const f = fauxFetch();
    await assert.rejects(D.controler({ manifeste: manifeste(), attendu: 9, base, fetch: f, sommeil: fauxSommeil() }), /attendu/);
    assert.strictEqual(f.appels.length, 0);
});
t('contrôle : contenu public différent = ko', async () => {
    const f = fauxFetch({ corps: { ...contenus, 'c.avif': Buffer.from('avif-XXX') } });
    const r = await D.controler({ manifeste: manifeste(), attendu: 3, base, fetch: f, sommeil: fauxSommeil() });
    assert.strictEqual(r.ok, 2); assert.strictEqual(r.cles.find(c => c.cle.endsWith('.avif')).statut, 'ko');
});
t('contrôle : clé absente (404) = ko', async () => {
    const c2 = { ...contenus }; delete c2['b.mp4'];
    const r = await D.controler({ manifeste: manifeste(), attendu: 3, base, fetch: fauxFetch({ corps: c2 }), sommeil: fauxSommeil() });
    assert.strictEqual(r.ok, 2);
});
t('contrôle : Range sans 206 (200 rendu) = échec de la clé', async () => {
    const f = fauxFetch({ sans206: true });
    const r = await D.controler({ manifeste: manifeste(), attendu: 3, base, fetch: f, sommeil: fauxSommeil() });
    assert.strictEqual(r.ok, 1);   // seule l'image passe
    assert.strictEqual(r.cles.find(c => c.cle.endsWith('.webm')).statut, 'ko');
    assert.match(r.cles.find(c => c.cle.endsWith('.webm')).raison, /206|Range/);
});
t('contrôle : 429 puis reprise (attente ≥ 30 s, croissante)', async () => {
    const f = fauxFetch({ rep429: { 'a.webm': 2 } }); const so = fauxSommeil();
    const r = await D.controler({ manifeste: manifeste(), attendu: 3, base, fetch: f, sommeil: so });
    assert.strictEqual(r.ok, 3);
    const longues = so.appels.filter(ms => ms >= 30000);
    assert.strictEqual(longues.length, 2); assert.ok(longues[1] > longues[0]);
});
t('contrôle : 429 persistant = au plus 5 essais par clé', async () => {
    const f = fauxFetch({ rep429: { 'a.webm': 99 } });
    const r = await D.controler({ manifeste: manifeste(), attendu: 3, base, fetch: f, sommeil: fauxSommeil() });
    assert.strictEqual(f.appels.filter(a => a.url.endsWith('a.webm')).length, 5);
    assert.strictEqual(r.cles.find(c => c.cle.endsWith('a.webm')).statut, 'debit');
    assert.strictEqual(r.ok, 2);
});
t('contrôle : 3 clés de suite en échec de débit = arrêt propre, rapport', async () => {
    const mm = clone(manifeste()); // 3 fichiers + 2 de plus
    for (const n of ['d.avif', 'e.avif']) { const b = Buffer.from('x' + n); fs.writeFileSync(path.join(dir, n), b); mm.fichiers.push({ fichier: n, chemin: path.join(dir, n), cleR2: PRE + n, contentType: 'image/avif', taille: b.length, sha256: sha(b) }); }
    const f = fauxFetch({ tousLes429: true }); const so = fauxSommeil();
    const r = await D.controler({ manifeste: mm, attendu: 5, base, fetch: f, sommeil: so });
    assert.strictEqual(r.arret, true); assert.strictEqual(r.ok, 0); assert.strictEqual(r.total, 5);
    assert.strictEqual(f.appels.length, 15);   // 3 clés × 5 essais, puis rien
    assert.strictEqual(r.cles.filter(c => c.statut === 'debit').length, 3);
    assert.strictEqual(r.cles.filter(c => c.statut === 'non-controle').length, 2);
});
t('contrôle : un succès entre deux échecs de débit remet le compteur à zéro', async () => {
    const f = fauxFetch({ rep429: { 'a.webm': 99, 'c.avif': 99 } });
    const r = await D.controler({ manifeste: manifeste(), attendu: 3, base, fetch: f, sommeil: fauxSommeil() });
    assert.strictEqual(r.arret, false); assert.strictEqual(r.ok, 1);
});
t('main --controler : code 0 si tout ok, rapport écrit', async () => {
    const mf = path.join(dir, 'm.json'); fs.writeFileSync(mf, JSON.stringify(manifeste()));
    const rf = path.join(dir, 'r.json');
    const code = await D.main([`--manifeste=${mf}`, '--controler', '--attendu=3', `--rapport=${rf}`], { R2_IMAGES_BASE_URL: base + '/' }, { fetch: fauxFetch(), sommeil: fauxSommeil(), log() {} });
    assert.strictEqual(code, 0);
    const rap = JSON.parse(fs.readFileSync(rf, 'utf8'));
    assert.strictEqual(rap.ok, 3); assert.strictEqual(rap.total, 3); assert.strictEqual(rap.base, base);
});
t('main --controler : code 1 si un ko, rapport écrit quand même', async () => {
    const mf = path.join(dir, 'm.json'); fs.writeFileSync(mf, JSON.stringify(manifeste()));
    const rf = path.join(dir, 'r2.json');
    const code = await D.main([`--manifeste=${mf}`, '--controler', '--attendu=3', `--rapport=${rf}`], { R2_IMAGES_BASE_URL: base }, { fetch: fauxFetch({ sans206: true }), sommeil: fauxSommeil(), log() {} });
    assert.strictEqual(code, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(rf, 'utf8')).ok, 1);
});
t('main --ecrire : conflit = code 1, 0 écriture', async () => {
    const mf = path.join(dir, 'm.json'); fs.writeFileSync(mf, JSON.stringify(manifeste()));
    const s3 = fauxS3({ [PRE + 'a.webm']: { Body: Buffer.from('autre'), ContentType: 'video/webm' } });
    const code = await D.main([`--manifeste=${mf}`, '--ecrire', '--attendu=3'], { R2_BUCKET_IMAGES: 'img' }, { verifierBucket: async () => {}, creerClient: () => s3, log() {} });
    assert.strictEqual(code, 1); assert.strictEqual(ecritures(s3), 0);
});

(async () => {
    let ok = 0, ko = 0;
    for (const [nom, fn] of tests) {
        try { await fn(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  KO  ' + nom + '\n      ' + (e && e.message || e).split('\n')[0]); }
    }
    for (const n of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, n));
    fs.rmdirSync(dir);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
