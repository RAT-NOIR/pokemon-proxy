'use strict';
// LOT F1-TAMPON, tour 1 — UNE vérification de bout en bout : 2 cartes Staff du contrôle et 2 cartes SANS tampon (posées sur une question « paire Staff / normale », le pire cas pour un faux), sur la carte redressée 420 × 587
// (JPEG 0,92, la carte que MODELE-VISUEL-API valide), par la DÉCISION de la route (`consulterLectureTampon`, les deux drapeaux allumés) et le fournisseur de PRODUCTION (`creerFournisseurTampon`, le vrai client du modèle).
//   node v2/mesures/verifier-tampon-bout-en-bout.js --sortie=<dossier> [--plafond=0.06]
// Plafond DUR : le carnet de TEMPS-CHAINE (coût réel lu, arrêt AVANT le plafond). Photos : bucket PRIVÉ du banc de l'essai, LECTURE SEULE ; jamais Vinted. Aucune écriture en base. Aucune valeur secrète affichée.
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..', '..');
const arg = (nom, defaut) => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : defaut; };
(async () => {
    require('C:/Users/Yung/rat-market-travail/api/atlas/garde-secrets');
    const { ouvrir } = require('C:/Users/Yung/rat-market-travail/api/mesure-banc-reel/lib');
    const sortie = arg('sortie'); if (!sortie) throw new Error('--sortie=<dossier> est obligatoire');
    fs.mkdirSync(sortie, { recursive: true });
    const plafond = Number(arg('plafond', '0.06')); if (!(plafond > 0 && plafond <= 0.06)) throw new Error('plafond : entre 0 et 0,06 $');
    const cle = process.env.OPENROUTER_API_KEY; if (!cle) throw new Error('OPENROUTER_API_KEY absente du .env d\'api-v2');
    const axios = require(path.join(RACINE, 'node_modules', 'axios')), sharp = require(path.join(RACINE, 'node_modules', 'sharp'));
    const S = require('../chargeur/scellement'), F = require('../chargeur/format');
    const LT = require('../identifier/lecture-tampon'), { consulterLectureTampon } = require('../identifier/lecture-tampon-route'), { creerFournisseurTampon } = require('../identifier/fournisseur-tampon');
    const { creerCarnet } = require('./mesurer-temps-ia');
    const V = F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(arg('archive', 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\archive-2026-10-18-format2.rmv')), process.env.V2_VISUELS_HMAC)));
    const STAFF = [[851049, 851050, '6ad4b56d6f03a553f226774f'], [761122, 692230, '6ad4b6a86f03a553f22677ae']];          // [staff, normale, scan] : deux Staff du contrôle (la paire est celle de l'archive)
    const { c, db } = await ouvrir();
    process.env.R2_ACCESS_KEY_ID = process.env.R2_ESSAI_BANC_LECTURE_CLE_ID; process.env.R2_SECRET_ACCESS_KEY = process.env.R2_ESSAI_BANC_LECTURE_SECRET;
    const r2 = require('../../collecte-cartes/r2'); await r2.verifierBucket('rm-essai-banc');
    const photo = async scanId => { const a = await db.collection('analyses').findOne({ _id: new (require(path.join(RACINE, 'node_modules', 'mongoose')).Types.ObjectId)(scanId) }); return a && a.photoBanc ? r2.lireBinaire('rm-essai-banc', a.photoBanc.cle) : null; };
    const carte420 = async buf => (await sharp(buf).resize(420, 587, { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer()).toString('base64');
    // deux cartes SANS tampon : les deux premières analyses étiquetées (hors paires du contrôle), tirage reproductible
    const A = await db.collection('analyses').find({ 'photoBanc.cle': { $type: 'string' } }, { projection: { cartes: 1 } }).limit(400).toArray();
    const pairesIds = new Set([851049, 851050, 851045, 851046, 692230, 761122, 760234, 761138, 857393, 859015, 769411, 769412]);
    const sans = A.filter(a => a.cartes.length === 1 && a.cartes[0].etiquetteAdmin && !pairesIds.has(a.cartes[0].etiquetteAdmin.idProduct) && ![437164, 449213, 299573].includes(a.cartes[0].etiquetteAdmin.idProduct)).slice(40, 42).map(a => String(a._id));
    const carnet = creerCarnet({ fichier: path.join(sortie, 'depense.json'), plafondUsd: plafond });
    const post = axios.post.bind(axios);
    const depense = { envelopper: p => async (url, corps, cfg) => { if (!carnet.peutAppeler()) throw Object.assign(new Error('plafond'), { code: 'DEPENSE_MODELE_PLAFOND' }); const r = await p(url, { ...corps, usage: { include: true } }, cfg); const u = r && r.data && r.data.usage; carnet.compter(u && Number.isFinite(u.cost) ? u.cost : null); return r; } };
    const lectureTampon = creerFournisseurTampon({ post, cle, depense });
    const cas = [...STAFF.map(([s, n, scan]) => ({ nature: 'staff', ids: [n, s], scan })), ...sans.map(scan => ({ nature: 'sans-tampon', ids: [851049, 851050], scan }))];
    const rendus = [];
    for (const k of cas) {
        const buf = await photo(k.scan); if (!buf) { rendus.push({ ...k, issue: 'sans-photo' }); continue; }
        const produits = new Map(k.ids.map(id => [id, { idProduct: id, nomCardmarket: 'carte', set: { slug: 's', nom: 's' }, numero: '1' }]));
        const resultat = { issue: 'question', analyse: { cartes: [{ candidats: k.ids.map(idProduct => ({ idProduct })) }] } };
        const r = await consulterLectureTampon({ deps: { lectureTampon }, cfg: { lectureTampon: true, empreinteExtension: true }, entree: { empreintes: { rejet: null, modele: null, entrees: [{ photo: 0, vecteur: 'x', redressee: true, carte: await carte420(buf) }] } },
            scanId: `bout-en-bout-${k.scan}`, resultat, corpsChaine: { success: false }, produits, version: V, avecBorne: f => f(), affirmer: (id, s, critere) => ({ issue: 'affirmee', analyse: { cartes: [{ carte: { idProduct: id } }] }, critere }) });
        rendus.push({ nature: k.nature, scan: k.scan.slice(-6), issue: r && r.trace ? r.trace.issue : 'rien', affirme: r && r.resultat ? r.resultat.analyse.cartes[0].carte.idProduct : null, appels: r && r.trace ? r.trace.appels : 0 });
    }
    for (const x of rendus) console.log(JSON.stringify(x));
    const staffOk = rendus.filter(x => x.nature === 'staff' && x.issue === 'confirmee').length, faux = rendus.filter(x => x.nature === 'sans-tampon' && x.affirme !== null).length;
    const e = carnet.etat();
    console.log(`Staff affirmés ${staffOk}/2 · FAUX (une affirmation sur une carte sans tampon) ${faux} · DÉPENSE ${e.cumulUsd.toFixed(4)} $ sur plafond ${plafond} $ (${e.appels} appels)${e.arret ? ' · ARRÊT : ' + e.arret : ''}`);
    void LT;
    await c.close();
})().catch(e => { console.error('❌', (e && (e.code || e.name)) || 'erreur', String((e && e.message) || '').slice(0, 200)); process.exit(1); });
