// ============================================================
// PHASE 3a, ÉTAPE 1 — LES PRODUITS SANS LIGNE : cause et route, par expansion (MESURE SEULE : 0 écriture, 0 requête externe)
// ============================================================
//   $env:NODE_PATH='C:\Users\Yung\Desktop\pokemon-proxy\node_modules'
//   node lancer-a-blanc.js mesurer-sans-ligne.js --cache=<dossier> --audit=<audit-produits.json> --sortie=<dossier>
//
// Les prédicats sont ceux de la PRODUCTION, importés — rien n'est recopié :
//   jointure.js      joindre, decomposerNomCardmarket, clesNom, nomJointDe, cleNumero, estCarteCode, impressionsDepuisSetlist, jetonsDeSetlist, numeroDeSetlist
//   cle-nom-attaques indexer, memeNom, designer, designerCroise, indexerMetacartes
//   wikitext.js      entreesDeLaSetlist (la Setlist relue sur l'ARCHIVE R2 : lecture d'objets, zéro requête Bulbapedia)
//   plan-sans-page   planSansPage          table-sets.js  TABLE_MAIN / TABLE_AUTO / TABLE_SANS_PAGE
// Les données sont des copies LOCALES de collections lues par les utilisateurs Atlas de LECTURE SEULE (phase3a-lecture.js) ; lancer-a-blanc.js
// ne laisse dans l'environnement que ces deux URI de lecture et la lecture de l'archive R2. Chaque instrument imprime son dénominateur ; un zéro sur
// une population non vide est vérifié (lecture-sure.js) avant d'être cru.
const fs = require('fs');
const path = require('path');
const J = require('./collecte-cartes/jointure');
const T = require('./collecte-cartes/table-sets');
const N = require('./collecte-cartes/cle-nom-attaques');
const { creerRejeu } = require('./collecte-cartes/rejeu-set');
const r2 = require('./collecte-cartes/r2');
const PJ = require('./collecte-cartes/preuves-jointure');
const MS = require('./collecte-cartes/matiere-speciale');
const { champSur, apparier } = require('./collecte-cartes/lecture-sure');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const CACHE = arg('cache'), AUDIT = arg('audit'), SORTIE = arg('sortie');
if (!CACHE || !AUDIT || !SORTIE) { console.error('usage : --cache=<dossier> --audit=<audit-produits.json> --sortie=<dossier>'); process.exit(2); }
const L = n => JSON.parse(fs.readFileSync(path.join(CACHE, `${n}.json`), 'utf8'));

(async () => {
    const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));
    const sl = audit.filter(p => p.classeFiche === 'SANS_LIGNE');
    const slIds = new Set(sl.map(p => p.idProduct));

    // ---------------- données ----------------
    const cat = L('catalogue_produits'), nc = L('numeros_cartes'), cartes = L('cartes'), cp = L('cartes_produits'), restes = L('restes'), sets = L('sets');
    const etatPages = new Map(L('collecte_etat_pages').map(e => [e._id, e]));
    const ncDe = new Map(nc.map(n => [n.idProduct, n]));
    const metaDe = new Map(cat.map(c => [c.idProduct, c.idMetacard ?? null]));
    const catDe = new Map(cat.map(c => [c.idProduct, c]));
    const setParId = new Map(sets.map(s => [s._id, s]));

    // DÉNOMINATEURS (imprimés) + vérification que les jeux sont non vides
    console.log(`DÉNOMINATEURS : audit ${audit.length} produits (dont ${sl.length} SANS_LIGNE) · catalogue ${cat.length} · numeros_cartes ${nc.length} · cartes ${cartes.length} · cartes_produits ${cp.length} · restes ${restes.length} · sets ${sets.length} · collecte_etat ${etatPages.size}`);
    champSur(cartes, 'nomEn', { collection: 'cartes' }); champSur(cartes, 'impressions', { collection: 'cartes' }); champSur(cartes, 'sets', { collection: 'cartes' });
    champSur(cp, 'carteId', { collection: 'cartes_produits' }); champSur([...etatPages.values()], 'pages', { collection: 'collecte_etat' });
    apparier(sl.map(p => p.idProduct), cat.map(c => c.idProduct), { gauche: 'SANS_LIGNE', droite: 'catalogue_produits', cle: 'idProduct', seuilBas: 1 });
    const lignesParProduit = new Map(); for (const l of cp) (lignesParProduit.get(l.idProduct) || lignesParProduit.set(l.idProduct, []).get(l.idProduct)).push(l);
    const slAvecLigne = sl.filter(p => lignesParProduit.has(p.idProduct)).length;
    const autresSansLigne = audit.filter(p => p.classeFiche !== 'SANS_LIGNE' && !lignesParProduit.has(p.idProduct)).length;
    console.log(`CONTRÔLE : SANS_LIGNE présents dans cartes_produits = ${slAvecLigne} (attendu 0) · non-SANS_LIGNE absents de cartes_produits = ${autresSansLigne} (attendu 0)`);
    if (slAvecLigne || autresSansLigne) throw new Error('la définition SANS_LIGNE ne colle pas à cartes_produits');

    // ---------------- index (production) ----------------
    const indexNom = N.indexer(cartes);
    const parSlug = new Map();
    for (const c of cartes) for (const s of c.sets || []) (parSlug.get(s) || parSlug.set(s, []).get(s)).push(c);
    const parMeta = N.indexerMetacartes(cp, id => metaDe.get(id) ?? null);
    const carteParId = new Map(cartes.map(c => [c._id, c]));
    const ctxCroise = { index: indexNom, parMeta, metacarteDe: id => metaDe.get(id) ?? null };
    // la clé « frères de métacarte dans le même set » (lot M2) : sa fonction de production, sur l'index des lignes existantes
    const K = require('./collecte-cartes/cle-freres-metacarte');
    const freresIdx = K.indexerFreres(cp, new Map(cat.map(c => [c.idProduct, { idMetacard: c.idMetacard ?? null, idExpansion: c.idExpansion ?? null }])));
    const setsPrep = new Map();
    const setPrep = slug => setsPrep.get(slug) || setsPrep.set(slug, K.preparerSet(parSlug.get(slug) || [], { slugSet: slug })).get(slug);

    const produitsDe = exp => cat.filter(p => p.idExpansion === exp && !J.estCarteCode(p.name)).map(p => {
        const d = J.decomposerNomCardmarket(p.name), n = ncDe.get(p.idProduct);
        return { idProduct: p.idProduct, idExpansion: p.idExpansion, idMetacard: p.idMetacard ?? null, name: p.name, nom: d.nom, attaques: d.attaques, numero: n?.numero ?? null, slug: n?.slug ?? null, slugSet: n?.slugSet ?? null, variante: n?.variante ?? null };
    });
    const lignesDe = exp => [...T.TABLE_MAIN.map(l => ({ l, t: 'MAIN' })), ...T.TABLE_AUTO.map(l => ({ l, t: 'AUTO' })), ...T.TABLE_SANS_PAGE.map(l => ({ l, t: 'SANS_PAGE' }))].filter(x => x.l.exp === exp);
    const clesEnergie = /^(basic\s+)?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy|dragon|colorless|rainbow)?\s*energy$/i;

    // ---------------- le rejeu de joindre() pour une ligne : UNE copie, collecte-cartes/rejeu-set.js (poser-lignes-rejeu.js la partage) ----------------
    let r2Pret = false;
    const rejeuDeLaLigne = creerRejeu({ cartes, setParId, etatPages, lireTexte: async cle => { if (!r2Pret) { await r2.verifierBucket(process.env.R2_BUCKET_BRUT); r2Pret = true; } return r2.lireTexte(process.env.R2_BUCKET_BRUT, cle); } });
    // ---------------- REJEU de joindre() à blanc, par ligne vérifiée ----------------
    async function rejeu(exp) {
        const res = { lignes: [], joints: new Map(), setlists: new Map() };
        for (const { l, t } of lignesDe(exp)) {
            if (!l.verifie) continue;
            const slug = l.slugSet || l.code;
            const TIRAGE = l.bulba?.tirage || 'jp';
            const produits = produitsDe(exp);
            const { Jr, sx } = await rejeuDeLaLigne.joindreLigne({ l, exp, produits });
            if (sx) res.setlists.set(l.code, sx);
            // le DIFF que réécrirait un rejeu (collecteur-texte.js --reparser) : ce que le filtre de régénération efface (preuves-jointure.js) contre ce que joindre() refait.
            // Les cartes du set = celles que la collecte relit (sets ∋ slug ; sans page : celles qui déclarent l'expansion).
            const idsCartes = new Set(l.bulba?.sansPage ? cartes.filter(c => (c.impressions || []).some(i => i.tirage === TIRAGE && [].concat(l.bulba.expansion).includes(i.expansion))).map(c => c._id) : (parSlug.get(slug) || []).map(c => c._id));
            const effacees = cp.filter(x => x.idExpansion === exp && idsCartes.has(x.carteId) && PJ.PREUVES_DE_JOINDRE.includes(x.preuve) && x.variante === undefined && x.variantePreuve === undefined);
            const refaites = new Set(Jr.lignes.map(x => `${x.carteId}|${x.idProduct}`));
            const dejaEcrites = new Set(cp.filter(x => x.idExpansion === exp).map(x => `${x.carteId}|${x.idProduct}`));
            const perdues = effacees.filter(x => !refaites.has(`${x.carteId}|${x.idProduct}`));
            const nouvelles = Jr.lignes.filter(x => !dejaEcrites.has(`${x.carteId}|${x.idProduct}`));
            res.lignes.push({ code: l.code, t, slug, tirage: TIRAGE, effacees: effacees.length, perdues: perdues.length, perduesEx: perdues.slice(0, 4).map(x => `${x.idProduct}→${x.carteId}(${x.preuve})`), nouvelles: nouvelles.length, nouvellesSL: nouvelles.filter(x => slIds.has(x.idProduct)).length, sansPage: !!l.bulba?.sansPage, numerosDepuisSetlist: !!l.bulba?.numerosDepuisSetlist, nCartes: Jr.compte.cartes, nProduits: Jr.compte.produits, nJoints: Jr.compte.produitsJoints, restes: Jr.restes.reduce((a, r) => (a[r.type] = (a[r.type] || 0) + 1, a), {}), setlist: sx && { maxNumero: sx.maxNumero, nNumeros: sx.nNumeros, revid: sx.revid, chemin: sx.chemin, lues: sx.lues, retenues: sx.retenues, sansNumero: sx.sansNumero, nPages: sx.nPages, nManquants: sx.nManquants, ignorees: sx.ignorees } });
            for (const x of Jr.lignes) (res.joints.get(x.idProduct) || res.joints.set(x.idProduct, []).get(x.idProduct)).push({ carteId: x.carteId, preuve: x.preuve, code: l.code });
        }
        return res;
    }

    // ---------------- la clé « Setlist » (KS) : le NUMÉRO du produit désigne UNE entrée de la Setlist du set, dont la page-carte (lue) porte le NOM du produit ----------------
    // Deux données indépendantes de la clé se recoupent : le numéro (Cardmarket ↔ Setlist de Bulbapedia) et le nom (Cardmarket ↔ carte). Elle est CALIBRÉE ci-dessous sur les produits déjà joints.
    function ksDe(sx, slug, p) {
        const n = ncDe.get(p.idProduct);
        if (!sx || n?.numero == null || String(n.numero).trim() === '') return { raison: 'sans numéro ou sans Setlist' };
        const es = sx.parNumero.get(J.cleNumero(n.numero)) || [];
        if (es.length !== 1) return { raison: `${es.length} entrée(s) de Setlist à ce numéro` };
        if (typeof es[0].page !== 'number') return { raison: `page ${es[0].page}` };
        const c = carteParId.get(es[0].page);
        if (!c || !c.nomEn) return { raison: 'carte absente de la base' };
        if (!(c.sets || []).includes(slug)) return { raison: 'la carte n\'est pas dans le set' };
        const d = J.decomposerNomCardmarket(catDe.get(p.idProduct)?.name ?? '');
        if (!N.memeNom(indexNom, { nom: d.nom, attaques: d.attaques }, null).some(x => x._id === c._id)) return { raison: 'le nom du produit n\'est pas celui de la carte' };
        return { carteId: c._id };
    }
    const calibKS = {};
    const noteKS = (cle, k) => { const m = calibKS[cle] || (calibKS[cle] = {}); m[k] = (m[k] || 0) + 1; };

    // ---------------- instruments par produit ----------------
    function diagnostic(p, rj, lignesExp) {
        const d = J.decomposerNomCardmarket(p.name), n = ncDe.get(p.idProduct);
        const prod = { idProduct: p.idProduct, nom: d.nom, attaques: d.attaques };
        const memeNom = N.memeNom(indexNom, prod, null);
        const slugs = lignesExp.filter(x => x.l.verifie).map(x => x.l.slugSet || x.l.code);
        const dansLeSet = memeNom.filter(c => (c.sets || []).some(s => slugs.includes(s)));
        const numero = n?.numero != null && String(n.numero).trim() !== '' ? J.cleNumero(n.numero) : null;
        const ligneV = lignesExp.find(x => x.l.verifie)?.l || lignesExp[0]?.l || null;
        const tirage = ligneV?.bulba?.tirage || ({ intl: 'intl', jp: 'jp' }[p.langue]) || p.langue;
        const croise = N.designerCroise(ctxCroise, prod, { tirage });
        // la désignation croisée SANS la clause « déjà imprimée dans le tirage » (`tirage` nul la désactive dans la production) : la clé du lot « réimpressions neuves »
        const croiseSansTirage = N.designerCroise(ctxCroise, prod, { tirage: null });
        const seul = N.designer(indexNom, prod, { forme: 'egales' });
        const incl = N.designer(indexNom, prod, { forme: 'incluses' });
        // la Setlist de la ligne : ce que sa liste dit de CE numéro
        let setlist = null;
        if (numero && ligneV) {
            const sx = rj.setlists.get(ligneV.code);
            if (sx) {
                const es = sx.parNumero.get(numero) || [];
                const kp = N.memeNom ? new Set(memeNom.map(c => c._id)) : new Set();
                const lues = es.filter(e => e.page !== 'manquant');
                setlist = {
                    maxNumero: sx.maxNumero, auDela: Number.isFinite(parseInt(String(numero).replace(/\D/g, ''), 10)) && sx.maxNumero != null && parseInt(String(numero).replace(/\D/g, ''), 10) > sx.maxNumero,
                    entrees: es.length, manquantes: es.filter(e => e.page === 'manquant').length, lues: lues.length, titres: es.slice(0, 3).map(e => `${e.titre}→${e.page}`),
                    // la carte de chaque entrée dont la page est lue : existe-t-elle chez nous, est-elle dans le set, porte-t-elle le NOM du produit ?
                    cartes: lues.slice(0, 3).map(e => { const c = typeof e.page === 'number' ? carteParId.get(e.page) : null; return { page: e.page, titre: e.titre, existe: !!c, nom: c?.nomEn ?? null, dansLeSet: !!c && (c.sets || []).includes(ligneV.slugSet || ligneV.code), nomConcorde: !!c && kp.has(c._id) }; })
                };
            }
        }
        // les frères de métacarte (autres produits de la même métacarte qui ont une ligne), toutes expansions
        const freres = [];
        for (const [idp, cs] of parMeta.get(metaDe.get(p.idProduct)) || []) if (idp !== p.idProduct) freres.push({ idProduct: idp, idExpansion: catDe.get(idp)?.idExpansion ?? null, cartes: [...cs] });
        const joints = rj.joints.get(p.idProduct) || null;
        let freresCle = null;
        if (ligneV && !ligneV.bulba?.sansPage) {
            const c0 = catDe.get(p.idProduct);
            const f = K.designerParFreres({ freres: freresIdx, set: setPrep(ligneV.slugSet || ligneV.code) }, { idProduct: p.idProduct, nom: d.nom, attaques: d.attaques, idMetacard: c0?.idMetacard ?? null, idExpansion: c0?.idExpansion ?? null }, {});
            freresCle = f.carte ? { carteId: f.carte._id, niveau: f.niveau } : { raison: f.raison, niveau: f.niveau };
        }
        return {
            idProduct: p.idProduct, name: p.name, nom: d.nom, attaques: d.attaques, numero: n?.numero ?? null, slug: n?.slug ?? null, variante: n?.variante ?? null, idMetacard: metaDe.get(p.idProduct) ?? null,
            energie: clesEnergie.test(d.nom.trim()),
            matiereSpeciale: MS.estMatiereSpeciale(p.idProduct) ? MS.motifMatiere(p.idProduct) : null,
            nouveau: p.idProduct >= 917000,
            rejeu: joints && joints.map(j => ({ ...j, nomConcorde: memeNom.some(c => c._id === j.carteId) })),
            nMemeNom: memeNom.length, memeNom: memeNom.slice(0, 6).map(c => c._id),
            nomDansLeSet: dansLeSet.map(c => c._id),
            setlist,
            croise: croise.carte ? { carteId: croise.carte._id } : { raison: croise.raison },
            croiseSansTirage: croiseSansTirage.carte ? { carteId: croiseSansTirage.carte._id, freres: freres.filter(f => f.cartes.includes(croiseSansTirage.carte._id)).length } : { raison: croiseSansTirage.raison },
            nFreresPage: freres.filter(f => f.cartes.some(c => c > 0)).length,
            freresCle,
            ncPresent: !!n,
            ks: (ligneV && !ligneV.bulba?.sansPage) ? ksDe(rj.setlists.get(ligneV.code), ligneV.slugSet || ligneV.code, p) : { raison: 'pas de Setlist' },
            nomAttaques: seul.carte ? { carteId: seul.carte._id } : { raison: seul.raison },
            nomAttaquesIncluses: incl.carte ? { carteId: incl.carte._id } : { raison: incl.raison },
            freres: freres.slice(0, 8), nFreres: freres.length,
            restes: []
        };
    }

    // ---------------- boucle ----------------
    const parExp = new Map();
    for (const p of sl) (parExp.get(p.idExpansion) || parExp.set(p.idExpansion, []).get(p.idExpansion)).push(p);
    const totalParExp = new Map(); for (const p of audit) totalParExp.set(p.idExpansion, (totalParExp.get(p.idExpansion) || 0) + 1);
    const restesParProduit = new Map(); for (const r of restes) if (slIds.has(r.idProduct)) (restesParProduit.get(r.idProduct) || restesParProduit.set(r.idProduct, []).get(r.idProduct)).push(r.type);
    const sortie = [];
    let k = 0;
    for (const [exp, ps] of [...parExp].sort((a, b) => b[1].length - a[1].length)) {
        const lignesExp = lignesDe(exp);
        const rj = await rejeu(exp);
        // CALIBRATION de KS : les produits de CETTE expansion déjà joints à UNE carte à page par le numéro (vérité), KS rejoué sur eux
        for (const { l } of lignesExp.filter(x => x.l.verifie && !x.l.bulba?.sansPage)) {
            const sx = rj.setlists.get(l.code); if (!sx) continue;
            const slug = l.slugSet || l.code;
            for (const p of cat.filter(c => c.idExpansion === exp && !slIds.has(c.idProduct) && !J.estCarteCode(c.name))) {
                const ls = lignesParProduit.get(p.idProduct) || [];
                const cs = new Set(ls.map(x => x.carteId));
                if (cs.size !== 1 || !['set+numero', 'setlist+numero'].includes(ls[0].preuve) || !(ls[0].carteId > 0) || ls[0].slugSet !== slug) continue;
                const r = ksDe(sx, slug, p);
                const cle = `${l.bulba?.tirage || 'jp'}`;
                noteKS(cle, 'verite');
                if (r.carteId == null) noteKS(cle, 'silences'); else noteKS(cle, r.carteId === ls[0].carteId ? 'justes' : 'FAUX');
            }
        }
        const diags = ps.map(p => ({ ...diagnostic({ idProduct: p.idProduct, name: catDe.get(p.idProduct)?.name ?? p.nom, langue: p.langue }, rj, lignesExp), tampon: p.tamponnee, restes: restesParProduit.get(p.idProduct) || [] }));
        sortie.push({ exp, total: totalParExp.get(exp), sansLigne: ps.length, famille: ps[0].famille, langue: ps[0].langue, type: ps[0].type, lignesTable: lignesExp.map(x => ({ t: x.t, code: x.l.code, verifie: !!x.l.verifie, collecte: x.l.collecte?.etat ?? null, verif: x.l.verif?.etat ?? null, raisons: x.l.verif?.raisons ?? null, slugSet: x.l.slugSet ?? null })), rejeuLignes: rj.lignes, produits: diags });
        if (++k % 40 === 0) console.log(`   … ${k}/${parExp.size} expansions`);
    }
    fs.mkdirSync(SORTIE, { recursive: true });
    fs.writeFileSync(path.join(SORTIE, 'calibration-ks.json'), JSON.stringify(calibKS, null, 1));
    for (const [cle, m] of Object.entries(calibKS)) console.log(`CALIBRATION KS (${cle}) : vérité ${m.verite} · désigne ${(m.justes || 0) + (m.FAUX || 0)} · justes ${m.justes || 0} · FAUX ${m.FAUX || 0} · silences ${m.silences || 0}`);
    fs.writeFileSync(path.join(SORTIE, 'diag-produits.json'), JSON.stringify(sortie));
    const tot = sortie.reduce((t, e) => t + e.sansLigne, 0);
    console.log(`ÉCRIT diag-produits.json : ${sortie.length} expansions, ${tot} produits (attendu ${sl.length})`);
    if (tot !== sl.length) throw new Error('concordance fausse');
})().catch(e => { console.error(e); process.exit(1); });
