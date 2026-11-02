'use strict';
// ============================================================
// CALIBRATION DE LA RÈGLE DU NOM TRADUIT (collecte-cartes/preuves.js : Pokédex + PV + règle + code du set + numéro) — LECTURE SEULE
// ============================================================
//   node mesures/calibrer-nom-traduit.js --env=<.env> --sortie=<fichier.json>                 (visuels déjà posés, langue connue)
//   node mesures/calibrer-nom-traduit.js --env=<.env> --sortie=<f.json> --ouvrables=<liste.json> (+ combien d'une liste de produits la règle OUVRIRAIT)
// Lit les bases par les connexions de LECTURE (MONGODB_CARTES_LECTURE_URI, MONGODB_LECTURE_URI), n'écrit rien nulle part, ne fait aucune requête réseau hors Atlas. ~15 min (requête non indexée).
// Les fonctions jugées sont CELLES DE LA PRODUCTION (PV.evaluerPreuveLue, TPC.dexDuNom…) : rien n'est recopié.
//
// CE QUE LA MESURE FAIT : prend chaque visuel DÉJÀ posé (cartes.images, langue ja / zh-hans / zh-hant / id / th, numéro connu, un seul produit sur la fiche, tirage du set = langue du visuel), fabrique la
// lecture « vraie » que le chasseur aurait faite (Pokédex, PV, règle, code, numéro de la carte), et regarde si la règle l'accepte (RAPPEL, par variante : fiche simple sans carte, avec carte, code par le
// slug seul, par la ligne seule, table japonaise interne). Puis elle ATTAQUE : PAIRES CROISÉES d'un même set — les témoins (nom, Pokédex, PV) de la carte A présentés avec le numéro et le code du produit B.
//   · à Pokédex DIFFÉRENT (la mesure qui PEUT échouer) : 0 accepté attendu, le script sort en code 1 sinon ;
//   · à Pokédex ET règle identiques : acceptées par construction (le témoin ne sépare pas deux cartes de même espèce et même règle — c'est le « jumeau », marqué par la preuve) : comptées, pas jugées.
//   · entre sets différents : 0 attendu.
// Dénominateurs imprimés : échantillons, vérités écartées (ndex de la carte contredit par la table), paires.
//
// CE QU'ELLE NE MESURE PAS : un NUMÉRO MAL LU SUR UN JUMEAU. Si le chasseur lit « 014 » au lieu de « 006 » sur deux cartes de même espèce et même règle d'un même set, rien ici ne le voit : le témoin (Pokédex, règle)
// est le même, le code du set aussi. Cette erreur-là ne se rattrape que par la rognure du numéro regardée par le coordinateur (marque `jumeau-dans-le-set`). Elle ne mesure pas non plus la LANGUE du scan
// (saisie du chasseur, jamais lue sur l'image) ni la vérité de nos propres visuels posés (une vérité fausse chez nous rend un faux accord).
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || null;
const envFichier = arg('env'), sortie = arg('sortie'), listeOuvrables = arg('ouvrables');
if (!sortie) { console.error('usage : --env=<.env> --sortie=<fichier.json> [--ouvrables=<liste.json>]'); process.exit(2); }
if (envFichier) require('dotenv').config({ path: envFichier });
for (const v of ['MONGODB_CARTES_LECTURE_URI', 'MONGODB_LECTURE_URI']) if (!process.env[v]) { console.error(`${v} absente : lecture seule impossible, rien n'est ouvert`); process.exit(2); }
const { MongoClient } = require('mongodb');
const PV = require(path.join(R, 'collecte-cartes/preuves.js'));
const TPC = require(path.join(R, 'collecte-cartes/tpc.js'));
const J = require(path.join(R, 'collecte-cartes/jointure.js'));
const CO = require(path.join(R, 'collecte-cartes/comblement.js'));
const LANGUES = ['ja', 'zh-hans', 'zh-hant', 'id', 'th'];
const MOTS_DE_REGLE = /^(VMAX|VSTAR|V-?UNION|GX|BREAK|LV\.?X|ex|EX|V|Mega|X|Y)$/i;
// la règle imprimée sur la carte, en lettres latines (ce que le chasseur lirait) : les mots de règle du nom anglais, tels quels
const reglesLues = nomEn => String(nomEn ?? '').split('[')[0].split(/\s+/).filter(w => MOTS_DE_REGLE.test(w)).join(' ');
const reglesNom = n => TPC.reglesDuNom(String(n ?? '').split('[')[0]);

(async () => {
    const cl = new MongoClient(process.env.MONGODB_CARTES_LECTURE_URI); await cl.connect();
    const pl = new MongoClient(process.env.MONGODB_LECTURE_URI); await pl.connect();
    const db = cl.db('cartes'), prod = pl.db('test');
    const sor = { le: new Date().toISOString() };
    try {
        const nomEtat = CO.dernierEtat(fs.readdirSync(CO.DOSSIER_COMPTEURS)).fichier;
        const etat = JSON.parse(fs.readFileSync(path.join(CO.DOSSIER_COMPTEURS, nomEtat), 'utf8'));
        const etatDe = new Map(etat.map(p => [p.idProduct, p]));
        console.log(`état ${nomEtat} : ${etat.length} produits`);
        const avecJa = await db.collection('cartes').find({ nomJa: { $nin: [null, ''] }, _id: { $gt: 0 } }, { projection: { nomEn: 1, nomJa: 1 } }).toArray();
        const codes = new Map((await prod.collection('codes_set').find({}, { projection: { _id: 0, idExpansion: 1, codeSet: 1 } }).toArray()).filter(c => c.codeSet).map(c => [c.idExpansion, c.codeSet]));
        console.log(`cartes à nomJa ${avecJa.length} · codes_set ${codes.size}`);

        // ── 1. les visuels posés ──
        const cartes = await db.collection('cartes').find({ 'images.langue': { $in: LANGUES } }, { projection: { nomEn: 1, nomJa: 1, ndex: 1, pv: 1, categorie: 1, images: 1 } }).toArray();
        const cp = await db.collection('cartes_produits').find({ carteId: { $in: cartes.map(c => c._id) } }, { projection: { _id: 0, idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1, idExpansion: 1, slug: 1 } }).toArray();
        const cpDe = new Map(); for (const l of cp) { const k = `${l.carteId}|${l.slugSet}`; (cpDe.get(k) || cpDe.set(k, []).get(k)).push(l); }
        const ids = [...new Set(cp.map(l => l.idProduct))];
        const nums = new Map(); for (let i = 0; i < ids.length; i += 1000) for (const n of await prod.collection('numeros_cartes').find({ idProduct: { $in: ids.slice(i, i + 1000) } }, { projection: { _id: 0, idProduct: 1, slug: 1 } }).toArray()) nums.set(n.idProduct, n);
        const setsT = new Map((await db.collection('sets').find({}, { projection: { tirage: 1, region: 1 } }).toArray()).map(s => [s._id, s.tirage ?? s.region]));
        const tousDuSet = new Map();   // slugSet -> tous les produits (jumeaux : le plan lit le même)
        for (let i = 0; i < 1; i++) {
            const slugs = [...new Set(cp.map(l => l.slugSet))];
            for (let j = 0; j < slugs.length; j += 200) for (const l of await db.collection('cartes_produits').find({ slugSet: { $in: slugs.slice(j, j + 200) } }, { projection: { _id: 0, idProduct: 1, slugSet: 1, numeroFiche: 1 } }).toArray()) (tousDuSet.get(l.slugSet) || tousDuSet.set(l.slugSet, []).get(l.slugSet)).push({ idProduct: l.idProduct, numero: l.numeroFiche ?? null, nomEn: etatDe.get(l.idProduct)?.name ?? null });
        }
        const echs = []; let ecartes = { sansProduitUnique: 0, tirageDifferent: 0, ndexContredit: 0 };
        for (const c of cartes) for (const im of c.images) {
            if (!LANGUES.includes(im.langue) || im.numero == null || !im.set) continue;
            const ls = (cpDe.get(`${c._id}|${im.set}`) || []).filter(l => J.cleNumero(String(l.numeroFiche ?? '')) === J.cleNumero(String(im.numero)));
            if (ls.length !== 1) { ecartes.sansProduitUnique++; continue; }
            const L = ls[0], E = etatDe.get(L.idProduct); if (!E) { ecartes.sansProduitUnique++; continue; }
            if (CO.langueDuTirage(E.langue) !== im.langue || setsT.get(im.set) !== E.langue) { ecartes.tirageDifferent++; continue; }
            // une vérité dont le ndex est contredit par la table du dépôt n'est pas une vérité (ex. des Magnemite à ndex 82) : écartée et comptée
            const dn = TPC.dexDuNom(J.decomposerNomCardmarket(c.nomEn ?? '').nom);
            if (Number.isInteger(c.ndex) && dn && !dn.includes(c.ndex)) { ecartes.ndexContredit++; continue; }
            echs.push({ carte: c, im, L, E, nm: nums.get(L.idProduct) ?? null });
        }
        const parLangue = Object.fromEntries(LANGUES.map(l => [l, echs.filter(s => s.im.langue === l).length]));
        console.log(`DÉNOMINATEUR : ${cartes.length} cartes à visuel asiatique → ${echs.length} échantillons ${JSON.stringify(parLangue)} · écartés ${JSON.stringify(ecartes)}`);
        Object.assign(sor, { etat: nomEtat, cartes: cartes.length, echantillons: echs.length, parLangue, ecartes });

        const construire = (s, { avecCarte, slugSeul, ligneSeule, avecTable }) => {
            const { carte, im, L, E, nm } = s;
            const code = codes.get(E.idExpansion ?? L.idExpansion) ?? null, slug = L.slug ?? nm?.slug ?? null;
            const p = { idProduct: L.idProduct, idExpansion: E.idExpansion ?? L.idExpansion, tirage: E.langue, tamponnee: E.tamponnee ?? null, numero: L.numeroFiche, carteId: avecCarte ? carte._id : -1, slugSet: L.slugSet, slug: ligneSeule ? 'x' : slug, nomEn: E.name, nomFr: null, nomJa: null, codeSet: slugSeul ? null : code, autresDuSet: tousDuSet.get(L.slugSet) ?? [] };
            if (avecCarte) { p.nomEnCarte = carte.nomEn ?? null; p.ndex = carte.ndex ?? null; p.pv = carte.pv ?? null; p.categorie = carte.categorie ?? null; }
            if (avecTable && carte.nomEn) p.tableJaInterne = TPC.construireTemoinNomJa(avecJa.filter(x => x._id !== carte._id && x.nomEn === carte.nomEn))(String(carte.nomEn));
            const nomLu = im.langue === 'ja' && carte.nomJa ? carte.nomJa : `名${reglesLues(carte.nomEn)}`;
            const codeLu = code ?? (slug ? (slug.split('-').pop().replace(/\d+[A-Za-z]*$/, '') || null) : null);
            const lu = { nom: nomLu, numero: String(L.numeroFiche), total: '999', langue: im.langue, tampon: null, finition: 'normale', marques: ['calib'], codeSet: codeLu };
            if (Number.isInteger(carte.ndex) && carte.ndex > 0) lu.dex = carte.ndex;
            const pvn = Number(carte.pv); if (Number.isInteger(pvn) && pvn > 0) lu.pv = pvn;
            return { p, lu };
        };
        const juger = (p, lu) => PV.evaluerPreuveLue({ entree: { lu, attendu: { numero: p.numero }, contradictions: [] }, produit: p, langueProduit: PV.langueDuProduit(p) });
        const motifNom = r => r.motifs.find(m => /^(nom-|pokedex|pv-|regle-|code-set|forme-regionale|ndex-|fiche-simple|table-ja)/.test(m)) ?? (r.motifs[0] ?? null);

        const variantes = { 'fiche simple (sans carte, code par slug OU ligne)': { avecCarte: false }, 'fiche simple, code par le SLUG seul': { avecCarte: false, slugSeul: true }, 'fiche simple, code par la LIGNE seule': { avecCarte: false, ligneSeule: true },
            'avec carte (ndex/PV/catégorie lus)': { avecCarte: true }, 'fiche simple japonaise + table interne (leave-one-out, ≥ 2 cartes)': { avecCarte: false, avecTable: true } };
        sor.bilan = {};
        for (const [nomV, opt] of Object.entries(variantes)) {
            const par = {};
            for (const s of echs) {
                if (opt.avecTable && s.im.langue !== 'ja') continue;
                const { p, lu } = construire(s, opt); const r = juger(p, lu);
                const o = par[s.im.langue] || (par[s.im.langue] = { n: 0, accepte: 0, avecMarque: {}, refus: {} });
                o.n++;
                if (r.ok) { o.accepte++; for (const d of r.drapeaux ?? []) o.avecMarque[d] = (o.avecMarque[d] || 0) + 1; } else { const m = motifNom(r); o.refus[m] = (o.refus[m] || 0) + 1; }
            }
            sor.bilan[nomV] = par;
            console.log(`${nomV} : ${LANGUES.filter(l => par[l]).map(l => `${l} ${par[l].accepte}/${par[l].n}`).join(' · ')}`);
        }

        // ── 2. les paires croisées d'un même set (témoins de A, numéro et code de B) ──
        const parSet = new Map(); for (const s of echs) (parSet.get(s.im.set) || parSet.set(s.im.set, []).get(s.im.set)).push(s);
        const dexDe = s => { const d = TPC.dexDuNom(J.decomposerNomCardmarket(s.E.name).nom); return Number.isInteger(s.carte.ndex) ? s.carte.ndex : (d && d.length === 1 ? d[0] : null); };
        const croise = (avecCarte) => ({ avecCarte, paires: 0, dexDifferent: { n: 0, acceptees: 0, exemples: [] }, memeDexMemeRegle: { n: 0, acceptees: 0 }, memeDexAutreRegle: { n: 0, acceptees: 0 }, dexInconnu: { n: 0, acceptees: 0 } });
        const cr = [croise(false), croise(true)];
        let rng = 12345; const rnd = () => (rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296;
        for (const [, liste] of parSet) {
            if (liste.length < 2) continue;
            for (const A of liste) for (let t = 0; t < 4; t++) {
                const B = liste[Math.floor(rnd() * liste.length)];
                if (B === A || J.cleNumero(String(B.L.numeroFiche)) === J.cleNumero(String(A.L.numeroFiche))) continue;
                const dA = dexDe(A), dB = dexDe(B);
                const classe = dA == null || dB == null ? 'dexInconnu' : dA !== dB ? 'dexDifferent' : reglesNom(A.carte.nomEn) === reglesNom(B.E.name) ? 'memeDexMemeRegle' : 'memeDexAutreRegle';
                for (const c of cr) {
                    const a = construire(A, { avecCarte: false }), b = construire(B, { avecCarte: c.avecCarte });
                    // le numéro est la seule chose qui change : les témoins sont ceux de A, le numéro et le code ceux de B
                    const r = juger(b.p, { ...a.lu, numero: b.lu.numero, codeSet: b.lu.codeSet, langue: b.lu.langue });
                    c.paires++; c[classe].n++;
                    if (r.ok) { c[classe].acceptees++; if (classe === 'dexDifferent' && c[classe].exemples.length < 8) c[classe].exemples.push({ A: A.carte.nomEn, B: B.carte.nomEn, produitB: B.E.name, set: A.im.set }); }
                }
            }
        }
        sor.croise_meme_set = cr;
        for (const c of cr) console.log(`PAIRES CROISÉES d'un même set (${c.avecCarte ? 'avec carte' : 'fiche simple'}) : ${c.paires} paires · Pokédex DIFFÉRENT ${c.dexDifferent.acceptees}/${c.dexDifferent.n} acceptées (0 attendu) · même Pokédex et même règle ${c.memeDexMemeRegle.acceptees}/${c.memeDexMemeRegle.n} (jumeaux, non jugées) · même Pokédex, autre règle ${c.memeDexAutreRegle.acceptees}/${c.memeDexAutreRegle.n} (0 attendu) · Pokédex inconnu ${c.dexInconnu.acceptees}/${c.dexInconnu.n}`);
        const hors = { n: 0, acceptees: 0 };
        for (let i = 0; i < 4000; i++) {
            const A = echs[Math.floor(rnd() * echs.length)], B = echs[Math.floor(rnd() * echs.length)];
            if (A.im.set === B.im.set || A.im.langue !== B.im.langue) continue;
            const a = construire(A, { avecCarte: false }), b = construire(B, { avecCarte: false });
            hors.n++; if (juger(b.p, { ...a.lu, langue: b.lu.langue }).ok) hors.acceptees++;
        }
        sor.croise_autres_sets = hors;
        console.log(`PAIRES entre sets différents : ${hors.acceptees}/${hors.n} acceptées (0 attendu)`);

        // ── 3. combien d'une liste de produits la règle ouvrirait (la lecture « parfaite » suppose que le chasseur lit Pokédex, PV et code) ──
        if (listeOuvrables) {
            const liste = JSON.parse(fs.readFileSync(listeOuvrables, 'utf8'));
            const temoin = TPC.construireTemoinNomJa(avecJa);
            const cIds = liste.filter(x => x.carteId > 0).map(x => x.carteId);
            const cartesL = new Map((await db.collection('cartes').find({ _id: { $in: cIds } }, { projection: { nomEn: 1, nomJa: 1, ndex: 1, pv: 1, categorie: 1 } }).toArray()).map(c => [c._id, c]));
            const tousSets = new Map();
            const slugsL = [...new Set(liste.map(x => x.set))];
            for (let j = 0; j < slugsL.length; j += 200) for (const l of await db.collection('cartes_produits').find({ slugSet: { $in: slugsL.slice(j, j + 200) } }, { projection: { _id: 0, idProduct: 1, slugSet: 1, numeroFiche: 1 } }).toArray()) (tousSets.get(l.slugSet) || tousSets.set(l.slugSet, []).get(l.slugSet)).push({ idProduct: l.idProduct, numero: l.numeroFiche ?? null, nomEn: etatDe.get(l.idProduct)?.name ?? null });
            const bilan = { total: liste.length, dejaOuverts: 0, ouvrables: 0, jumeaux: 0, refus: {}, parFamille: {}, exemples: [] };
            for (const x of liste) {
                const fam = bilan.parFamille[x.famille] || (bilan.parFamille[x.famille] = { n: 0, ouvrables: 0 }); fam.n++;
                const langue = x.famille === 'japonais' ? 'ja' : x.famille === 'chinois' ? 'zh-hans' : 'id';
                if (langue === 'ja' && x.nomJa) { bilan.dejaOuverts++; fam.ouvrables++; continue; }
                const c = x.carteId > 0 ? cartesL.get(x.carteId) : null;
                const nomRef = J.decomposerNomCardmarket(c?.nomEn ?? x.nom).nom;
                const dn = TPC.dexDuNom(nomRef);
                const p = { idProduct: x.idProduct, tirage: langue === 'ja' ? 'jp' : 'zh-hans', numero: x.numeroFiche, slug: x.slug, codeSet: x.code, nomEn: x.nom, nomEnCarte: c?.nomEn ?? null, ndex: c?.ndex ?? null, pv: c?.pv ?? null, categorie: c?.categorie ?? null,
                    tableJaInterne: langue === 'ja' ? temoin(J.decomposerNomCardmarket(c?.nomEn ?? x.nom).nom) : null, autresDuSet: tousSets.get(x.set) ?? [] };
                const t = p.tableJaInterne;
                const lu = { nom: t && !t.divergent && t.noms.length === 1 ? t.noms[0] : `名${reglesLues(c?.nomEn ?? x.nom)}`, numero: x.numeroFiche, langue: 'ja', codeSet: x.code, pv: Number(c?.pv) || 1, dex: Number.isInteger(c?.ndex) ? c.ndex : (dn && dn.length === 1 ? dn[0] : undefined) };
                const drapeaux = [];
                const m = x.numeroFiche == null ? 'nom-traduit-numero-absent' : PV.motifDeNomTraduit({ ...lu, langue }, p, x.numeroFiche, drapeaux);
                if (m) bilan.refus[m] = (bilan.refus[m] || 0) + 1;
                else { bilan.ouvrables++; fam.ouvrables++; if (drapeaux.includes('jumeau-dans-le-set')) bilan.jumeaux++; if (bilan.exemples.length < 12 && bilan.ouvrables % 20 === 1) bilan.exemples.push({ idProduct: x.idProduct, nom: x.nom, code: x.code, numero: x.numeroFiche, drapeaux }); }
            }
            sor.ouvrables = bilan;
            console.log(`OUVRABLES sur ${bilan.total} : déjà ouverts (nomJa) ${bilan.dejaOuverts} · ouverts de plus par la règle ${bilan.ouvrables} (dont ${bilan.jumeaux} jumeaux à vérifier) · refus ${JSON.stringify(bilan.refus)} · par famille ${JSON.stringify(bilan.parFamille)}`);
        }
    } finally { await cl.close(); await pl.close(); }
    fs.writeFileSync(sortie, JSON.stringify(sor, null, 1));
    const echecs = sor.croise_meme_set.reduce((n, c) => n + c.dexDifferent.acceptees + c.memeDexAutreRegle.acceptees, 0) + sor.croise_autres_sets.acceptees;
    console.log(echecs ? `ÉCHEC : ${echecs} paire(s) croisée(s) de Pokédex ou de règle différents acceptées` : 'OK : aucune paire croisée à Pokédex ou règle différents acceptée');
    process.exitCode = echecs ? 1 : 0;
})().catch(e => { console.error('ERREUR', e.stack); process.exit(2); });
