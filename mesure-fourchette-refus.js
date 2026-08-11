// ============================================================================
// LA FOURCHETTE DES REFUS — ce qu'on peut mesurer, et ce qu'on ne peut pas
// ============================================================================
// USAGE : node mesure-fourchette-refus.js --base=<nom>
//
// L'IDÉE À ÉVALUER. Sur un refus par égalité parfaite, on renoncerait à dire QUELLE carte
// c'est, mais on connaîtrait la FOURCHETTE des candidats. Si toute la fourchette est du
// même côté du prix Vinted, le verdict de prix est sûr sans départager l'identification.
//
// ⚠️ CE QUI EMPÊCHE LA MESURE COMPLÈTE, ET IL FAUT LE LIRE AVANT LES CHIFFRES :
//   `prixVinted` n'est renseigné sur AUCUNE des 142 lignes du journal. Ce n'est pas un
//   oubli d'écriture : /api/identifier ne REÇOIT pas de prix — son corps de requête est
//   { imageUrl, imageUrls, title, vintedEtat }. Le prix vit dans le navigateur.
//   On ne peut donc pas compter combien de refus auraient une fourchette entièrement d'un
//   côté du prix : le côté n'existe nulle part.
//
// CE QUE CE SCRIPT MESURE QUAND MÊME : la FORME des fourchettes. Une fourchette étroite
// laisse beaucoup de place à un prix qui la dépasse largement ; une fourchette de 1 à 23
// n'en laisse presque aucune. C'est ce qui borne la valeur du mécanisme sans le prix
// Vinted — et c'est mesurable aujourd'hui.
//
// LECTURE SEULE. Aucune écriture. Les fonctions appelées sont celles de production.
require('dotenv').config();

const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
if (!BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
process.env.MONGODB_BASE = BASE;

const mongoose = require('mongoose');
const S = require('./scoring');
const { numeroEstUnDexId } = require('./pokedex');
const { EXPANSIONS_VINTAGE, departagerParSymbole } = require('./sets-vintage-japonais');
const { trouverProduitsLocaux, trouverCarteTCGdex, scorerCandidatsLocal, lireCodeSets } = require('./index');

const LANGUES_ASIATIQUES = ['JP', 'ZH', 'KR'];
const med = a => { if (!a.length) return null; const t = [...a].sort((x, y) => x - y); const m = t.length >> 1; return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
const q = (a, p) => { if (!a.length) return null; const t = [...a].sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.floor(p * t.length))]; };

(async () => {
    for (let i = 0; i < 60 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 500));
    if (mongoose.connection.readyState !== 1) { console.error('❌ Mongo non connecté.'); process.exit(1); }
    if (mongoose.connection.db.databaseName !== BASE) { console.error('❌ mauvaise base.'); process.exit(1); }

    const lignes = await mongoose.connection.db.collection('journal_scans')
        .find({ route: 'identifier', resultat: 'echec', motifEchec: 'egalite-parfaite' }).sort({ le: 1 }).toArray();
    console.log(`base : ${BASE}   ·   refus « egalite-parfaite » au journal : ${lignes.length}\n`);

    const fourchettes = [], echecs = [];
    for (const l of lignes) {
        const avis = numeroEstUnDexId({ nom: l.nom, numero: l.numero, total: l.total, langue: l.langue });
        const numeroCarte = avis.estDex ? null : l.numero;
        const cardInfoEffectif = {
            name: l.nom, number: numeroCarte, total: l.total, setCode: l.setCode,
            language: l.langue, rarete: l.rarete, rareteElevee: false, nomBrut: l.nomBrut
        };
        let vivier = [];
        try {
            const t = await trouverCarteTCGdex(l.nom, numeroCarte, l.setCode, null, l.langue, l.total, l.nomBrut);
            const parId = new Map();
            for (const p of [...(t?.nomExact ? await trouverProduitsLocaux(t.nomExact) : []), ...await trouverProduitsLocaux(l.nom)]) {
                if (!parId.has(p.idProduct)) parId.set(p.idProduct, p);
            }
            vivier = [...parId.values()];
            if (numeroCarte == null && LANGUES_ASIATIQUES.includes(String(l.langue || '').toUpperCase()) && vivier.length > 1) {
                const dedans = vivier.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
                if (dedans.length) vivier = dedans;
            }
        } catch (e) { echecs.push({ nom: l.nom, e: e.message }); continue; }
        if (vivier.length < 2) { echecs.push({ nom: l.nom, e: `vivier de ${vivier.length} — le refus ne se rejoue pas` }); continue; }

        const cs = await lireCodeSets(vivier.map(p => p.idExpansion));
        const r = await scorerCandidatsLocal(vivier, cardInfoEffectif, null, [], cs, { numeroBrutPourScoring: l.numero });
        if (r.scores.length < 2 || !S.sontExAequo(r.scores[0].score, r.scores[1].score)) {
            echecs.push({ nom: l.nom, e: 'plus d\'égalité au sommet — le refus ne se reproduit pas' });
            continue;
        }
        const exAequo = r.scores.filter(s => S.sontExAequo(s.score, r.scores[0].score));
        // Le départage par symbole passe AVANT le refus en production : s'il tranche, il
        // n'y a pas de refus, donc pas de fourchette à renvoyer.
        const avisSym = departagerParSymbole(l.symboleSet,
            exAequo.map(s => ({ idProduct: s.candidat.idProduct, codeSet: cs.get(Number(s.candidat.idExpansion)) ?? null })), S);
        if (avisSym.gagnant) { echecs.push({ nom: l.nom, e: 'départagé par le symbole — plus de refus' }); continue; }

        const prix = exAequo.map(s => s.candidat.prix).filter(p => Number.isFinite(p) && p > 0);
        if (prix.length < 2) { echecs.push({ nom: l.nom, e: `${prix.length} prix connu(s) sur ${exAequo.length} ex aequo` }); continue; }
        const min = Math.min(...prix), max = Math.max(...prix);
        fourchettes.push({ nom: l.nom, numero: l.numero, n: exAequo.length, min, max, rapport: max / min });
    }

    console.log('── LES FOURCHETTES REJOUÉES ──');
    for (const f of fourchettes.sort((a, b) => a.rapport - b.rapport)) {
        console.log(`   ${String(f.nom).padEnd(20)} #${String(f.numero ?? '—').padEnd(5)} ${String(f.n).padStart(2)} ex aequo` +
            `   ${f.min.toFixed(2).padStart(8)} € -> ${f.max.toFixed(2).padStart(9)} €   rapport ×${f.rapport.toFixed(1)}`);
    }
    const rap = fourchettes.map(f => f.rapport);
    console.log(`\n   rejouées : ${fourchettes.length} / ${lignes.length}   ·   non rejouables : ${echecs.length}`);
    if (rap.length) {
        console.log(`   rapport max/min — min ×${Math.min(...rap).toFixed(1)} · médiane ×${med(rap).toFixed(1)} · q75 ×${q(rap, .75).toFixed(1)} · max ×${Math.max(...rap).toFixed(1)}`);
        for (const seuil of [1.5, 2, 3, 5, 10]) {
            const n = rap.filter(x => x <= seuil).length;
            console.log(`   fourchettes ≤ ×${String(seuil).padEnd(4)} : ${n}/${rap.length}  (${(100 * n / rap.length).toFixed(0)} %)`);
        }
    }
    if (echecs.length) {
        console.log('\n── non rejouables (comptées, jamais devinées) ──');
        const par = new Map();
        for (const e of echecs) par.set(e.e.replace(/\d+/g, 'N'), (par.get(e.e.replace(/\d+/g, 'N')) || 0) + 1);
        for (const [k, n] of [...par].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(3)} × ${k}`);
    }

    console.log('\n' + '═'.repeat(74));
    console.log('CE QUI RESTE IMPOSSIBLE À MESURER, ET POURQUOI');
    console.log('═'.repeat(74));
    console.log('  `prixVinted` : renseigné sur 0 des 142 lignes du journal.');
    console.log('  /api/identifier ne reçoit AUCUN prix — corps = { imageUrl, imageUrls, title, vintedEtat }.');
    console.log('  Impossible donc de compter combien de refus auraient une fourchette entièrement');
    console.log('  d\'un côté du prix : le côté n\'existe nulle part. Et le SEUIL demandé ne peut pas');
    console.log('  être justifié par une mesure — il faudrait des paires (prix guide, prix Vinted réel),');
    console.log('  qui sont exactement ce qui manque.');
    await mongoose.disconnect();
})().catch(e => { console.error(e.stack); process.exit(1); });
