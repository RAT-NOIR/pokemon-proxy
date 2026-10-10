'use strict';
// B6.2 — stockage privé du banc réel et image sans métadonnées. Aucun réseau, aucun vrai R2 : faux client qui enregistre.
// Ruling 2026-10-10 : le bucket vient de V2_BANC_BUCKET (jamais R2_BUCKET_BANC, réservé aux bancs de test).
const sharp = require('sharp');
const H = require('./_harnais');
const { traiterImage, creerStockage, creerStockageMemoire, creerStockageReel, nouvelleCle } = require('../banc/stockage');

const BUCKET = 'bucket-banc-test';
function fauxClient() {
    const commandes = [];
    return {
        commandes,
        async deposerBinaire(bucket, cle, buf, ct) { if (bucket !== BUCKET) throw new Error('mauvais bucket ' + bucket); commandes.push({ op: 'put', bucket, cle, octets: buf.length, ct }); return { ecrit: true, cle }; },
        async supprimer(bucket, cles) { if (bucket !== BUCKET) throw new Error('mauvais bucket ' + bucket); commandes.push({ op: 'del', bucket, cles }); return cles.length; },
    };
}
const jpeg = (w, h, exif) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .withExif(exif || {}).jpeg().toBuffer();
const refuse = async (p) => { try { await p; return 'accepté'; } catch (e) { return e && e.code; } };

(async () => {
    // (5) / ruling : fail-closed d'abord
    const env0 = { R2_BUCKET_IMAGES: 'img-pub', R2_BUCKET_BRUT: 'brut', R2_BUCKET_BANC: 'banc-tests' };
    const lever = (bucket, env) => { try { creerStockage({ client: fauxClient(), bucket, env }); return 'ouvert'; } catch (e) { return 'refus'; } };
    H.v('V2_BANC_BUCKET absente : le stockage refuse (fail-closed)', lever(BUCKET, env0), 'refus');
    H.v('V2_BANC_BUCKET vide : refuse', lever(BUCKET, { ...env0, V2_BANC_BUCKET: '' }), 'refus');
    const env = { ...env0, V2_BANC_BUCKET: BUCKET };
    H.v('bucket = R2_BUCKET_IMAGES / R2_BUCKET_BRUT / R2_BUCKET_BANC : refusé', [lever('img-pub', env), lever('brut', env), lever('banc-tests', env)], ['refus', 'refus', 'refus']);
    H.v('V2_BANC_BUCKET mal réglée sur le bucket public : refusé quand même', lever('img-pub', { ...env0, V2_BANC_BUCKET: 'img-pub' }), 'refus');
    H.v('bucket différent de V2_BANC_BUCKET : refusé', lever('autre', env), 'refus');
    H.v('bucket non-texte : refusé', [lever(undefined, env), lever(42, env)], ['refus', 'refus']);
    H.v('bucket exactement V2_BANC_BUCKET : ouvert', lever(BUCKET, env), 'ouvert');
    let reel = 'ouvert'; try { creerStockageReel(env0); } catch { reel = 'refus'; }
    H.v('creerStockageReel sans V2_BANC_BUCKET : refuse avant tout chargement de client', reel, 'refus');

    // (1) EXIF
    const entree = await jpeg(640, 894, { IFD0: { Make: 'AppareilTest', Software: 'LogicielTest' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 51/1 0/1' } });
    H.vrai('l\'entrée porte bien un EXIF (le test peut échouer)', !!(await sharp(entree).metadata()).exif);
    const r = await traiterImage(entree);
    const m = await sharp(r.buffer).metadata();
    H.v('sortie WebP', m.format, 'webp');
    H.v('sans exif, icc, xmp', [!!m.exif, !!m.icc, !!m.xmpAsString || !!m.xmp], [false, false, false]);
    H.vrai('aucune trace de texte EXIF dans les octets', !r.buffer.includes('AppareilTest') && !r.buffer.includes('Exif'));
    H.v('dimensions 640×894', [r.w, r.h, m.width, m.height], [640, 894, 640, 894]);
    // (2)
    const proche = await traiterImage(await jpeg(600, 850));
    H.v('600×850 (±10 %) normalisée à 640×894', [proche.w, proche.h], [640, 894]);
    H.v('4000×3000 (photo entière) : image-refusee', await refuse(traiterImage(await jpeg(4000, 3000))), 'image-refusee');
    H.v('hors tolérance (500×700, 800×1100) : refusées', [await refuse(traiterImage(await jpeg(500, 700))), await refuse(traiterImage(await jpeg(800, 1100)))], ['image-refusee', 'image-refusee']);
    // (3)
    const gros = Buffer.concat([entree, Buffer.alloc(5 * 1024 * 1024)]);
    H.v('non image / tronquée / > 5 Mo / non-Buffer / vide : image-refusee, pas une autre erreur',
        [await refuse(traiterImage(Buffer.from('pas une image'))), await refuse(traiterImage(entree.subarray(0, 200))), await refuse(traiterImage(gros)),
            await refuse(traiterImage('texte')), await refuse(traiterImage(null)), await refuse(traiterImage(Buffer.alloc(0)))], Array(6).fill('image-refusee'));
    // (4) clé
    const cles = new Set(Array.from({ length: 50 }, () => nouvelleCle()));
    H.vrai('clé banc-reel/v2/<hex aléatoire>.webp, 50 tirages distincts', [...cles].every(c => /^banc-reel\/v2\/[0-9a-f]{32}\.webp$/.test(c)) && cles.size === 50);
    // (6) faux client
    const fc = fauxClient(), st = creerStockage({ client: fc, bucket: BUCKET, env });
    const cle = nouvelleCle();
    await st.ecrire(cle, r.buffer); await st.supprimer(cle);
    H.v('écriture puis suppression : deux commandes, sur le bucket du banc', fc.commandes.map(c => [c.op, c.bucket]), [['put', BUCKET], ['del', BUCKET]]);
    H.v('type de contenu image/webp', fc.commandes[0].ct, 'image/webp');
    H.v('clé hors banc-reel/v2/ : écriture refusée, rien enregistré', [await refuse(st.ecrire('bulba/1/2.wikitext', r.buffer)), await refuse(st.ecrire('banc-reel/v2/../x.webp', r.buffer)), fc.commandes.length], ['cle-refusee', 'cle-refusee', 2]);
    H.v('écriture non-Buffer refusée', await refuse(st.ecrire(nouvelleCle(), 'texte')), 'cle-refusee');
    // mémoire
    const mem = creerStockageMemoire(); const k = nouvelleCle();
    await mem.ecrire(k, r.buffer); const avant = mem.cles();
    await mem.supprimer(k);
    H.v('stockage mémoire : écrit puis supprimé', [avant, mem.cles()], [[k], []]);
    H.bilan();
})();
