'use strict';
// LOT TEMPS-CHAINE — mesure de l'APPEL AU MODÈLE : la variante actuelle contre les variantes proposées, sur les MÊMES photos locales, avec un PLAFOND DE DÉPENSE DUR.
//   node v2/mesures/mesurer-temps-ia.js --env=<.env d'api-v2> --sortie=<dossier> [--n=30] [--variantes=v0,v0b,A,S,AS] [--plafond=0.60] [--graine=20261018]
// Ce que ça FAIT : pour chaque photo du jeu local (21 photos du testeur + 65 photos du labo « certain », jamais une URL d'annonce, jamais Vinted), un appel à OpenRouter par variante,
// dans un ordre tournant (le bruit du moment se répartit sur toutes les variantes). Chaque appel est chronométré, son COÛT RÉEL est lu chez le fournisseur (usage.cost), et la lecture
// est comparée à la VÉRITÉ du banc (numéro, code, nom) et à la lecture de la variante actuelle (total, langue, tous les champs que la chaîne lit).
// LES GARDES : la clé n'est JAMAIS affichée (le .env n'est lu que pour le NOM OPENROUTER_API_KEY) ; le cumul de dépense est écrit dans <sortie>/depense.json et RELU à chaque lancement
// (le plafond tient d'un lancement à l'autre) ; l'outil S'ARRÊTE avant l'appel qui pourrait le franchir — cumul + le pire appel observé + une marge — et le DIT.
// Aucune écriture en base : aucune base n'est ouverte.
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..');
const TESTEUR = 'C:/Users/Yung/Desktop/pokemon-proxy/photos-test/verite/';
const LABO = 'C:/Users/Yung/Desktop/labo-embedding/';
const MODELE = 'google/gemini-3-flash-preview';
const MARGE_USD = 0.004;                                       // ajoutée au pire appel observé : on s'arrête AVANT de pouvoir franchir le plafond

// ── fonctions pures (jugées par v2/test/test-mesurer-temps-ia.js) ─────────────────────────────────────────────────────────────────────────
const pct = (v, p) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : null; };
const moy = v => { const s = v.filter(Number.isFinite); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
const numeroComplet = n => String(n).trim().toUpperCase().replace(/(\d+)/, d => String(parseInt(d, 10)));
const chiffres = n => { const m = String(n).match(/\d+/); return m ? String(parseInt(m[0], 10)) : null; };
const alnum = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const nomDeBase = produit => String(produit || '').split('[')[0].trim();
function nomOk(lu, produit) { const a = alnum(lu), b = alnum(nomDeBase(produit)); return Boolean(a && b && (a === b || a.includes(b) || b.includes(a))); }
const numeroOk = (lu, vrai) => (lu == null || vrai == null) ? null : (numeroComplet(lu) === numeroComplet(vrai) ? 'exact' : (chiffres(lu) && chiffres(lu) === chiffres(vrai) ? 'chiffres' : 'faux'));
const codeOk = (lu, vrai) => (!vrai ? null : alnum(lu) === alnum(vrai));
/** Les champs que la CHAÎNE lit (index.js : tout cardInfo sauf illustrateur*, « lecture seule »), normalisés pour être comparés entre deux lectures de la même photo. */
const CHAMPS_CHAINE = ['name', 'nomBrut', 'nomConfiance', 'attaqueBrute', 'attaque', 'attaqueConfiance', 'number', 'total', 'setCode', 'symboleSet', 'rarete', 'reverse', 'motif', 'language', 'etatEstime', 'etatConfiance'];
const CHAMPS_DECISIFS = ['name', 'number', 'total', 'setCode', 'language'];
const norm = (k, x) => {
    if (x === null || x === undefined) return null;
    const s = String(x).trim();
    if (['', 'null', 'none', 'n/a', '-', '?'].includes(s.toLowerCase())) return null;
    if (k === 'number') return numeroComplet(s);
    if (k === 'total') return chiffres(s);
    if (k === 'setCode') return alnum(s);
    if (k === 'name' || k === 'nomBrut' || k === 'attaque' || k === 'attaqueBrute') return alnum(s);
    return s.toLowerCase();
};
const memeLecture = (a, b, champs) => champs.every(k => norm(k, a[k]) === norm(k, b[k]));
const champsDifferents = (a, b, champs) => champs.filter(k => norm(k, a[k]) !== norm(k, b[k]));
function extraireJson(contenu) {
    try { return JSON.parse(String(contenu).replace(/```json|```/g, '').trim()); } catch { return null; }
}
/** Le carnet de dépense : persistant, plafonné, qui s'arrête AVANT de franchir. */
function creerCarnet({ fichier, plafondUsd, depart = 0, ecrire = (f, t) => fs.writeFileSync(f, t), lire = f => fs.readFileSync(f, 'utf8') }) {
    let etat = { cumulUsd: depart, appels: 0, coutMax: 0, sansCout: 0, arret: null };
    try { etat = { ...etat, ...JSON.parse(lire(fichier)) }; } catch { /* premier lancement */ }
    const sauver = () => ecrire(fichier, JSON.stringify(etat, null, 1));
    const reserve = () => etat.coutMax + MARGE_USD;
    return {
        etat: () => ({ ...etat }),
        peutAppeler() { if (etat.cumulUsd + reserve() > plafondUsd) { etat.arret = `cumul ${etat.cumulUsd.toFixed(4)} $ + pire appel ${etat.coutMax.toFixed(4)} $ + marge ${MARGE_USD} $ > plafond ${plafondUsd} $`; sauver(); return false; } return true; },
        compter(cout) {
            etat.appels++;
            if (Number.isFinite(cout) && cout >= 0) { etat.cumulUsd += cout; etat.coutMax = Math.max(etat.coutMax, cout); }
            else { etat.sansCout++; etat.cumulUsd += Math.max(etat.coutMax, 0.0075); }      // coût illisible : jamais 0, le pire connu (ou 0,0075 $)
            sauver();
        }
    };
}
module.exports = { pct, moy, numeroComplet, nomOk, numeroOk, codeOk, norm, memeLecture, champsDifferents, extraireJson, creerCarnet, CHAMPS_CHAINE, CHAMPS_DECISIFS, MARGE_USD };

// ── l'exécution ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function arg(nom, defaut) { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : defaut; }
function chargerCle(fichier) {
    const t = fs.readFileSync(fichier, 'utf8');
    for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.*)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, ''); }
    return null;
}
function jeuDePhotos(n, graine) {
    const tes = JSON.parse(fs.readFileSync(TESTEUR + 'propositions.json', 'utf8')).map(p => ({ banc: 'testeur', id: p.photo, fichier: TESTEUR + p.photo + '.jpg', verite: { produit: p.nom, numero: p.numero, codeSet: p.codeSet } }));
    const lab = JSON.parse(fs.readFileSync(LABO + 'etiquettes-66.json', 'utf8')).etiquettes.filter(e => e.statut === 'certain')
        .map(e => ({ banc: 'labo', id: e.photo, fichier: LABO + 'photos-66/' + e.photo, verite: { produit: e.produit, numero: e.numero, codeSet: null } }));
    let g = graine; const alea = () => { g = (g * 1664525 + 1013904223) % 4294967296; return g / 4294967296; };
    const melange = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(alea() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    const moitie = Math.floor(n / 2);
    return [...melange(tes).slice(0, moitie), ...melange(lab).slice(0, n - moitie)].filter(p => fs.existsSync(p.fichier));
}
async function principal() {
    const sortie = arg('sortie'); if (!sortie) throw new Error('--sortie=<dossier> est obligatoire');
    fs.mkdirSync(sortie, { recursive: true });
    const plafond = Number(arg('plafond', '0.60')); if (!(plafond > 0 && plafond <= 0.60)) throw new Error('plafond : entre 0 et 0,60 $ (le plafond du lot)');
    const depart = Number(arg('depart', '0'));
    const cle = chargerCle(arg('env', 'C:/Users/Yung/Desktop/pokemon-proxy-api-v2/.env'));
    if (!cle) throw new Error('OPENROUTER_API_KEY absente du .env indiqué');
    const axios = require(path.join(RACINE, 'node_modules', 'axios'));
    const TC = require('../identifier/temps-chaine');
    const source = fs.readFileSync(path.join(RACINE, 'index.js'), 'utf8');
    const texte = source.match(/const prompt = `([\s\S]*?)`;/)[1];                       // LE prompt de la production, lu dans sa source (même regex que verrou/empreinte.js)
    const prompt = new Function('title', 'return `' + texte + '`')('');
    const VARIANTES = {
        v0: { prompt, extra: {} },                                                         // la production d'aujourd'hui
        v0b: { prompt, extra: {} },                                                        // le MÊME, une seconde fois : la mesure du bruit (temps ET lecture)
        A: { prompt: TC.allegerPrompt(prompt), extra: {} },                                // sans illustrateur, JSON sur une ligne
        S: { prompt, extra: { provider: { sort: 'latency' } } },                           // fournisseur choisi par latence
        AS: { prompt: TC.allegerPrompt(prompt), extra: { provider: { sort: 'latency' } } }
    };
    const noms = arg('variantes', 'v0,v0b,A,S,AS').split(',');
    for (const n of noms) if (!VARIANTES[n]) throw new Error(`variante inconnue : ${n}`);
    const photos = jeuDePhotos(Number(arg('n', '30')), Number(arg('graine', '20261018')));
    const carnet = creerCarnet({ fichier: path.join(sortie, 'depense.json'), plafondUsd: plafond, depart });
    const fichierRes = path.join(sortie, 'appels.jsonl');
    console.log(`photos : ${photos.length} (${photos.filter(p => p.banc === 'testeur').length} testeur, ${photos.filter(p => p.banc === 'labo').length} labo) · variantes : ${noms.join(', ')} · plafond ${plafond} $ · déjà dépensé ${carnet.etat().cumulUsd.toFixed(4)} $`);
    let arret = false;
    for (let i = 0; i < photos.length && !arret; i++) {
        const p = photos[i];
        const url = 'data:image/jpeg;base64,' + fs.readFileSync(p.fichier).toString('base64');
        const ordre = noms.map((_, k) => noms[(k + i) % noms.length]);                      // ordre tournant
        for (const nom of ordre) {
            if (!carnet.peutAppeler()) { arret = true; console.log(`⛔ ARRÊT AVANT DÉPASSEMENT : ${carnet.etat().arret}`); break; }
            const t = Date.now(); let ligne;
            try {
                const r = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                    model: MODELE, temperature: 0, usage: { include: true },
                    messages: [{ role: 'user', content: [{ type: 'text', text: VARIANTES[nom].prompt }, { type: 'image_url', image_url: { url } }] }], ...VARIANTES[nom].extra
                }, { headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' }, timeout: 40000 });
                const ms = Date.now() - t, u = r.data.usage || {};
                carnet.compter(u.cost);
                const c = r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content;
                ligne = { photo: p.id, banc: p.banc, variante: nom, ms, cout: u.cost ?? null, entree: u.prompt_tokens ?? null, sortie: u.completion_tokens ?? null, raisonnement: (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) ?? null, fournisseur: r.data.provider ?? null, lecture: extraireJson(c), verite: p.verite };
            } catch (e) {
                carnet.compter(null);
                ligne = { photo: p.id, banc: p.banc, variante: nom, ms: Date.now() - t, erreur: e.response ? `HTTP ${e.response.status}` : (e.code || 'erreur'), verite: p.verite };
            }
            fs.appendFileSync(fichierRes, JSON.stringify(ligne) + '\n');
        }
        if ((i + 1) % 5 === 0) console.log(`  ${i + 1}/${photos.length} photos · ${carnet.etat().appels} appels · ${carnet.etat().cumulUsd.toFixed(4)} $`);
    }
    const e = carnet.etat();
    console.log(`DÉPENSE : ${e.cumulUsd.toFixed(4)} $ sur plafond ${plafond} $ · ${e.appels} appels (${e.sansCout} sans coût lisible, comptés au pire connu)${e.arret ? ' · ARRÊT : ' + e.arret : ''}`);
}
if (require.main === module) principal().catch(e => { console.error('❌', e.message); process.exit(1); });
