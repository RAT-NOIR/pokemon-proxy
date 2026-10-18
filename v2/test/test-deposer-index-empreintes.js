'use strict';
// Banc INDEX-EMPREINTES — l'outil de DÉPÔT (outils/deposer-index-empreintes.js) : à blanc il n'ouvre aucun réseau ; il ne peut ni écraser ni supprimer ; il relit ce qu'il dépose. FAUX client S3, fichiers fabriqués, aucun secret réel.
const H = require('./_harnais');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { Readable } = require('stream');
const A = require('./_empreinte-aide');
const D = require('../../outils/deposer-index-empreintes');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'depot-idx-'));
const fichierIndex = path.join(dossier, 'index.rmei'), fichierModele = path.join(dossier, 'modele.onnx');
const octetsModele = crypto.randomBytes(200000); fs.writeFileSync(fichierModele, octetsModele);
const shaModele = crypto.createHash('sha256').update(octetsModele).digest('hex');
const MODELE = { id: 'p8000-poids8-banc', sha256: shaModele };
const scelle = require('../identifier/index-empreintes').sceller({ cles: ['banc/jeu-0.webp'], matrice: Float32Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)), contexte: { groupe: {}, carte: {}, invisibles: {}, produits: { 'banc/jeu-0.webp': [[1, 1]] } }, modele: MODELE, chargeLe: '2026-10-18T14:20:00.000Z' }, A.SECRET);
fs.writeFileSync(fichierIndex, scelle);
const ENV = { V2_VISUELS_R2_COMPTE: 'compte-banc', V2_VISUELS_R2_ECR_CLE_ID: 'cle-banc-00', V2_VISUELS_R2_ECR_SECRET: 'secret-banc-0000', V2_VISUELS_R2_BUCKET: 'bucket-banc', V2_VISUELS_HMAC: A.SECRET, V2_VISUELS_R2_OBJET: 'archive/en-place.rmv', V2_EMPREINTES_R2_OBJET: 'empreintes/en-place.rmei' };
const ARGS = { index: fichierIndex, modele: fichierModele, modeleId: MODELE.id, objetIndex: 'empreintes/index-neuf.rmei', objetModele: 'modeles/modele-neuf.onnx' };

function fauxR2(deja = {}) {
    const objets = { ...deja }, appels = [];
    return { objets, appels, async send(cmd) {
        const n = cmd.constructor.name, k = cmd.input.Key; appels.push(n); if (cmd.input.Body && cmd.input.Body.on) cmd.input.Body.on('error', () => { });
        if (n === 'HeadObjectCommand') { if (!objets[k]) throw Object.assign(new Error('x'), { name: 'NotFound' }); return { ContentLength: objets[k].corps.length, Metadata: objets[k].meta }; }
        if (n === 'PutObjectCommand') {
            if (cmd.input.IfNoneMatch !== '*') throw new Error('dépôt non conditionnel');
            if (objets[k]) { cmd.input.Body.destroy(); throw Object.assign(new Error('x'), { name: 'PreconditionFailed' }); }
            const m = []; for await (const c of cmd.input.Body) m.push(c); objets[k] = { corps: Buffer.concat(m), meta: cmd.input.Metadata }; return {};
        }
        if (n === 'GetObjectCommand') return { Body: Readable.from([objets[k].corps]) };
        throw new Error(`commande inattendue ${n} (aucune suppression, aucune autre écriture)`);
    } };
}
const rejette = async (f) => { try { await f(); return null; } catch (e) { return String(e.message); } };

(async () => {
    const plan = await D.preparer({ ...ARGS, env: ENV });
    H.v('1a. à blanc : le plan est calculé EN LOCAL (index ouvert avec le HMAC, sha256 du modèle)', [plan.index.n, plan.modele.sha256, plan.index.modele.sha256], [1, shaModele, shaModele]);
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'outils', 'deposer-index-empreintes.js'), '--index', fichierIndex, '--modele', fichierModele, '--modele-id', MODELE.id, '--objet-index', ARGS.objetIndex, '--objet-modele', ARGS.objetModele], { env: { ...process.env, ...ENV, HTTPS_PROXY: 'http://127.0.0.1:9' }, encoding: 'utf8' });
    H.vrai('1b. à blanc (sans --ecrire) : « À BLANC », code 0, le secret n\'est pas imprimé', r.status === 0 && /À BLANC/.test(r.stdout) && !r.stdout.includes(A.SECRET) && !r.stderr.includes(A.SECRET));
    H.vrai('1c. à blanc : l\'outil ne crée aucun client (le dépôt est une fonction à part, jamais appelée sans --ecrire)', !/relu/.test(r.stdout));
    // refus de nom, de variables, de fichier, de modèle
    H.vrai('2a. 🔑 un nom d\'objet égal à l\'archive en place est refusé', /EN PLACE/.test(await rejette(() => D.preparer({ ...ARGS, objetIndex: 'archive/en-place.rmv', env: ENV })) || ''));
    H.vrai('2b. un nom égal à l\'index en place est refusé', /EN PLACE/.test(await rejette(() => D.preparer({ ...ARGS, objetModele: 'empreintes/en-place.rmei', env: ENV })) || ''));
    H.vrai('2c. deux noms identiques refusés', /deux noms/.test(await rejette(() => D.preparer({ ...ARGS, objetModele: ARGS.objetIndex, env: ENV })) || ''));
    H.vrai('2d. variable d\'ÉCRITURE absente : l\'arrêt nomme la variable, jamais une valeur', /V2_VISUELS_R2_ECR_SECRET/.test(await rejette(() => D.preparer({ ...ARGS, env: { ...ENV, V2_VISUELS_R2_ECR_SECRET: '' } })) || ''));
    H.vrai('2e. un index scellé pour un AUTRE modèle que le fichier donné est refusé', !!(await rejette(() => D.preparer({ ...ARGS, modeleId: 'autre-id', env: ENV }))));
    H.vrai('2f. un index scellé avec un autre secret est refusé', !!(await rejette(() => D.preparer({ ...ARGS, env: { ...ENV, V2_VISUELS_HMAC: A.SECRET + 'x' } }))));
    // le dépôt
    const c = fauxR2(); const logs = [];
    const b = await D.deposer({ client: c, bucket: 'bucket-banc', plan, journal: m => logs.push(m) });
    H.v('3a. dépôt : deux objets NEUFS, relus identiques (taille + sha256 + métadonnée)', [b, Object.keys(c.objets).sort()], [{ index: true, modele: true }, [ARGS.objetIndex, ARGS.objetModele].sort()]);
    H.v('3b. la métadonnée sha256 du modèle est posée (la route la relit)', c.objets[ARGS.objetModele].meta.sha256, shaModele);
    H.vrai('3c. les commandes utilisées : Head, Put, Get seulement — aucune suppression', c.appels.every(n => ['HeadObjectCommand', 'PutObjectCommand', 'GetObjectCommand'].includes(n)));
    const deja = fauxR2({ [ARGS.objetModele]: { corps: Buffer.from('ancien'), meta: {} } });
    const e1 = await rejette(() => D.deposer({ client: deja, bucket: 'bucket-banc', plan, journal() { } }));
    H.vrai('4a. 🔑 un objet qui existe déjà : arrêt AVANT tout dépôt (aucun Put), l\'ancien est intact', /existe déjà/.test(e1 || '') && !deja.appels.includes('PutObjectCommand') && deja.objets[ARGS.objetModele].corps.toString() === 'ancien');
    const course = fauxR2(); const head = course.send.bind(course);
    course.send = async cmd => { if (cmd.constructor.name === 'PutObjectCommand') course.objets[cmd.input.Key] = { corps: Buffer.from('arrivé entre-temps'), meta: {} }; return head(cmd); };
    const e2 = await rejette(() => D.deposer({ client: course, bucket: 'bucket-banc', plan, journal() { } }));
    H.vrai('4b. 🔑 un objet apparu ENTRE le contrôle et le dépôt : le dépôt conditionnel (If-None-Match) échoue, l\'objet arrivé n\'est pas écrasé', !!e2 && course.objets[ARGS.objetIndex].corps.toString() === 'arrivé entre-temps');
    const panne = { async send() { throw Object.assign(new Error('x'), { name: 'ServiceUnavailable' }); } };
    H.vrai('4c. R2 en panne à la lecture initiale : arrêt (« je ne sais pas » n\'est pas « absent »)', /impossible/.test(await rejette(() => D.deposer({ client: panne, bucket: 'b', plan, journal() { } })) || ''));
    H.vrai('5. arguments : un argument inconnu est refusé', !!(await rejette(async () => D.lireArguments(['--supprimer', 'x']))));
    await new Promise(r => setTimeout(r, 300));
    try { fs.unlinkSync(fichierIndex); fs.unlinkSync(fichierModele); fs.rmdirSync(dossier); } catch { /* dossier temporaire du banc */ }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
