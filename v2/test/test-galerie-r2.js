'use strict';
// GALERIE — le stockage R2 : la configuration (bucket DÉDIÉ), les clés (tout sous galerie/), le présigneur (SigV4) et la garde des bancs. Aucun réseau, aucune ressource réelle.
// Le présigneur est écrit ici (le dépôt n'a pas @aws-sdk/s3-request-presigner) : il est confronté (1) au vecteur OFFICIEL d'AWS et (2) à @smithy/signature-v4, la bibliothèque qui signe pour le SDK.
const { ENV_VALIDE, charger, H } = require('./_aide-galerie');
const crypto = require('crypto');
const R2 = require('../galerie/r2');
const avec = (c) => { const e = { ...ENV_VALIDE, ...c }; for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]; return e; };

(async () => {
    // ═══ 1. le vecteur officiel d'AWS (https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html) ═══
    const vecteur = R2.presigner({ methode: 'GET', hote: 'examplebucket.s3.amazonaws.com', chemin: '/test.txt', expire: 86400, cleId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', maintenant: new Date('2013-05-24T00:00:00Z') });
    H.v('1. le vecteur officiel d\'AWS (GET, hôte seul signé) : la signature est celle de la documentation', new URL(vecteur).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');

    // ═══ 2. confrontation à @smithy/signature-v4 : un PUT présigné avec Content-Type et Content-Length SIGNÉS, sur R2 (région auto, style chemin) ═══
    {
        const { SignatureV4 } = require('@smithy/signature-v4');
        class Sha256 { constructor(secret) { this.h = secret ? crypto.createHmac('sha256', secret) : crypto.createHash('sha256'); } update(d) { this.h.update(typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d.buffer ? d : d)); } digest() { return Promise.resolve(new Uint8Array(this.h.digest())); } reset() { } }
        const hote = 'abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com', cle = 'galerie/depot/0123456789abcdef/AbCdEfGhIjKlMnOpQrStUv', date = new Date('2026-11-01T10:00:00Z');
        const nous = new URL(R2.presigner({ methode: 'PUT', hote, chemin: `/rm-galerie-essai/${cle}`, entetes: { 'content-type': 'image/webp', 'content-length': 123456 }, expire: 300, cleId: 'cle-id-essai', secret: 'secret-essai-r2', maintenant: date }));
        const signeur = new SignatureV4({ credentials: { accessKeyId: 'cle-id-essai', secretAccessKey: 'secret-essai-r2' }, region: 'auto', service: 's3', sha256: Sha256, uriEscapePath: false });
        const requete = { method: 'PUT', protocol: 'https:', hostname: hote, path: `/rm-galerie-essai/${cle}`, query: {}, body: {}, headers: { host: hote, 'content-type': 'image/webp', 'content-length': '123456' } };
        const biblio = await signeur.presign(requete, { expiresIn: 300, signingDate: date, signableHeaders: new Set(['content-type', 'content-length']), unhoistableHeaders: new Set(['content-type', 'content-length']), unsignableHeaders: new Set() });
        const q = biblio.query || {};
        H.v('2. contre @smithy/signature-v4 : la même signature, la même portée, les mêmes en-têtes signés, la même durée', [nous.searchParams.get('X-Amz-Signature'), nous.searchParams.get('X-Amz-SignedHeaders'), nous.searchParams.get('X-Amz-Credential'), nous.searchParams.get('X-Amz-Expires')],
            [q['X-Amz-Signature'], q['X-Amz-SignedHeaders'], q['X-Amz-Credential'], q['X-Amz-Expires']]);
        H.vrai('   l\'URL est en style chemin sur l\'hôte R2, https, avec Content-Type et Content-Length SIGNÉS (content-length;content-type;host)', nous.protocol === 'https:' && nous.host === hote && nous.pathname === `/rm-galerie-essai/${cle}` && nous.searchParams.get('X-Amz-SignedHeaders') === 'content-length;content-type;host');
        // la signature MORD : changer la taille déclarée, le type ou la clé change la signature
        const autre = (c) => new URL(R2.presigner({ methode: 'PUT', hote, chemin: `/rm-galerie-essai/${c.cle || cle}`, entetes: { 'content-type': c.type || 'image/webp', 'content-length': c.octets || 123456 }, expire: 300, cleId: 'cle-id-essai', secret: 'secret-essai-r2', maintenant: date })).searchParams.get('X-Amz-Signature');
        H.v('   changer la taille, le type ou la clé change la signature (les trois sont signés)', [autre({ octets: 123457 }), autre({ type: 'image/png' }), autre({ cle: `${cle}x` })].map(s => s !== nous.searchParams.get('X-Amz-Signature')), [true, true, true]);
    }
    H.vrai('   une durée hors de 1…604800 s est refusée', (() => { try { R2.presigner({ methode: 'GET', hote: 'h.test', chemin: '/b/k', expire: 0, cleId: 'a', secret: 'b' }); return false; } catch { return true; } })());

    // ═══ 3. les clés : tout sous galerie/ ═══
    for (const ok of ['galerie/depot/ab12/Cd34', 'galerie/attente/AbC_d-1.webp', 'galerie/pub/x/y-480.webp']) H.vrai(`3. clé admise : ${ok}`, R2.cleValide(ok));
    for (const mauvais of ['depot/ab/cd', 'prive/ab/cd', '/galerie/x', 'galerie/', 'galerie/../vignettes/x', 'galerie//x', 'galerie/x y', 'galerie/é', 'Galerie/x', '', null, undefined, 42, `galerie/${'a'.repeat(300)}`])
        H.vrai(`   clé REFUSÉE : ${String(mauvais).slice(0, 30)}`, !R2.cleValide(mauvais));
    {   // le stockage réel refuse toute clé hors du préfixe AVANT toute commande, et n'émet aucune commande pour elle
        const envoyees = [];
        const faux = { send: async (c) => { envoyees.push(c.constructor.name + ':' + c.input.Key); return { ContentLength: 3, Body: (async function* () { yield Buffer.from('abc'); })() }; } };
        const c = R2.lireConfigR2(ENV_VALIDE).c, st = R2.creerStockage(c, { env: ENV_VALIDE, client: faux });
        let refus = 0; for (const f of [() => st.tete('prive/x'), () => st.lire('depot/x', 10), () => st.ecrire('autre/x', Buffer.from('a'), 'image/webp'), () => st.supprimer('../galerie/x'), () => st.copier('galerie/a', 'pub/b')]) { try { await f(); } catch (e) { refus++; } }
        H.v('   le stockage réel : 5 clés hors préfixe, 5 refus, ZÉRO commande envoyée', [refus, envoyees.length], [5, 0]);
        await st.ecrire('galerie/attente/x.webp', Buffer.from('a'), 'image/webp'); await st.tete('galerie/attente/x.webp'); await st.supprimer('galerie/attente/x.webp');
        H.v('   et une clé sous galerie/ part bien, vers le bucket dédié (jamais un autre)', envoyees, ['PutObjectCommand:galerie/attente/x.webp', 'HeadObjectCommand:galerie/attente/x.webp', 'DeleteObjectCommand:galerie/attente/x.webp']);
    }

    // ═══ 4. la configuration : un bucket DÉDIÉ ═══
    H.vrai('4. configuration complète : admise, avec l\'origine d\'écriture R2 et l\'adresse publique sans barre finale', (c => c.ok && c.c.endpoint === 'https://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com' && c.c.urlPublique === 'https://pub.galerie-essai.test')(R2.lireConfigR2(ENV_VALIDE)));
    H.vrai('   juridiction UE : un endpoint *.eu.r2.cloudflarestorage.com explicite est admis', R2.lireConfigR2(avec({ V2_GALERIE_R2_ENDPOINT: 'https://abcdef0123456789abcdef0123456789.eu.r2.cloudflarestorage.com' })).ok);
    const NON = [
        ['une variable absente (secret)', { V2_GALERIE_R2_SECRET: undefined }], ['une variable absente (bucket)', { V2_GALERIE_R2_BUCKET: undefined }], ['une variable absente (adresse publique)', { V2_GALERIE_R2_URL_PUBLIQUE: undefined }],
        ['bucket de production (R2_BUCKET_IMAGES)', { V2_GALERIE_R2_BUCKET: 'rat-market-images' }], ['bucket égal à R2_BUCKET_BANC', { R2_BUCKET_BANC: 'rm-galerie-essai' }],
        ['bucket égal à V2_VISUELS_R2_BUCKET', { V2_VISUELS_R2_BUCKET: 'rm-galerie-essai' }], ['bucket égal à n\'importe quelle autre variable *BUCKET*', { AUTRE_BUCKET_X: 'rm-galerie-essai' }],
        ['nom de bucket mal formé', { V2_GALERIE_R2_BUCKET: 'Mauvais Nom' }], ['endpoint http', { V2_GALERIE_R2_ENDPOINT: 'http://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com' }],
        ['endpoint qui n\'est pas R2', { V2_GALERIE_R2_ENDPOINT: 'https://exemple.test' }], ['endpoint avec un chemin', { V2_GALERIE_R2_ENDPOINT: 'https://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com/x' }],
        ['adresse publique http', { V2_GALERIE_R2_URL_PUBLIQUE: 'http://pub.galerie-essai.test' }], ['compte mal formé', { V2_GALERIE_R2_COMPTE: 'a b' }]
    ];
    for (const [nom, c] of NON) H.v(`   NON — ${nom}`, [R2.lireConfigR2(avec(c)).ok], [false]);
    H.vrai('   aucune raison de refus n\'imprime une valeur de variable', NON.every(([, c]) => { const r = R2.lireConfigR2(avec(c)).raison || ''; return !/secret-essai|cle-id-essai|rat-market-images/.test(r); }));
    { // mutant : sans la comparaison aux autres variables de bucket, le bucket de production passe
        const m = charger('r2.js', [['if (memeNom.length) return refus(', 'if (false) return refus('], ["if (bucketsDeProduction(env).includes(bucket)) return refus(", 'if (false) return refus(']]);
        H.v('   MUTANT « la comparaison aux buckets de production est retirée » : le réel refuse, le mutant admet', [R2.lireConfigR2(avec({ V2_GALERIE_R2_BUCKET: 'rat-market-images' })).ok, m.lireConfigR2(avec({ V2_GALERIE_R2_BUCKET: 'rat-market-images' })).ok], [false, true]);
        const m2 = charger('r2.js', [["return typeof cle === 'string' && FORME_CLE.test(cle) && !cle.includes('..') && !cle.includes('//');", 'return true;']]);
        H.v('   MUTANT « la garde de préfixe est retirée » : une clé hors galerie/ passerait', [R2.cleValide('prive/x'), m2.cleValide('prive/x')], [false, true]);
    }

    // ═══ 5. la garde des bancs : un présigneur appelle verifierEcritureR2 AVANT de signer (garde-banc.js) ═══
    {
        const c = R2.lireConfigR2(ENV_VALIDE).c;
        const banc = { ...ENV_VALIDE, BANC_ISOLE: '1' };
        const refus = (env) => { try { R2.creerStockage(c, { env, client: {} }).presignerDepot({ cle: 'galerie/depot/a/b', type: 'image/webp', octets: 10, expire: 300 }); return 'signe'; } catch (e) { return 'refus'; } };
        H.v('5. sous BANC_ISOLE=1 sans R2_BUCKET_BANC : la signature d\'une écriture est REFUSÉE', refus(banc), 'refus');
        H.v('   sous BANC_ISOLE=1 avec R2_BUCKET_BANC d\'un AUTRE bucket : refusée', refus({ ...banc, R2_BUCKET_BANC: 'autre-bucket' }), 'refus');
        H.v('   hors banc : signée', refus(ENV_VALIDE), 'signe');
        const m = charger('r2.js', [['const exigerEcritureAutorisee = () => {', 'const exigerEcritureAutorisee = () => { return;']]);
        H.v('   MUTANT « le présigneur n\'appelle plus verifierEcritureR2 » : sous banc il signerait', (() => { try { m.creerStockage(c, { env: banc, client: {} }).presignerDepot({ cle: 'galerie/depot/a/b', type: 'image/webp', octets: 10, expire: 300 }); return 'signe'; } catch { return 'refus'; } })(), 'signe');
    }
    H.bilan();
})();
