'use strict';
// Aide commune des bancs GALERIE. Une seule base de banc EN MÉMOIRE (mongodb-memory-server, jamais une grappe réelle), deux bases sur ce même mongod :
//   · `test_scratch` (préfixée, comme tous les bancs v2) pour l'identité (comptes, sessions) ;
//   · `rm_galerie_essai` pour la Communauté — le nom exact de la base dédiée, pour que le banc voie ce que la production verrait.
// Un faux R2 en mémoire (mêmes gardes de clé que le vrai : tout sous `galerie/`), un faux Turnstile qui imite les clés de TEST de Cloudflare sans aucune requête réseau, un serveur Express.
// Aucun appel réseau, aucun dossier du testeur, aucune ressource externe.
const H = require('./_harnais');
const path = require('path'), fs = require('fs'), Module = require('module');

const ENV_VALIDE = Object.freeze({
    MONGODB_URI: 'mongodb+srv://u:p@cluster0.prodxx.mongodb.net/', MONGODB_CARTES_URI: 'mongodb+srv://u:p@cluster0.cartes1.mongodb.net/', MONGODB_ESSAI_URI: 'mongodb+srv://u:p@cluster0.essai11.mongodb.net/',
    V2_GALERIE: '1', MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.dedie11.mongodb.net/', V2_GALERIE_GRAPPE: 'dedie11.mongodb.net',
    V2_GALERIE_R2_COMPTE: 'abcdef0123456789abcdef0123456789', V2_GALERIE_R2_CLE_ID: 'cle-id-essai', V2_GALERIE_R2_SECRET: 'secret-essai-r2', V2_GALERIE_R2_BUCKET: 'rm-galerie-essai',
    V2_GALERIE_R2_URL_PUBLIQUE: 'https://pub.galerie-essai.test', V2_GALERIE_TURNSTILE_SECRET: 'secret-turnstile-essai', R2_BUCKET_IMAGES: 'rat-market-images'
});

function fauxStockage({ bucket = 'rm-galerie-essai', urlPublique = 'https://pub.galerie-essai.test', tropLourd = null } = {}) {
    const R2 = require('../galerie/r2');
    const objets = new Map(), journal = [];
    const s = {
        bucket, urlPublique, origineEcriture: 'https://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com', objets, journal, panneCopie: false,
        presignerDepot({ cle, type, octets, expire }) { R2.exigerCle(cle); journal.push(['presigner-depot', cle, type, octets, expire]); return `${s.origineEcriture}/${bucket}/${cle}?X-Amz-Expires=${expire}&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost&X-Amz-Signature=faux`; },
        presignerLecture({ cle, expire }) { R2.exigerCle(cle); return `${s.origineEcriture}/${bucket}/${cle}?X-Amz-Expires=${expire}&X-Amz-Signature=faux`; },
        async tete(cle) { R2.exigerCle(cle); const o = objets.get(cle); return o ? { octets: o.length } : null; },
        async lire(cle, max) { R2.exigerCle(cle); const o = objets.get(cle); if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }); if (o.length > max) throw Object.assign(new Error('trop-lourd'), { code: 'TROP_LOURD' }); return Buffer.from(o); },
        async ecrire(cle, buffer, type) { R2.exigerCle(cle); journal.push(['ecrire', cle, type]); objets.set(cle, Buffer.from(buffer)); },
        async copier(de, vers) { R2.exigerCle(de); R2.exigerCle(vers); if (s.panneCopie) throw new Error('panne R2'); journal.push(['copier', de, vers]); objets.set(vers, Buffer.from(objets.get(de))); },
        async supprimer(cle) { R2.exigerCle(cle); journal.push(['supprimer', cle]); objets.delete(cle); },
        /** Le client qui fait son PUT sur l'URL présignée : l'objet apparaît sous la clé de l'URL. */
        deposer(urlDepot, buffer) { const u = new URL(urlDepot); const cle = decodeURIComponent(u.pathname).replace(`/${bucket}/`, ''); objets.set(cle, Buffer.from(buffer)); return cle; }
    };
    return s;
}
/** Un faux `fetch` qui répond comme siteverify avec les clés de TEST : le jeton « jeton-valide » passe, tout autre est refusé ; un secret différent de celui attendu est refusé. Aucun réseau. */
function fauxTurnstile({ secretAttendu = 'secret-turnstile-essai', panne = false } = {}) {
    const f = async (url, init) => {
        f.appels.push({ url: String(url), methode: init && init.method, corps: String(init && init.body), redirect: init && init.redirect });
        if (panne) throw new Error('réseau coupé');
        const p = new URLSearchParams(String(init.body));
        return { ok: true, json: async () => ({ success: p.get('response') === 'jeton-valide' && p.get('secret') === secretAttendu }) };
    };
    f.appels = [];
    return f;
}
/** Charge une COPIE MUTÉE d'un module de v2/galerie : le texte, un fragment remplacé, compilé en mémoire à la place du vrai (jamais le fichier). Le fragment doit exister (sinon le mutant ne mordrait sur rien). */
function charger(rel, remplacements) {
    const f = path.join(__dirname, '..', 'galerie', rel); let src = fs.readFileSync(f, 'utf8');
    for (const [a, b] of remplacements) { if (!src.includes(a)) throw new Error(`mutant : fragment absent de ${rel} : ${a}`); src = src.split(a).join(b); }
    const m = new Module(f, module); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); m._compile(src, f); return m.exports;
}
module.exports = { ENV_VALIDE, fauxStockage, fauxTurnstile, charger, H };
