// ============================================================
// SAISIE DES VÉRITÉS DU BANC — une carte à la fois, sans se faire influencer
// ============================================================
// LE GOULOT RÉEL. Soixante-dix cartes à vérifier une par une, c'est plusieurs heures, et
// c'est là qu'on bâcle. Cet outil ne remplace pas la vérification — il la rend supportable
// et surtout TRAÇABLE.
//
// ⚠️ LE PIÈGE QU'IL ÉVITE : VOIR LA RÉPONSE DE LA CHAÎNE AVANT DE SE PRONONCER.
// Si l'outil affichait d'emblée les candidats classés, le premier de la liste deviendrait
// la réponse par défaut — et le banc mesurerait alors l'accord de l'opérateur avec la
// chaîne, pas la vérité. C'est la même famille de défaut que « la référence tirée du
// système mesuré », qui a déjà coûté deux réussites comptées comme des régressions.
// D'où le déroulé en deux temps :
//   1. la carte SEULE : l'image, et ce que l'IA a lu. Rien d'autre.
//   2. les candidats, UNIQUEMENT si on les demande — et le fait de les avoir demandés est
//      ENREGISTRÉ dans la provenance de la vérité.
// On ne l'interdit pas : parfois il faut voir la liste pour reconnaître une carte. Mais une
// vérité saisie à l'aveugle et une vérité saisie après avoir vu la liste ne valent pas la
// même chose, et le banc doit pouvoir les distinguer.
//
// CE QU'IL ÉCRIT : banc-verites.json, indexé par CLÉ, avec la provenance et la date. Rien
// n'est écrit en base. Le fichier est relu à chaque lancement : on peut s'arrêter et
// reprendre.
//
// USAGE :
//   node saisir-verites.js              les scans du holdout non encore saisis
//   node saisir-verites.js --tout       y compris ceux déjà saisis (pour corriger)
//   node saisir-verites.js --seau=verification

require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const mongoose = require('mongoose');
const S = require('./scoring.js');
const { numeroEstUnDexId } = require('./pokedex');
const { trouverProduitsLocaux, scorerCandidatsLocal, lireCodeSets, lireNumeros } = require('./index');

const SORTIE = 'banc-verites.json';
const DATE_HOLDOUT = new Date('2026-08-03T00:00:00Z');
const J = mongoose.model('Jv', new mongoose.Schema({}, { strict: false }), 'journal_scans');
const Cat = mongoose.model('Pv', new mongoose.Schema({}, { strict: false }), 'catalogue_produits');
const CS = mongoose.model('Cv', new mongoose.Schema({}, { strict: false }), 'codes_set');

const seauVoulu = (process.argv.find(a => a.startsWith('--seau=')) || '--seau=holdout').split('=')[1];
const tout = process.argv.includes('--tout');

let VERIFICATION = [];
try { VERIFICATION = (require('./banc-verification.json').cartes || []).map(c => ({ ...c, declareLe: new Date(c.declareLe) })); } catch (_) { }
const estVerification = d => VERIFICATION.some(c =>
    String(d.nom || '').trim() === String(c.nom).trim()
    && String(d.numero ?? '').trim() === String(c.numero).trim()
    && d.le >= c.declareLe);
const seauDe = d => (!(d.le instanceof Date) || d.le < DATE_HOLDOUT) ? 'entrainement'
    : (estVerification(d) ? 'verification' : 'holdout');

function lireVerites() {
    try { return JSON.parse(fs.readFileSync(SORTIE, 'utf8')); }
    catch (_) { return { _lisezMoi: 'Vérités du banc, saisies à la main. `source` dit COMMENT elles ont été obtenues.', verites: {} }; }
}
function ecrireVerites(v) { fs.writeFileSync(SORTIE, JSON.stringify(v, null, 2), 'utf8'); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const demander = q => new Promise(r => rl.question(q, x => r(x.trim())));

(async () => {
    const t0 = Date.now();
    while (mongoose.connection.readyState !== 1 && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 100));
    const lignes = await CS.find({}, { idExpansion: 1, codeSet: 1, region: 1 }).lean();
    const parExp = new Map(lignes.map(l => [Number(l.idExpansion), l]));

    const docs = (await J.find({}).sort({ le: 1 }).lean()).filter(d => seauDe(d) === seauVoulu);
    const vues = new Map();
    for (const d of docs) {
        const k = `${d.nom ?? ''}|${d.numero ?? ''}|${d.setCode ?? ''}|${d.total ?? ''}`;
        if (!vues.has(k)) vues.set(k, d);
    }
    const prefixe = { holdout: 'H', verification: 'V', entrainement: 'JP' }[seauVoulu] || 'X';
    const cartes = [...vues.values()].map((d, i) => ({ cle: `${prefixe}${String(i + 1).padStart(3, '0')}`, d }));

    const V = lireVerites();
    const aFaire = cartes.filter(c => tout || V.verites[c.cle] === undefined);
    console.log(`\n${cartes.length} carte(s) dans le seau « ${seauVoulu} », ${aFaire.length} à saisir.\n`);
    if (!aFaire.length) { rl.close(); await mongoose.disconnect(); return; }

    for (let i = 0; i < aFaire.length; i++) {
        const { cle, d } = aFaire[i];
        console.log('\n' + '═'.repeat(78));
        console.log(`  ${cle}   (${i + 1}/${aFaire.length})   scanné le ${d.le?.toISOString?.().slice(0, 16)}   build ${d.version ?? '?'}`);
        console.log('═'.repeat(78));
        console.log(`  IMAGE   : ${d.imageUrl ?? '(non enregistrée)'}`);
        console.log(`  ANNONCE : ${d.vintedUrl ?? '(non enregistrée — l\'extension ne l\'envoie pas encore)'}`);
        console.log(`\n  CE QUE L'IA A LU :`);
        console.log(`     nom ......... ${d.nom ?? '—'}${d.nomBrut ? `   (brut : ${d.nomBrut})` : ''}`);
        console.log(`     numéro ...... ${d.numero ?? '—'}        total : ${d.total ?? '—'}`);
        console.log(`     setCode ..... ${d.setCode ?? '—'}        langue : ${d.langue ?? '—'}`);
        console.log(`     rareté ...... ${d.rarete ?? '—'}        symbole : ${d.symboleSet ?? '—'}`);
        console.log(`     confiance du nom : ${d.nomConfiance ?? '—'}`);

        let vuLesCandidats = false;
        let reponse = '';
        while (true) {
            reponse = await demander(`\n  idProduct de la VRAIE carte ? (« inconnu » · « ? » pour voir les candidats · « q » pour arrêter)\n  > `);
            if (reponse === '?') {
                if (!vuLesCandidats) {
                    vuLesCandidats = true;
                    console.log('\n  ⚠️ Les candidats vont s\'afficher. Ce fait sera enregistré dans la provenance :');
                    console.log('     une vérité saisie APRÈS avoir vu la liste ne vaut pas une vérité saisie à l\'aveugle.');
                }
                await afficherCandidats(d, parExp);
                continue;
            }
            break;
        }
        if (reponse.toLowerCase() === 'q') { console.log('\n  Arrêt demandé. Ce qui a été saisi est conservé.'); break; }

        const V2 = lireVerites();
        if (reponse.toLowerCase() === 'inconnu' || reponse === '') {
            V2.verites[cle] = {
                idProduct: 'inconnu',
                source: vuLesCandidats ? 'inconnu-apres-candidats' : 'inconnu-a-l-aveugle',
                lu: { nom: d.nom, numero: d.numero, total: d.total, setCode: d.setCode },
                saisiLe: new Date().toISOString()
            };
            console.log('  -> marqué « inconnu ». Cette ligne sera EXCLUE du calcul, jamais comptée juste.');
        } else if (/^\d+$/.test(reponse)) {
            const p = await Cat.findOne({ idProduct: Number(reponse) }).lean();
            if (!p) { console.log(`  ⚠️ aucun produit ${reponse} au catalogue — rien n'a été enregistré, on repasse dessus au prochain lancement.`); continue; }
            const cs = parExp.get(Number(p.idExpansion));
            console.log(`  -> ${p.idProduct} « ${String(p.name).split('[')[0].trim()} » [${cs?.codeSet ?? '?'} / ${cs?.region ?? 'INCONNUE'}]`);
            V2.verites[cle] = {
                idProduct: Number(reponse),
                nom: String(p.name).split('[')[0].trim(),
                codeSet: cs?.codeSet ?? null,
                source: vuLesCandidats ? 'saisie-apres-candidats' : 'saisie-a-l-aveugle',
                lu: { nom: d.nom, numero: d.numero, total: d.total, setCode: d.setCode },
                saisiLe: new Date().toISOString()
            };
        } else { console.log('  ⚠️ réponse non comprise — rien enregistré, on repassera dessus.'); continue; }
        ecrireVerites(V2);
    }

    const V3 = lireVerites();
    const n = Object.keys(V3.verites).length;
    const aveugle = Object.values(V3.verites).filter(v => String(v.source).includes('aveugle')).length;
    console.log(`\n${SORTIE} : ${n} vérité(s) enregistrée(s), dont ${aveugle} à l'aveugle et ${n - aveugle} après avoir vu les candidats.`);
    rl.close();
    await mongoose.disconnect();
})().catch(async e => { console.error('ERREUR', e.message, e.stack); rl.close(); try { await mongoose.disconnect(); } catch (_) { } process.exit(1); });

// Les candidats, à la demande seulement. Volontairement affichés PAR PRIX CROISSANT et non
// par score : l'ordre du scoring désignerait un favori, et c'est précisément ce qu'on ne
// veut pas suggérer.
async function afficherCandidats(d, parExp) {
    const dex = numeroEstUnDexId({ nom: d.nom, numero: d.numero, total: d.total, langue: d.langue });
    const produits = await trouverProduitsLocaux(d.nom);
    if (!produits.length) { console.log('\n     (aucun candidat par le nom)'); return; }
    const cs = await lireCodeSets(produits.map(p => p.idExpansion));
    const r = await scorerCandidatsLocal(produits, {
        name: d.nom, number: dex.estDex ? null : d.numero, total: d.total, setCode: d.setCode,
        language: d.langue, motif: null, reverse: false
    }, null, [], cs, {});
    const nums = await lireNumeros(r.scores.map(s => s.candidat.idProduct));
    const liste = r.scores.slice(0, 15).sort((a, b) => (a.candidat.prix ?? 0) - (b.candidat.prix ?? 0));
    console.log(`\n     ${r.scores.length} candidat(s) — les 15 premiers, PAR PRIX (pas par score : l'ordre du scoring désignerait un favori)`);
    for (const s of liste) {
        const p = produits.find(x => x.idProduct === s.candidat.idProduct);
        const c = parExp.get(Number(s.candidat.idExpansion));
        const nu = nums.get(s.candidat.idProduct);
        console.log(`       ${String(s.candidat.idProduct).padEnd(8)} ${String(c?.codeSet ?? '?').padEnd(9)} ${String(c?.region ?? 'INCONNUE').padEnd(11)} n°${String(nu?.numero ?? nu?.numeroUrl ?? '—').padEnd(6)} ${String(s.candidat.prix ?? '—').padStart(8)} €  ${String(p?.name ?? '').split('[')[0].trim()}`);
    }
}
