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

// ⚠️ SEAUX ET NUMÉROTATION : UNE SEULE SOURCE, partagée avec le banc. Ce fichier avait sa
// PROPRE copie de `seauDe` — trois seaux au lieu de quatre — et n'excluait pas les lignes
// hors service. Conséquence mesurée : 32 vérités saisies une par une sous H009..H033 quand
// le banc numérotait L001..L025. Aucune n'est arrivée, et rien ne le disait.
// Voir banc-seaux.js : deux définitions de la même règle divergent toujours.
const { seauDe, numeroter } = require('./banc-seaux');

function lireVerites() {
    try { return JSON.parse(fs.readFileSync(SORTIE, 'utf8')); }
    catch (_) { return { _lisezMoi: 'Vérités du banc, saisies à la main. `source` dit COMMENT elles ont été obtenues.', verites: {} }; }
}
function ecrireVerites(v) { fs.writeFileSync(SORTIE, JSON.stringify(v, null, 2), 'utf8'); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const demander = q => new Promise(r => rl.question(q, x => r(x.trim())));

const NumeroCarte = mongoose.model('Nvs', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');

/**
 * RÉSOUT CE QUE LE TESTEUR A SOUS LES YEUX vers un idProduct.
 *
 * POURQUOI. L'idProduct est une donnée INTERNE : elle n'apparaît nulle part sur Cardmarket.
 * Exiger qu'elle soit tapée à la main, c'est garantir des fautes de frappe silencieuses sur
 * soixante-dix lignes — et une vérité fausse est pire qu'une vérité manquante, parce qu'elle
 * ne se signale pas. Ce que le testeur a réellement devant lui, c'est l'URL de la fiche ou
 * son slug : « Rhydon-V2-EC4055 ».
 *
 * ⚠️ ELLE REFUSE PLUTÔT QUE D'APPROCHER. Aucun repli sur « le plus proche » : un slug
 * inconnu est rejeté avec son message. C'est le quatrième principe appliqué à la saisie —
 * ne rien trouver n'autorise pas à désigner quelque chose.
 *
 * ⚠️ ET ELLE NE TRANCHE PAS ENTRE LES VARIANTES. Un même slug peut couvrir V1/V2/V3 : on
 * les montre toutes et c'est le testeur qui choisit. Choisir à sa place reviendrait à
 * remettre le jugement de la chaîne dans la vérité censée la juger.
 *
 * @returns {Promise<{ok: boolean, idProduct?: number, moyen: string, message?: string, choix?: object[]}>}
 */
async function resoudreSaisie(saisie, Cat) {
    const brut = String(saisie).trim();
    if (/^\d+$/.test(brut)) return { ok: true, idProduct: Number(brut), moyen: 'idProduct' };

    // Une URL Cardmarket : le dernier segment est le slug du produit, l'avant-dernier le
    // slug du set. Le second sert à départager si le slug seul est ambigu.
    let moyen = 'slug', slug = brut, slugSet = null;
    if (/^https?:\/\//i.test(brut)) {
        moyen = 'url';
        const segments = brut.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/');
        slug = decodeURIComponent(segments[segments.length - 1] || '');
        slugSet = decodeURIComponent(segments[segments.length - 2] || '') || null;
        if (!slug) return { ok: false, moyen, message: 'URL sans segment final exploitable' };
    }

    // Recherche EXACTE d'abord, puis insensible à la casse — jamais approchée.
    const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let docs = await NumeroCarte.find({ slug }).lean();
    if (!docs.length) docs = await NumeroCarte.find({ slug: new RegExp(`^${echapper(slug)}$`, 'i') }).lean();
    if (!docs.length) {
        return { ok: false, moyen, message: `aucun produit ne porte le slug « ${slug} » — rien n'est enregistré` };
    }
    // Le slug du set, quand l'URL le fournit, lève une éventuelle ambiguïté.
    if (docs.length > 1 && slugSet) {
        const filtres = docs.filter(d => String(d.slugSet || '').toLowerCase() === slugSet.toLowerCase());
        if (filtres.length) docs = filtres;
    }
    if (docs.length === 1) return { ok: true, idProduct: docs[0].idProduct, moyen };

    const choix = [];
    for (const d of docs) {
        const p = await Cat.findOne({ idProduct: d.idProduct }).lean();
        choix.push({ idProduct: d.idProduct, nom: String(p?.name ?? '').split('[')[0].trim(), numero: d.numero || d.numeroUrl || null, variante: d.variante || null, slugSet: d.slugSet || null });
    }
    return { ok: false, moyen, choix, message: `${docs.length} produits portent ce slug` };
}

(async () => {
    const t0 = Date.now();
    while (mongoose.connection.readyState !== 1 && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 100));
    const lignes = await CS.find({}, { idExpansion: 1, codeSet: 1, region: 1 }).lean();
    const parExp = new Map(lignes.map(l => [Number(l.idExpansion), l]));

    // ⚠️ ON NUMÉROTE TOUT LE CORPUS, PUIS ON FILTRE. Jamais l'inverse : filtrer d'abord
    // faisait dépendre la clé de la question posée, et c'est ce qui a détaché 32 vérités.
    const docs = (await J.find({}).sort({ le: 1 }).lean());
    const { lignes } = numeroter(docs);
    const cartes = lignes.filter(l => l.seau === seauVoulu).map(l => ({ cle: l.cle, d: l.d }));

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
            reponse = await demander(`\n  La VRAIE carte ? — idProduct, slug (Rhydon-V2-EC4055) ou URL Cardmarket\n  (« inconnu » · « ? » pour voir les candidats · « q » pour arrêter)\n  > `);
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
                moyen: 'inconnu',
                lu: { nom: d.nom, numero: d.numero, total: d.total, setCode: d.setCode },
                saisiLe: new Date().toISOString()
            };
            console.log('  -> marqué « inconnu ». Cette ligne sera EXCLUE du calcul, jamais comptée juste.');
        } else {
            const r = await resoudreSaisie(reponse, Cat);
            if (!r.ok) {
                console.log(`  ⚠️ ${r.message} — RIEN n'a été enregistré, on repassera sur cette carte.`);
                if (r.choix) {
                    // On MONTRE les variantes et on ne choisit pas : trancher à la place du
                    // testeur remettrait le jugement de la chaîne dans la vérité censée la juger.
                    console.log('     Retape la réponse avec l\'idProduct de la bonne variante :');
                    for (const c of r.choix) {
                        console.log(`       ${String(c.idProduct).padEnd(8)} n°${String(c.numero ?? '—').padEnd(6)} variante ${String(c.variante ?? '—').padEnd(4)} [${c.slugSet ?? '?'}]  ${c.nom}`);
                    }
                }
                continue;
            }
            const p = await Cat.findOne({ idProduct: r.idProduct }).lean();
            if (!p) { console.log(`  ⚠️ aucun produit ${r.idProduct} au catalogue — rien n'a été enregistré.`); continue; }
            const cs = parExp.get(Number(p.idExpansion));
            console.log(`  -> ${p.idProduct} « ${String(p.name).split('[')[0].trim()} » [${cs?.codeSet ?? '?'} / ${cs?.region ?? 'INCONNUE'}]   (désigné par ${r.moyen})`);
            V2.verites[cle] = {
                idProduct: r.idProduct,
                nom: String(p.name).split('[')[0].trim(),
                codeSet: cs?.codeSet ?? null,
                // DEUX PROVENANCES DISTINCTES, parce qu'elles répondent à deux questions
                // différentes le jour où une vérité se révèle fausse : ai-je été influencé
                // par la liste des candidats, et par quel chemin la vérité est-elle entrée ?
                source: vuLesCandidats ? 'saisie-apres-candidats' : 'saisie-a-l-aveugle',
                moyen: r.moyen,          // 'idProduct' | 'slug' | 'url'
                saisieBrute: reponse,    // ce qui a été tapé, tel quel
                lu: { nom: d.nom, numero: d.numero, total: d.total, setCode: d.setCode },
                saisiLe: new Date().toISOString()
            };
        }
        ecrireVerites(V2);
    }

    const V3 = lireVerites();
    const n = Object.keys(V3.verites).length;
    const aveugle = Object.values(V3.verites).filter(v => String(v.source).includes('aveugle')).length;
    const parMoyen = new Map();
    for (const v of Object.values(V3.verites)) parMoyen.set(v.moyen ?? '?', (parMoyen.get(v.moyen ?? '?') || 0) + 1);
    console.log(`\n${SORTIE} : ${n} vérité(s) enregistrée(s), dont ${aveugle} à l'aveugle et ${n - aveugle} après avoir vu les candidats.`);
    console.log(`   par moyen de désignation : ${[...parMoyen.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`);
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
