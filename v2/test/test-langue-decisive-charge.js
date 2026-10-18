'use strict';
// Lot LANGUE-DECISIVE, tour de correction 2 (M-C) — `preparer` ne prépare que le SURVIVANT UNIQUE de la réduction, sous un PLAFOND de produits lus et un TEMPS borné ; sinon il ne prépare rien (refus fermé,
// la question reste réduite). Données FABRIQUÉES (aucun identifiant réel, aucune base, aucun réseau) : un faux catalogue qui compte ses lectures, une fausse colonne de jumeaux.
const { v, vrai, bilan } = require('./_harnais');
const LD = require('../identifier/langue-decisive');
const { preparer } = require('../identifier/langue-decisive-charge');

const muet = f => { const w = console.warn; console.warn = () => { }; return Promise.resolve(f()).finally(() => { console.warn = w; }); };
const ligne = (idProduct, code, numero, total, tirageSource, extra = {}) => ({ idProduct, nomCardmarket: 'Sombre [Grind | Spinning Tail | Bite Off]', nomFr: null, set: { slug: 'set-' + code, nom: 'Set ' + code, code }, numero, total, setTcgdex: null, langue: null, variante: null,
    rarete: 'Rare', prixGuide: null, visuel: null, tirageSource, ...extra });
const LU = { numero: '144', total: '103', setCode: 'BBBJ', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: 'JP', totalHorsTailleDeSet: false };
const corpsDe = (gagnant, vivier) => ({ success: true, carte: { idProduct: gagnant, ambigu: false, nom: 'Sombre', nomBrut: 'わるいバンギラス', nomConfiance: 'haute', numero: '144', total: '103', setCode: 'BBBJ', tcgdexId: null, langue: 'JP' },
    candidats: [{ idProduct: gagnant }], classement: [], codeLangue: 7, lectureGarde: { ...LU, vivierIds: vivier } });
const SANS = LD.SANS_NUMEROTATION[0].idExpansion;

// le monde : W (chinois, produit affirmé), S (japonais numéroté, le survivant), V (japonais d'un set sans numérotation, retiré par R5)
const W = ligne(9001, 'AAAC', '144', null, 'zh-hans'), S = ligne(9002, 'BBBJ', '144', '103', 'jp'), V = ligne(9003, 'CCCN', null, null, 'jp', { idExpansion: SANS });
const monde = () => new Map([W, S, V].map(l => [l.idProduct, l]));
const compteur = (jumeauxDe, { lireLeve = false, lireBloque = false } = {}) => {
    const rec = { lire: [], plus: 0 };
    const catalogue = {
        lire: async ids => { rec.lire.push([...ids]); if (lireLeve) throw new Error('panne'); if (lireBloque) return new Promise(() => { }); return new Map(ids.map(id => [id, ligne(id, 'JJJ' + id, String(id), '103', 'jp')])); },
        plusRecentDansMetacarte: async () => { rec.plus++; return false; },
        indexCodeNumero: async () => LD.creerIndexCodeNumero([{ codeSet: 'QQQ', numero: '1' }])
    };
    const version = { colonneJumeaux: true, jumeauxDe, empreinteJumeaux: () => ({ n: 10, max: 99999 }), metacarteJumeaux: () => 1 };
    return { rec, catalogue, version };
};
const j0 = () => ({ conclu: false, ids: [] });

(async () => {
    // (1) le survivant unique est préparé : sa colonne conclut, ses jumeaux sont lus, l'index est fourni
    {
        const { rec, catalogue, version } = compteur(id => (id === 9002 ? [9101, 9102] : []));
        const p0 = monde(), jum0 = j0;
        const r = await muet(() => preparer({ corpsListe: [corpsDe(9001, [9001, 9002, 9003])], produits: p0, jumeaux: jum0, catalogue, version }));
        v('(1) survivant unique : sa colonne de jumeaux conclut', r.jumeaux(9002), { conclu: true, ids: [9101, 9102] });
        v('(1)     ses jumeaux sont lus (une lecture, ces deux ids)', rec.lire, [[9101, 9102]]);
        vrai('(1)     la Map rendue porte les jumeaux, la Map d\'entrée n\'est pas modifiée', r.produits.has(9101) && r.produits.has(9102) && !p0.has(9101));
        vrai('(1)     l\'index du catalogue est fourni (fonction)', typeof r.codeNumeroExiste === 'function');
        vrai('(1)     au plus 2 sondes de métacarte (le produit affirmé et le survivant)', rec.plus <= 2);
    }
    // (2) pas de survivant unique (deux restent) : rien n'est préparé, rien n'est lu
    {
        const S2 = ligne(9004, 'BBBK', '144', '103', 'jp');
        const { rec, catalogue, version } = compteur(() => [9101]);
        const p0 = new Map([W, S, S2].map(l => [l.idProduct, l]));
        const r = await muet(() => preparer({ corpsListe: [corpsDe(9001, [9001, 9002, 9004])], produits: p0, jumeaux: j0, catalogue, version }));
        vrai('(2) deux restants : aucune lecture, aucune sonde, mêmes objets rendus', rec.lire.length === 0 && rec.plus === 0 && r.jumeaux === j0 && r.produits === p0);
    }
    // (3) un vivier de 300 : le module ne lit au plus que le plafond (ici : rien, car personne n'est seul)
    {
        const lignes = [ligne(9001, 'AAAC', '144', null, 'zh-hans')];
        for (let i = 0; i < 299; i++) lignes.push(ligne(9200 + i, 'BBBJ', '144', '103', 'jp'));
        const { rec, catalogue, version } = compteur(() => Array.from({ length: 60 }, (_, k) => 20000 + k));
        const p0 = new Map(lignes.map(l => [l.idProduct, l]));
        const debut = Date.now();
        const r = await muet(() => preparer({ corpsListe: [corpsDe(9001, lignes.map(l => l.idProduct))], produits: p0, jumeaux: j0, catalogue, version }));
        vrai('(3) vivier de 300 : aucun survivant unique, ZÉRO lecture, ZÉRO sonde (jamais 15 000 produits)', rec.lire.length === 0 && rec.plus === 0 && r.jumeaux === j0 && r.produits === p0);
        vrai('(3)     le temps est borné (bien moins d\'une seconde)', Date.now() - debut < 1000);
    }
    // (4) le PLAFOND de produits lus : un survivant dont les jumeaux dépassent le plafond ne prépare rien
    {
        vrai('(4) le plafond nommé existe (entier positif, plusieurs dizaines)', Number.isInteger(LD.PLAFOND_CHARGE) && LD.PLAFOND_CHARGE >= 50);
        const trop = Array.from({ length: LD.PLAFOND_CHARGE + 1 }, (_, k) => 30000 + k);
        const a = compteur(id => (id === 9002 ? trop : []));
        const ra = await muet(() => preparer({ corpsListe: [corpsDe(9001, [9001, 9002, 9003])], produits: monde(), jumeaux: j0, catalogue: a.catalogue, version: a.version }));
        vrai('(4) jumeaux au-dessus du plafond : aucune lecture, état d\'avant (refus fermé)', a.rec.lire.length === 0 && ra.jumeaux === j0);
        const ok = Array.from({ length: LD.PLAFOND_CHARGE }, (_, k) => 40000 + k);
        const b = compteur(id => (id === 9002 ? ok : []));
        const rb = await muet(() => preparer({ corpsListe: [corpsDe(9001, [9001, 9002, 9003])], produits: monde(), jumeaux: j0, catalogue: b.catalogue, version: b.version }));
        vrai('(4) jumeaux au plafond : lus, et pas un de plus', b.rec.lire.length === 1 && b.rec.lire[0].length === LD.PLAFOND_CHARGE && rb.produits.size === 3 + LD.PLAFOND_CHARGE);
    }
    // (5) une lecture qui lève : l'état d'avant, jamais une exception
    {
        const { catalogue, version } = compteur(() => [9101], { lireLeve: true });
        const p0 = monde();
        let r = null, e = null;
        try { r = await muet(() => preparer({ corpsListe: [corpsDe(9001, [9001, 9002, 9003])], produits: p0, jumeaux: j0, catalogue, version })); } catch (x) { e = x; }
        vrai('(5) lecture en panne : pas d\'exception, mêmes jumeaux et mêmes produits', e === null && r.jumeaux === j0 && r.produits === p0);
    }
    // (6) un fournisseur de jumeaux INJECTÉ (banc) fait foi : rien n'est préparé, l'index reste fourni
    {
        const { rec, catalogue, version } = compteur(() => [9101]);
        const p0 = monde();
        const r = await muet(() => preparer({ corpsListe: [corpsDe(9001, [9001, 9002, 9003])], produits: p0, jumeaux: j0, catalogue, version, deps: { jumeaux: () => ({ conclu: true, ids: [] }) } }));
        vrai('(6) deps.jumeaux injecté : aucune lecture ni sonde, mêmes objets', rec.lire.length === 0 && rec.plus === 0 && r.jumeaux === j0 && r.produits === p0 && typeof r.codeNumeroExiste === 'function');
    }
    // (7) un TEMPS borné : une lecture qui ne répond jamais rend l'état d'avant dans le délai
    {
        const { catalogue, version } = compteur(() => [9101], { lireBloque: true });
        const p0 = monde();
        const debut = Date.now();
        const r = await muet(() => preparer({ corpsListe: [corpsDe(9001, [9001, 9002, 9003])], produits: p0, jumeaux: j0, catalogue, version, delaiMaxMs: 80 }));
        const duree = Date.now() - debut;
        vrai('(7) lecture qui ne répond jamais : état d\'avant, rendu dans le délai demandé', r.jumeaux === j0 && r.produits === p0 && duree < 1000);
        vrai('(7)     le délai par défaut est nommé et borné (entier, au plus 5 s)', Number.isInteger(LD.DELAI_PREPARATION_MS) && LD.DELAI_PREPARATION_MS > 0 && LD.DELAI_PREPARATION_MS <= 5000);
    }
    // (8) l'index du catalogue en panne ou sous le plancher : pas de fonction => R4 fermée ; le reste fonctionne
    {
        const { catalogue, version } = compteur(() => []);
        catalogue.indexCodeNumero = async () => { throw new Error('index sous le plancher'); };
        const r = await muet(() => preparer({ corpsListe: [corpsDe(9001, [9001, 9002, 9003])], produits: monde(), jumeaux: j0, catalogue, version }));
        vrai('(8) index en panne : codeNumeroExiste absent (R4 fermée), pas d\'exception', r.codeNumeroExiste === undefined);
    }
    // (9) le CÂBLAGE : la route ET le lot appellent `preparer` avec la version d'origine (m-1) et passent l'index à l'adaptateur (le banc fonctionnel est test-langue-decisive-cablage.js)
    {
        const fs = require('fs'), path = require('path');
        const src = f => fs.readFileSync(path.join(__dirname, '..', 'identifier', f), 'utf8');
        for (const f of ['routes.js', 'lot.js']) {
            const s = src(f);
            vrai(`(9) ${f} : importe preparer, l'appelle, passe l'index (...ctxLD) à l'adaptateur`, /require\('\.\/langue-decisive-charge'\)/.test(s) && /preparerLD\(/.test(s) && /\.\.\.ctxLD/.test(s));
            vrai(`(9) ${f} : UNE seule lecture de la version (m-1), passée au premier appel ET à preparer`, (s.match(/etatChargeur\.version\(\)/g) || []).length === 1 && /version: version0/.test(s) && /fournisseurParDefaut\(catalogue, version0/.test(s));
        }
    }
    bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
