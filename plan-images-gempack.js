// PLAN DES IMAGES GEM PACK (LECTURE SEULE : aucun réseau, rien en base, rien en R2, rien de déplacé) — la décision de l'éditeur du 2026-10-31, appliquée et mesurée.
//   node plan-images-gempack.js [--sortie=<dossier>]      (lanceur avec le .env de main ; NODE_PATH = node_modules du dépôt principal)
// Pour chaque Gem Pack (Vol. 4, 5, 6) : (1) l'IDENTITÉ des images — chaque image de PokéCottage (position p) est rapprochée des 196 images de Simplified Collector par l'empreinte d'illustration : la source
// indépendante désigne-t-elle le même groupe ? ; (2) la PREUVE DE L'ILLUSTRATION DE BASE — rang 1 contre rangs 2-6 (même dessin) et contre rang 7 (autre dessin) ne sont séparés que s'il existe un VIDE
// (meme-illustration.separer) ; (3) les FICHES qui recevraient l'image (fiches existantes + rattachements du plan) et les PRODUITS de chaque fiche ; (4) les PLANCHES à regarder.
// UN PRODUIT EST « UNIQUE » SEULEMENT SI SON GROUPE N'A QU'UN PRODUIT : ici chaque groupe en a 7, de même nom et de même métacarte — aucune image ne s'attache donc à UN produit (visuels uniques : 0).
const fs = require('fs'), path = require('path');
const sharp = require('sharp');
const MI = require('./collecte-cartes/meme-illustration');
const FPS = require('./collecte-cartes/fiches-preuve-set');
const LG = require('./collecte-cartes/listes-gempack');
const V5 = require('./poser-fiches-voie-deux-sources');

const RACINE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8';
const EXPL = RACINE + '/EXPLORATION';
const SORTIE = ((process.argv.find(a => a.startsWith('--sortie=')) || '').slice(9)) || RACINE + '/GEMPACK-ECRITURE';
const VOLS = [{ code: 'CBB4C', vol: 4, slug: 'Gem-Pack-Vol-4', exp: 6447 }, { code: 'CBB5C', vol: 5, slug: 'Gem-Pack-Vol5', exp: 6544 }, { code: 'CBB6C', vol: 6, slug: 'Gem-Pack-Vol-6', exp: 6669 }];
const lireJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

(async () => {
    fs.mkdirSync(SORTIE, { recursive: true });
    const resume = lireJson(SORTIE + '/resume-rattachement.json');
    const base = FPS.chargerSources(RACINE + '/AUDIT-31/FICHES-SET');
    const cx = await V5.ouvrirLecture();
    const sortie = { le: new Date().toISOString(), sets: [] };
    try {
        const lecture = await V5.lire({ cartesDb: cx.cartes.db, prodDb: cx.prod.db, expansions: VOLS.map(v => v.exp) });
        for (const v of VOLS) {
            const dPc = `${EXPL}/pc-GemPack-vol${v.vol}`, dSc = `${EXPL}/sc-GemPack-vol${v.vol}`;
            const pcFichiers = fs.readdirSync(dPc).filter(x => /^\d{3}_.*\.webp$/.test(x)).sort();
            const scFichiers = new Map(fs.readdirSync(dSc).filter(x => /^\d{4}_.*\.(png|webp)$/.test(x)).map(x => [x.slice(0, 4), x]));
            const cr = lireJson(`${RACINE}/GEMPACK-SOURCES/simulation/croisement-${v.code}.json`);
            const nomDuGroupe = new Map(cr.cartes.map(c => [Number(c.groupe), c.nom]));
            if (pcFichiers.length !== 196 || scFichiers.size !== 196) throw new Error(`${v.code} : ${pcFichiers.length} PC, ${scFichiers.size} SC — attendu 196/196`);
            // (1) les empreintes
            const empPc = [], empSc = [];
            for (let i = 0; i < 196; i++) {
                empPc.push(await MI.empreinteIllustration(fs.readFileSync(path.join(dPc, pcFichiers[i]))));
                const g = Math.floor(i / 7) + 1, r = (i % 7) + 1, cle = String(g).padStart(2, '0') + String(r).padStart(2, '0');
                empSc.push(await MI.empreinteIllustration(fs.readFileSync(path.join(dSc, scFichiers.get(cle)))));
            }
            let groupeRetrouve = 0; const ecarts = [];
            for (let i = 0; i < 196; i++) {
                let meilleur = -1, mi = -1; for (let j = 0; j < 196; j++) { const c = MI.correlation(empPc[i], empSc[j]); if (c > meilleur) { meilleur = c; mi = j; } }
                if (Math.floor(mi / 7) === Math.floor(i / 7)) groupeRetrouve++; else ecarts.push({ position: i + 1, retrouve: mi + 1 });
            }
            // (2) l'illustration de base
            const memes = [], autres = [], parGroupe = [];
            for (let g = 0; g < 28; g++) {
                const m = [], a = MI.correlation(empPc[g * 7], empPc[g * 7 + 6]);
                for (let r = 1; r < 6; r++) m.push(MI.correlation(empPc[g * 7], empPc[g * 7 + r]));
                memes.push(...m); autres.push(a); parGroupe.push({ groupe: g + 1, minMemes: Math.min(...m), corrRang7: a });
            }
            const sep = MI.separer(memes, autres);
            // (3) les fiches
            const lignes = lecture.lignes.filter(l => l.slugSet === v.slug), produits = lecture.produits.get(v.exp) || [];
            const nouvelles = new Map(resume.lignes.filter(l => l.idExpansion === v.exp).map(l => [l.idProduct, l]));
            const fichesParGroupe = new Map();
            for (const p of produits) {
                const g = Number(String(p.numero).replace(/^0+/, '')), l = lignes.find(x => x.idProduct === p.idProduct) || nouvelles.get(p.idProduct);
                if (!l) continue;
                const e = fichesParGroupe.get(g) || fichesParGroupe.set(g, { carteIds: new Set(), produits: 0, existantes: 0, rattachees: 0 }).get(g);
                e.carteIds.add(l.carteId); e.produits++; if (nouvelles.has(p.idProduct)) e.rattachees++; else e.existantes++;
            }
            const emprunts = [];
            for (let g = 1; g <= 28; g++) {
                const f = fichesParGroupe.get(g), tous = produits.filter(p => Number(String(p.numero).replace(/^0+/, '')) === g).length;
                const i = (g - 1) * 7, prov = lireJson(path.join(dPc, pcFichiers[i] + '.provenance.json')), pg = parGroupe[g - 1];
                const base1 = sep.separe && pg.minMemes >= sep.seuil && pg.corrRang7 < sep.seuil;
                emprunts.push({ groupe: g, nom: nomDuGroupe.get(g), fiche: f ? { carteId: [...f.carteIds][0], cartesDistinctes: f.carteIds.size, produitsAvecFiche: f.produits, produitsDuGroupe: tous, existantes: f.existantes, rattachees: f.rattachees } : null,
                    image: { fichier: path.join(dPc, pcFichiers[i]), url: prov.urlImage, largeur: prov.largeur, hauteur: prov.hauteur, sha256: require('crypto').createHash('sha256').update(fs.readFileSync(path.join(dPc, pcFichiers[i]))).digest('hex') },
                    preuveBase: { minCorrelationRangs2a6: +pg.minMemes.toFixed(3), correlationRang7: +pg.corrRang7.toFixed(3), baseProuvee: base1 } });
            }
            const posables = emprunts.filter(e => e.fiche && e.fiche.cartesDistinctes === 1 && e.fiche.produitsAvecFiche === e.fiche.produitsDuGroupe && e.preuveBase.baseProuvee);
            const r = { code: v.code, slug: v.slug, groupes: 28, identite: { positionsRetrouveesParLaSourceIndependante: groupeRetrouve, sur: 196, ecarts: ecarts.slice(0, 10) }, separation: sep,
                fichesDeGroupe: emprunts.filter(e => e.fiche).length, groupesSansFiche: emprunts.filter(e => !e.fiche).map(e => `${e.groupe} ${e.nom}`),
                empruntsPrets: posables.length, empruntsProduits: posables.reduce((s, e) => s + e.fiche.produitsDuGroupe, 0), visuelsUniques: 0,
                resolutionPc: [...new Set(emprunts.map(e => `${e.image.largeur}x${e.image.hauteur}`))], emprunts };
            sortie.sets.push(r);
            console.log(`${v.code} : identité ${groupeRetrouve}/196 · séparation ${JSON.stringify({ separe: sep.separe, seuil: +sep.seuil?.toFixed(3), minMemes: +sep.minMemes.toFixed(3), maxAutres: +sep.maxAutres.toFixed(3) })} · groupes avec fiche ${r.fichesDeGroupe}/28 · emprunts prêts ${r.empruntsPrets} fiches (${r.empruntsProduits} produits) · uniques 0 · résolutions ${r.resolutionPc.join(' ')}${r.groupesSansFiche.length ? ' · sans fiche : ' + r.groupesSansFiche.join(', ') : ''}`);
            // (4) la planche : les images de base (rang 1) des 28 groupes, légendées « groupe nom · ✓/✗ fiche »
            const W = 200, H = 280, cols = 7, tuiles = [];
            for (let g = 0; g < 28; g++) {
                const e = emprunts[g];
                const buf = await sharp(e.image.fichier).resize(W, H, { fit: 'contain', background: '#222' }).png().toBuffer();
                const etiquette = `${String(e.groupe).padStart(2, '0')} ${e.nom} ${e.fiche ? `(fiche ${e.fiche.produitsAvecFiche}/${e.fiche.produitsDuGroupe})` : '(SANS FICHE)'}`.replace(/&/g, '&amp;').replace(/</g, '&lt;');
                const svg = Buffer.from(`<svg width="${W}" height="22"><rect width="${W}" height="22" fill="${e.fiche ? '#103010' : '#601010'}"/><text x="4" y="15" font-size="12" font-family="Arial" fill="#fff">${etiquette}</text></svg>`);
                tuiles.push({ input: await sharp({ create: { width: W, height: H + 22, channels: 3, background: '#000' } }).composite([{ input: buf, left: 0, top: 0 }, { input: svg, left: 0, top: H }]).png().toBuffer(), left: (g % cols) * (W + 4), top: Math.floor(g / cols) * (H + 26) });
            }
            const planche = `${SORTIE}/planche-${v.code}-base-rang1.png`;
            await sharp({ create: { width: cols * (W + 4), height: 4 * (H + 26), channels: 3, background: '#000' } }).composite(tuiles).png().toFile(planche);
            r.planche = planche;
        }
    } finally { await cx.fermer(); }
    fs.writeFileSync(SORTIE + '/plan-images-gempack.json', JSON.stringify(sortie, null, 1));
    console.log('écrit :', SORTIE + '/plan-images-gempack.json');
})().catch(e => { console.error('❌', e.stack || e.message); process.exitCode = 1; });
