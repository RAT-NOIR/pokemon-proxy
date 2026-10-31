'use strict';
// LOT G-GROUPE — EXTRACTION (outil LOCAL, hors lancer-tout) : pour chaque ligne des bancs dont la chaîne pose une QUESTION, les mesures que le CLIENT enverrait (l'ensemble fermé de calcul-client.js, calculé par les
// mêmes fonctions de pixels : ratmarket/zones.js), rangées dans un fichier que l'analyse relit sans refaire un calcul. Lecture seule : aucun réseau, aucune base, aucune écriture hors du fichier de sortie.
//   node --expose-gc v2/mesures/extraire-mesures-groupe.js --sortie=<mesures.json> [--index=<.rmei>] [--resultats=<resultats-avecG.json>] [--nav=<nav-bancs.json>] [--cartes=<dossier>] [--tampons=<json>] [--secret-env=<.env>] [--limite=<n>] [--cles=<a,b>]
// Le secret HMAC de l'index vient du .env de l'API (jamais imprimé).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RACINE = path.join(__dirname, '..', '..');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const E = 'C:/Users/Yung/rat-market-travail/api/';
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };

function secret() {
    const f = arg('secret-env', 'C:/Users/Yung/Desktop/pokemon-proxy-api-v2/.env');
    const m = /^V2_VISUELS_HMAC=(.*)$/m.exec(fs.readFileSync(f, 'utf8'));
    if (!m) { console.error('V2_VISUELS_HMAC absent'); process.exit(2); }
    return m[1].trim().replace(/^["']|["']$/g, '');
}

(async () => {
    const X = require(path.join(RACINE, 'v2/identifier/index-empreintes.js')), etat = require(path.join(RACINE, 'v2/identifier/etat-empreintes.js'));
    const V = require(path.join(RACINE, 'v2/identifier/voisins-empreinte.js')), EV = require(path.join(RACINE, 'v2/identifier/empreinte-vecteur.js'));
    const MC = require(path.join(RACINE, 'v2/identifier/calcul-client.js')), RG = require(path.join(RACINE, 'v2/identifier/regle-g.js')), CR = require(path.join(RACINE, 'v2/identifier/carte-redressee.js'));
    const Z = require(path.join(RACINE, 'ratmarket/zones.js'));
    const dossierEssai = E + 'index-empreintes-essai/';
    const o = X.ouvrir(fs.readFileSync(arg('index', dossierEssai + 'sortie/index-empreintes-2026-10-24.rmei')), secret(), { modeleAttendu: MODELE });
    etat.installer(Object.freeze({ index: o.index, meta: Object.freeze(o.meta) }));
    // la version de l'archive EN PLACE (colonne des emprunts : sans elle, tout produit est « emprunté » et la règle G se tait — voir emprunt.contexteDeLaRegle)
    const S = require(path.join(RACINE, 'v2/chargeur/scellement')), F = require(path.join(RACINE, 'v2/chargeur/format'));
    const archive = F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(arg('archive', E + 'archives/candidate-2026-10-27.rmv')), secret())));
    require(path.join(RACINE, 'v2/chargeur/etat.js')).installer(archive);
    const nav = JSON.parse(fs.readFileSync(arg('nav', dossierEssai + 'donnees-nav/nav-bancs.json'), 'utf8')).photos;
    const R = JSON.parse(fs.readFileSync(arg('resultats', dossierEssai + 'resultats-avecG.json'), 'utf8'));
    const RELEVE = new Set(require(arg('tampons', E + 'tampons/controle-tampons-2026-10-18.json')).lignes.flatMap(l => l.scans.flatMap(s => s.cartes.map(k => k.cle))));
    const dossiersScans = [dossierEssai + 'images', E + 'index-empreintes/images', E + 'modele-visuel-hors-ligne/cache-archive/img'];
    const lireScan = cle => { for (const d of dossiersScans) { const p = path.join(d, sha1(cle) + '.webp'); if (fs.existsSync(p)) return fs.readFileSync(p); } return null; };
    const cartes = arg('cartes', dossierEssai + 'donnees-nav/cartes-bancs');
    const fournisseur = V.creerFournisseurEmpreinte({ cfg: { modeleEmpreinte: MODELE }, orbServeur: false });
    const filtre = arg('cles') ? new Set(arg('cles').split(',')) : null;
    let lignes = R.ref.filter(x => (x.banc === 'reglage' || x.banc === 'controle') && x.et && x.et.type === 'question' && Array.isArray(x.et.choix));
    if (filtre) lignes = lignes.filter(x => filtre.has(x.cle) || filtre.has(x.cle.split(':')[0]));
    if (arg('limite')) lignes = lignes.slice(0, Number(arg('limite')));
    console.log(`lignes à question : ${lignes.length} (sur ${R.ref.length} des bancs)`);
    const sortie = []; const bilan = {};
    const compte = k => { bilan[k] = (bilan[k] || 0) + 1; };
    for (const x of lignes) {
        const scanId = x.cle.split(':')[0], p = nav[scanId];
        const famille = x.banc === 'reglage' ? 'reglage' : RELEVE.has(x.cle) ? 'tamponnees' : 'ordinaires';
        const base = { cle: x.cle, famille, verite: x.verite ?? null, choix: x.et.choix };
        if (!p || !p.redressee || !Array.isArray(p.emb) || !fs.existsSync(path.join(cartes, scanId + '.jpg'))) { sortie.push({ ...base, etat: 'sans-entree' }); compte('sans-entree'); continue; }
        const corps = { empreintes: [{ photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: true, carte: fs.readFileSync(path.join(cartes, scanId + '.jpg')).toString('base64') }], modeleEmpreinte: MODELE };
        const entree = { imageUrls: ['x'], empreintes: V.lireEnveloppe(corps, 1) };
        const v = await fournisseur({ entree, scanId });
        if (v.ok) { sortie.push({ ...base, etat: 'g-sans-mesure', top: v.ligne.top }); compte('g-sans-mesure'); continue; }
        if (!v.attente) { sortie.push({ ...base, etat: 'silence-' + v.code }); compte('silence-' + v.code); continue; }
        const { ligne, ctx } = v.attente;
        const cleDe = new Map(); for (const [k, prods] of ctx.produits) for (const [id] of prods) if (!cleDe.has(id)) cleDe.set(id, k);
        const clesChoix = x.et.choix.map(id => { const e = archive.entree(id); return e && e.grande && e.grande.cle ? e.grande.cle : (cleDe.get(id) ?? null); });
        const empruntsChoix = x.et.choix.map(id => (typeof archive.empruntDe === 'function' ? archive.empruntDe(id) : null));
        const ens = MC.ensembleFerme(ctx, ligne);
        const ligneSortie = { ...base, etat: 'attente', top: ligne.top, clesChoix, empruntsChoix, groupes: ligne.top.map(([k]) => (ctx.groupe.has(k) ? ctx.groupe.get(k) : null)), demande: ens ? ens.mesures : null, ensembleNul: !ens, resultats: [], zonesGroupe: {} };
        const carte = await CR.valider(corps.empreintes[0].carte);
        if (!carte.ok) { ligneSortie.etat = 'carte-' + carte.code; sortie.push(ligneSortie); compte('carte-invalide'); continue; }
        const photo = await Z.photoGrise(carte.data, carte.width, carte.height);
        const zonesDe = async cle => {
            const sa = lireScan(cle); if (!sa) return null;
            try { const z = await Z.scoresZones(photo, { cle, octets: sa }); return { type: 'zones', ref: cle, haut: z.haut, illustration: z.illustration, bandeau: z.bandeau, texte: z.texte, bas: z.bas, inliers: z.inliers }; } catch { return null; }
        };
        try {
            for (const m of (ens ? ens.mesures : [])) {
                const sa = lireScan(m.type === 'paire' ? m.a : m.ref), sb = m.type === 'paire' ? lireScan(m.b) : null;
                if (!sa || (m.type === 'paire' && !sb)) { ligneSortie.resultats.push(null); continue; }
                try {
                    if (m.type === 'paire') { const [ecart, couverture] = await Z.comparerPaire(photo, { cle: m.a, octets: sa }, { cle: m.b, octets: sb }); ligneSortie.resultats.push({ type: 'paire', a: m.a, b: m.b, ecart, couverture }); }
                    else ligneSortie.resultats.push(await zonesDe(m.ref));
                } catch (e) { ligneSortie.resultats.push(null); }
            }
            // les zones de chaque visuel de la QUESTION (le groupe que le lot G-GROUPE ordonne) : mesurées une fois, qu'elles aient été demandées ou non
            for (const cle of new Set(clesChoix.filter(Boolean))) ligneSortie.zonesGroupe[cle] = await zonesDe(cle);
        } finally { try { photo.delete(); } catch { /* libérée */ } }
        ligneSortie.etat = !ens ? 'ensemble-nul' : ens.mesures.length === 0 ? 'ensemble-vide' : ligneSortie.resultats.every(r => r) ? 'mesure' : 'mesure-incomplete';
        compte(ligneSortie.etat);
        sortie.push(ligneSortie);
        if (global.gc && sortie.length % 20 === 0) global.gc();
    }
    console.log(JSON.stringify(bilan));
    fs.writeFileSync(arg('sortie'), JSON.stringify({ le: new Date().toISOString(), index: path.basename(arg('index', 'index-empreintes-2026-10-24.rmei')), lignes: sortie }));
    process.exit(0);
})().catch(e => { console.error('ERREUR', String(e && e.stack || e).replace(/V2_VISUELS_HMAC=\S+/g, '<masqué>')); process.exit(1); });
