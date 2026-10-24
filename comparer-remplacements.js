// COMPARAISON IMAGE À IMAGE des remplacements d'un lot de la RÉCOLTE : l'ANCIENNE image (celle que l'unité remplacerait, lue sur NOTRE R2 en LECTURE SEULE) contre la NOUVELLE (le cache local).
//   node comparer-remplacements.js --source=ppr [--dossier=<sorties>]
// Aucune requête vers une source, aucune écriture en base, aucune écriture R2 (GetObject seulement, nos propres objets). L'empreinte est celle de l'AUDIT du catalogue (branche c-audit,
// `audit-catalogue/empreinte.js` : NCC recalée sur la fenêtre centrale de l'illustration, distance 1 − NCC) IMPORTÉE, jamais recopiée ; les seuils sont ceux fixés par le coordinateur
// (S8\AUDIT\seuils.md) : d < 0,55 même illustration ; 0,55 ≤ d < 0,65 incertain ; d ≥ 0,65 probablement faux. Sortie : comparaison-<N>.json et planche-comparaison*.jpg dans le dossier.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const RC = require('./collecte-cartes/recolte-commun');
const HOTE = require('./collecte-cartes/recolte-hote');
const CLI = require('./collecte-cartes/recolte-cli');

const SEUIL_INCERTAIN = 0.55, SEUIL_FAUX = 0.65;
const AUDIT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\c-audit\\audit-catalogue\\empreinte.js';

const classe = d => (Number.isNaN(d) ? 'sans-contraste' : d < SEUIL_INCERTAIN ? 'conforme' : d < SEUIL_FAUX ? 'incertain' : 'probablement-faux');
const echapper = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Les paires (unité, entrée remplacée) du plan : une par entrée sortante. */
function paires(plan) {
    const l = [];
    for (const u of plan.unites.filter(x => x.decision?.action === 'ajouter')) for (const e of u.decision.remplace || []) l.push({ u, e });
    return l;
}
/** La mesure d'UNE paire, avec l'instrument injecté (`E` : { empreinteDe, distance, couleur, formatDeCarte, analyser }). Ne lève pas : une image illisible est un résultat. */
async function mesurer({ E, ancien, nouveau }) {
    const sortie = {};
    try {
        const a = await E.analyser(ancien), b = await E.analyser(nouveau);
        sortie.formatAncien = E.formatDeCarte(a.w, a.h); sortie.formatNouveau = E.formatDeCarte(b.w, b.h);
        const d = E.distance(a.empreinte, b.empreinte);
        sortie.distance = Number.isNaN(d.distance) ? null : Math.round(d.distance * 1000) / 1000; sortie.ncc = Number.isNaN(d.ncc) ? null : Math.round(d.ncc * 1000) / 1000; sortie.decalage = [d.dx, d.dy];
        sortie.couleur = Math.round(E.couleur(a.empreinte, b.empreinte) * 1000) / 1000;
        sortie.classe = classe(d.distance);
        if (!sortie.formatAncien || !sortie.formatNouveau) sortie.classe = 'format-non-carte';
    } catch (e) { sortie.classe = 'illisible'; sortie.erreur = e.message; }
    return sortie;
}

async function planche({ lignes, sortie, prefixe = 'planche-comparaison', parPlanche = 12 }) {
    const L = 150, H = 210, B = 64, COL = 4, fichiers = [];
    for (let p = 0; p * parPlanche < lignes.length; p++) {
        const lot = lignes.slice(p * parPlanche, (p + 1) * parPlanche), rangs = Math.ceil(lot.length / COL), tuiles = [];
        for (let i = 0; i < lot.length; i++) {
            const x = lot[i], left = (i % COL) * (2 * L + 8), top = Math.floor(i / COL) * (H + B);
            tuiles.push({ input: await sharp(x.octetsAncien).resize(L, H, { fit: 'fill' }).png().toBuffer(), left, top });
            tuiles.push({ input: await sharp(x.octetsNouveau).resize(L, H, { fit: 'fill' }).png().toBuffer(), left: left + L, top });
            const ligne = (y, t, c = '#000') => `<text x="3" y="${y}" font-family="Arial" font-size="12" fill="${c}">${echapper(t.slice(0, 50))}</text>`;
            tuiles.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${2 * L}" height="${B}"><rect width="${2 * L}" height="${B}" fill="#fff"/>${ligne(14, `${x.nomFiche} · n°${x.numero}`)}${ligne(30, `ancienne ${x.wAncien}px | nouvelle ${x.wNouveau}px`)}${ligne(46, `d = ${x.distance ?? 'n/a'} · ${x.classe} · carte ${x.carteId}`, x.classe === 'conforme' ? '#060' : '#c00')}</svg>`), left, top: top + H });
        }
        const f = path.join(sortie, p === 0 ? `${prefixe}.jpg` : `${prefixe}-${p + 1}.jpg`);
        await sharp({ create: { width: COL * (2 * L + 8), height: (H + B) * rangs, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(tuiles).jpeg({ quality: 85 }).toFile(f);
        fichiers.push(f);
    }
    return fichiers;
}

module.exports = { paires, mesurer, classe, planche, SEUIL_INCERTAIN, SEUIL_FAUX, AUDIT };
if (require.main !== module) return;

(async () => {
    const args = process.argv.slice(2);
    const code = args.find(a => /^--source=(ppr|tcs)$/.test(a))?.slice(9);
    const inconnus = args.filter(a => !/^--source=(ppr|tcs)$/.test(a) && !/^--dossier=.+$/.test(a));
    if (!code || inconnus.length) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}--source=ppr|tcs est obligatoire`); process.exitCode = 2; return; }
    const SRC = code === 'ppr' ? require('./collecte-cartes/pokipair').SRC : require('./collecte-cartes/tcgcsv').SRC;
    const dossier = RC.verifierChemin(args.find(a => a.startsWith('--dossier='))?.slice(10) ?? 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\RECOLTE');
    const F = CLI.fichiersDe(code, dossier, undefined);
    if (!fs.existsSync(AUDIT)) throw new Error(`l'empreinte de l'audit est absente (${AUDIT}) : on n'en recopie pas une autre`);
    const E = require(AUDIT);
    const plan = RC.lireJson(F.plan, null);
    if (!plan?.unites) throw new Error(`${F.plan} absent`);
    const r2 = require('./collecte-cartes/r2');
    const bucket = process.env.R2_BUCKET_IMAGES;
    if (!bucket) throw new Error('R2_BUCKET_IMAGES absent');
    await r2.verifierBucket(bucket);                           // ListObjects(MaxKeys 1) : lecture seule
    const ancien = path.join(dossier, 'cache-anciennes');
    fs.mkdirSync(ancien, { recursive: true });
    const lecture = async cle => {
        const f = path.join(ancien, `${crypto.createHash('sha1').update(cle).digest('hex')}.bin`);
        if (fs.existsSync(f)) return fs.readFileSync(f);
        const o = await r2.lireBinaire(bucket, cle);          // GetObject : lecture seule
        fs.writeFileSync(f, o);
        return o;
    };
    const liste = paires(plan);
    console.log(`PAIRES : ${liste.length} (unités à ajouter qui remplacent : ${new Set(liste.map(x => x.u.produits[0])).size}) · instrument : audit-catalogue/empreinte.js (c-audit) · seuils ${SEUIL_INCERTAIN} / ${SEUIL_FAUX}`);
    const resultats = [], octets = new Map();
    let k = 0;
    for (const { u, e } of liste) {
        let a = null, b = null, erreur = null;
        try { a = await lecture(e.cleR2); } catch (x) { erreur = `ancienne illisible sur R2 : ${x.message}`; }
        const c = HOTE.lireDuCache(F.cache, u.url);
        if (!c) erreur = erreur ?? 'nouvelle absente du cache'; else b = c.octets;
        const m = erreur ? { classe: 'absente', erreur } : await mesurer({ E, ancien: a, nouveau: b });
        const wA = e.wOriginal ?? e.w ?? null;
        const ligne = { carteId: u.carteId, idProduct: u.produits[0], slugSet: u.slugSet, numero: u.numero, nomFiche: u.carteNom, ancienne: { source: e.source, cleR2: e.cleR2, w: e.w ?? null, wOriginal: wA }, nouvelle: { url: u.url, idSource: u.idSource }, ...m };
        resultats.push(ligne);
        if (m.classe !== 'conforme') octets.set(ligne, { octetsAncien: a, octetsNouveau: b, wAncien: wA, wNouveau: b ? (await sharp(b).metadata()).width : null });
        if (++k % 100 === 0) console.log(`   ${k}/${liste.length}`);
    }
    const par = {}; for (const r of resultats) par[r.classe] = (par[r.classe] || 0) + 1;
    const ds = resultats.map(r => r.distance).filter(d => typeof d === 'number').sort((x, y) => x - y);
    const q = p => ds.length ? ds[Math.min(ds.length - 1, Math.floor(p * ds.length))] : null;
    const audessus = resultats.filter(r => typeof r.distance === 'number' && r.distance >= SEUIL_INCERTAIN).sort((x, y) => y.distance - x.distance);
    const sansMesure = resultats.filter(r => r.distance == null);
    const sortie = { le: new Date().toISOString(), source: SRC.SOURCE, instrument: 'audit-catalogue/empreinte.js (branche c-audit) : NCC recalée ±5/±4 sur la fenêtre centrale 30×24 de la trame 40×32, distance = 1 − NCC', seuils: { incertain: SEUIL_INCERTAIN, probablementFaux: SEUIL_FAUX },
        denominateur: { paires: liste.length, mesurees: ds.length, sansMesure: sansMesure.length }, parClasse: par, distance: { min: ds[0] ?? null, mediane: q(0.5), p95: q(0.95), p99: q(0.99), max: ds[ds.length - 1] ?? null },
        auDessusDe055: audessus.map(r => ({ carteId: r.carteId, idProduct: r.idProduct, slugSet: r.slugSet, numero: r.numero, nomFiche: r.nomFiche, distance: r.distance, classe: r.classe, ancienne: r.ancienne.cleR2, nouvelle: r.nouvelle.url })),
        sansMesure: sansMesure.map(r => ({ carteId: r.carteId, idProduct: r.idProduct, classe: r.classe, erreur: r.erreur ?? null })), paires: resultats };
    const fichier = path.join(dossier, `comparaison-${liste.length}.json`);
    RC.ecrireJson(fichier, sortie);
    const aVoir = [...audessus, ...sansMesure, ...resultats.filter(r => typeof r.distance === 'number' && r.distance < SEUIL_INCERTAIN).sort((x, y) => y.distance - x.distance).slice(0, Math.max(0, 24 - audessus.length - sansMesure.length))];
    const lignes = aVoir.filter(r => octets.has(r) || (r.classe === 'conforme')).map(r => ({ ...r, ...(octets.get(r) ?? {}) }));
    // les « conformes » les plus lointains : leurs octets sont relus (ancienne : cache local ; nouvelle : cache)
    for (const x of lignes) if (!x.octetsAncien) { x.octetsAncien = await lecture(x.ancienne.cleR2); x.octetsNouveau = HOTE.lireDuCache(F.cache, x.nouvelle.url).octets; x.wAncien = x.ancienne.wOriginal; x.wNouveau = (await sharp(x.octetsNouveau).metadata()).width; }
    const prets = lignes.filter(x => x.octetsAncien && x.octetsNouveau);
    const fichiers = prets.length ? await planche({ lignes: prets, sortie: dossier }) : [];
    console.log(`COMPARAISON : ${JSON.stringify(par)} · distance min ${ds[0]} · médiane ${q(0.5)} · p95 ${q(0.95)} · p99 ${q(0.99)} · max ${ds[ds.length - 1]} · au-dessus de ${SEUIL_INCERTAIN} : ${audessus.length} · sans mesure : ${sansMesure.length}`);
    console.log(`→ ${fichier}${fichiers.length ? ` ; ${fichiers.join(' ; ')} (${prets.length} paires : tout ce qui est au-dessus de ${SEUIL_INCERTAIN}, sans mesure, puis les plus lointains des conformes)` : ''}`);
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
