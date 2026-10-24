'use strict';
// LOT TAMPONS — la forme « paire séparée par la variante » étendue au MÊME jeu de jetons que le catalogue écrit (staff, prerelease, league, championship, enseignes, professor, cosmo, snowflake,
// play-pokemon, place-1 à place-4, leurs ensembles joints par « + », jumbo, normale). Rien ne change pour staff et jumbo (test-partages-variante.js, inchangé). Pur : données fabriquées.
const H = require('./_harnais');
const { decider, partageIncoherent, varianteAvecPreuve } = require('../chargeur/decision');
const { regleEmbarquee } = require('../chargeur/regle-site');
const { creerConstructeur, rejugerEntrees } = require('../chargeur/version');
const F = require('../chargeur/format');
const { lireEntree } = require('../identifier/visuels');
const PV = require('../identifier/partage-variante');

const brut = (id, o = {}) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: { cle: `cartes/${id}.webp`, w: 600, h: 838 }, visuel: 'du-set', mention: null,
    idMetacard: null, numero: '1', rarete: null, total: null, variante: null, setNom: 'S', lien: null, ...o });
const motif = o => { const r = lireEntree(brut(11, o)); return r.ok ? 'ADMIS' : r.motif; };
const FORME = { partageeTamponNonSepare: false, tamponNonRepresente: 'Tampon' };
const REFUS = 'marquage de partage sans "produitsPartages"';

(async () => {
    // ── 1. LA VALIDATION D'ENTRÉE
    const TOUS = ['staff', 'prerelease', 'league', 'championship', 'toys-r-us', 'gamestop', 'kfc', 'indomilk', 'professor', 'cosmo', 'snowflake', 'play-pokemon', 'place-1', 'place-2', 'place-3', 'place-4', 'staff+prerelease', 'staff+championship', 'league+place-2', 'jumbo', 'normale'];
    H.v('1a. chaque jeton de la liste fermée (et chaque ensemble canonique) : false, aucune liste → admis', TOUS.filter(v => motif({ ...FORME, variante: v }) !== 'ADMIS'), []);
    const HORS = ['inconnu', 'Staff', 'prerelease+staff', 'staff+staff', 'staff + prerelease', 'staff+inconnue', 'staff-prerelease', 'jumbo+staff', 'place-5', 'v1', ''];
    H.v('1b. un jeton hors liste, mal ordonné, doublonné, avec un espace : false sans liste REFUSÉ (jamais devinée)', HORS.filter(v => motif({ ...FORME, variante: v }) !== REFUS), []);
    H.v('1c. true sans liste reste refusé, même avec un jeton de la liste', [motif({ partageeTamponNonSepare: true, variante: 'league' }), motif({ partageeTamponNonSepare: true, variante: 'staff+prerelease' })], [REFUS, REFUS]);
    H.v('1d. un ensemble porte son jeton tel quel dans l\'entrée', lireEntree(brut(11, { ...FORME, variante: 'league+place-2' })).doc.variante, 'league+place-2');

    // ── 2. partageIncoherent
    H.v('2a. la forme admise est cohérente pour tout jeton de la liste', TOUS.filter(v => partageIncoherent({ partageeTamponNonSepare: false }, 1, v) !== false), []);
    H.v('2b. un jeton hors liste (ou absent) : incohérent', HORS.concat([null]).filter(v => partageIncoherent({ partageeTamponNonSepare: false }, 1, v) !== true), []);

    // ── 3. varianteAvecPreuve : la liste fermée, la forme ancienne, le compte des valeurs hors liste
    const d0 = () => ({ varianteSansPreuve: 0, varianteHorsListe: 0 });
    const vp = (variante, preuve = 'P') => { const d = d0(); return [varianteAvecPreuve({ variante, variantePreuve: preuve }, d), d.varianteSansPreuve, d.varianteHorsListe]; };
    H.v('3a. un jeton de la liste AVEC preuve : porté, rien de compté', [vp('league'), vp('staff+prerelease'), vp('normale'), vp('jumbo'), vp('place-2')], [['league', 0, 0], ['staff+prerelease', 0, 0], ['normale', 0, 0], ['jumbo', 0, 0], ['place-2', 0, 0]]);
    H.v('3b. la forme ancienne staff-prerelease se lit staff+prerelease (preuve exigée comme pour les autres)', [vp('staff-prerelease'), vp('staff-prerelease', null)], [['staff+prerelease', 0, 0], [null, 1, 0]]);
    H.v('3c. un jeton de la liste SANS preuve : null, compté (varianteSansPreuve)', [vp('league', null), vp('league', '  ')], [[null, 1, 0], [null, 1, 0]]);
    H.v('3d. une valeur hors liste (ou un jeton inconnu dans un ensemble) : null ET comptée (varianteHorsListe), avec ou sans preuve', [vp('inconnu'), vp('staff+inconnue'), vp('prerelease+staff'), vp('inconnu', null), vp('Staff')], [[null, 0, 1], [null, 0, 1], [null, 0, 1], [null, 0, 1], [null, 0, 1]]);
    H.v('3e. pas de variante du tout (null, absente) : null, rien de compté', [vp(null), vp(undefined)], [[null, 0, 0], [null, 0, 0]]);

    // ── 4. LA DÉCISION de bout en bout
    const regle = await regleEmbarquee();
    const set = (id, exp) => ({ _id: id, idExpansion: exp, code: id.slice(0, 4), nomAffichage: id.replace(/-/g, ' '), tirage: 'intl', region: 'intl', bulba: { expansion: id.replace(/-/g, ' ') } });
    const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
    const im = (numero, n, o = {}) => ({ set: 'Set-A', numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: vig(n), langue: 'en', source: 'tcgdex', ...o });
    const carte = (id, numero, images) => ({ _id: id, nomEn: `Carte ${id}`, categorie: 'pokemon', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare' }], images });
    const ligne = (id, carteId, numero, o = {}) => ({ idProduct: id, carteId, idExpansion: 100, numeroFiche: numero, slug: `P${id}-X${numero}`, slugSet: 'Set-A', ...o });
    const P = 'étiquette Cardmarket';
    const sets = [set('Set-A', 100)];
    const docs = [40, 41, 42, 43].map((c, i) => carte(c, `0${20 + i}`, [im(`0${20 + i}`, `c${c}`, { partageeTamponNonSepare: false, tamponNonRepresente: 'Tampon' })]));
    const lignes = [
        ligne(4001, 40, '020', { variante: 'normale', variantePreuve: P }), ligne(4002, 40, '020', { variante: 'league+place-2', variantePreuve: P }),
        ligne(4101, 41, '021', { variante: 'normale', variantePreuve: P }), ligne(4102, 41, '021', { variante: 'staff-prerelease', variantePreuve: P }),
        ligne(4201, 42, '022', { variante: 'normale', variantePreuve: P }), ligne(4202, 42, '022', { variante: 'inconnu', variantePreuve: P }),
        ligne(4301, 43, '023', { variante: 'normale', variantePreuve: P }), ligne(4302, 43, '023', { variante: 'kfc' })
    ];
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const r = await decider({ sets, docs, lignes, metacarte, regle });
    const e = id => r.entrees.find(x => x.idProduct === id), dn = r.denominateurs;
    H.v('4a. servis : la paire league+place-2, la paire staff+prerelease (forme ancienne lue canonique) ; le produit à valeur hors liste (4202) et celui sans preuve (4302) sont écartés, leurs normales (4201, 4301) restent servies', r.entrees.map(x => x.idProduct), [4001, 4002, 4101, 4102, 4201, 4301]);
    H.v('4b. l\'entrée porte le jeton CANONIQUE (jamais la forme ancienne)', [e(4002).variante, e(4102).variante], ['league+place-2', 'staff+prerelease']);
    H.v('4c. comptes : 1 valeur hors liste (4202, écartée pour partage incohérent ET comptée), 0 variante sans preuve comptée (4302 est écarté avant l\'étape qui la compte, comme avant), 2 partages incohérents', [dn.varianteHorsListe, dn.varianteSansPreuve, dn.partageIncoherent], [1, 0, 2]);
    const lues = r.entrees.map(x => lireEntree(JSON.parse(JSON.stringify(x)))), refus = lues.filter(x => !x.ok).map(x => x.motif);
    H.v('4d. toutes les entrées émises passent la validation d\'entrée', refus, []);

    // ── 5. pairePar : une marque (ou un ensemble) d'un côté, la normale de l'autre ; jamais deux marques
    const ent = (id, variante, o = {}) => ({ idProduct: id, partageeTamponNonSepare: false, partageeHoloNonHolo: null, produitsPartages: null, tamponNonRepresente: 'Tampon', variante, vignette: { cle: 'v/x.webp', w: 200, h: 279 }, grande: { cle: 'g/x.webp', w: 600, h: 838 }, ...o });
    const tous = () => true;
    const pp = (ea, eb) => { const x = PV.pairePar(ea, eb, tous); return x.ok ? [x.special, x.normale, x.variante] : x.motif; };
    const MV = 'les variantes ne sont pas une paire staff|jumbo/normale';
    H.v('5a. n\'importe quelle marque / ensemble avec la normale est une paire (le spécial est nommé)', TOUS.filter(v => v !== 'normale' && v !== 'jumbo').filter(v => JSON.stringify(pp(ent(1, v), ent(2, 'normale'))) !== JSON.stringify([1, 2, v])), []);
    H.v('5b. deux marques (league + staff, ensemble + marque), deux normales, marque + jumbo : jamais une paire', [pp(ent(1, 'league'), ent(2, 'staff')), pp(ent(1, 'staff+prerelease'), ent(2, 'staff')), pp(ent(1, 'normale'), ent(2, 'normale')), pp(ent(1, 'kfc'), ent(2, 'jumbo'))], [MV, MV, MV, MV]);
    H.v('5c. une variante hors liste d\'un côté : refusée avant tout', [pp(ent(1, 'inconnu'), ent(2, 'normale')), pp(ent(1, 'prerelease+staff'), ent(2, 'normale'))], ['la paire n\'est pas séparée par la variante (marquage, liste ou variante)', 'la paire n\'est pas séparée par la variante (marquage, liste ou variante)']);
    H.v('5d. estVariantePaire : staff, jumbo et normale restent des variantes de paire (comme avant), un ensemble canonique aussi, le hors-liste non', [PV.estVariantePaire('staff'), PV.estVariantePaire('jumbo'), PV.estVariantePaire('normale'), PV.estVariantePaire('staff+prerelease'), PV.estVariantePaire('prerelease+staff'), PV.estVariantePaire(null)], [true, true, true, true, false, false]);

    // ── 6. la version et le fichier
    const SAME = { vignette: { cle: 'vignettes/m-1.webp', w: 200, h: 279 }, grande: { cle: 'cartes/m-1.webp', w: 600, h: 838 } };
    const separee = (id, variante, o = {}) => brut(id, { ...SAME, partageeTamponNonSepare: false, tamponNonRepresente: 'Tampon', variante, idMetacard: 700, ...o });
    const b = creerConstructeur({ marquages: true });
    b.entree(separee(5001, 'normale')); b.entree(separee(5002, 'league+place-2'));
    b.entree(separee(5011, 'normale', { vignette: { cle: 'vignettes/m-2.webp', w: 200, h: 279 }, grande: { cle: 'cartes/m-2.webp', w: 600, h: 838 }, idMetacard: 701 })); b.entree(separee(5012, 'toys-r-us', { vignette: { cle: 'vignettes/m-2.webp', w: 200, h: 279 }, grande: { cle: 'cartes/m-2.webp', w: 600, h: 838 }, idMetacard: 701 }));
    b.lien('Set-A', '1|001', [5001, 5002]); b.lien('Set-A', '1|002', [5011, 5012]);
    const v = b.finir(new Date('2026-10-18T10:00:00.000Z'));
    H.v('6a. la version accepte la forme, rejuge ses entrées, et connaît les paires (partenaires, même fiche) pour les marques', [v.comptes.refusees, rejugerEntrees(v).ok, v.partagesDe(5001), v.partagesDe(5002), v.partagesDe(5012), v.memeFiche(5001, 5002)], [0, true, [5002], [5001], [5011], true]);
    const w = F.deserialiser(F.serialiser(v));
    H.v('6b. aller-retour du fichier : mêmes entrées, mêmes partenaires', [[5001, 5002, 5011, 5012].every(id => JSON.stringify(w.entree(id)) === JSON.stringify(v.entree(id))), w.partagesDe(5002), w.entree(5002).variante], [true, [5001], 'league+place-2']);
    H.bilan();
})().catch(x => { console.error('❌', x); process.exitCode = 1; });
