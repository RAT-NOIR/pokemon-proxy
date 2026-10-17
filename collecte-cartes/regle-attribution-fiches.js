// ============================================================
// ATTRIBUER UN PRODUIT À UNE FICHE PAR SET + NUMÉRO + NOM (lot FICHES, 2026-10-17) — la règle, PURE
// ============================================================
// Décision du testeur (2026-10-17) : « les cas sûrs (set, numéro et nom concordants) sont écrits, puis revérifiés ; les autres vont dans une
// liste, sans écriture ». UNE RÈGLE ÉCRITE PAR CE QU'ELLE AUTORISE : un produit n'est attribué à UNE carte que si les quatre conditions tiennent,
// et tout le reste est un doute NOMMÉ (un doute est un trou, jamais une fiche) :
//   (a) le SET est celui du produit : idExpansion du catalogue dans celles du set, slugSet appris (s'il y en a un) = le set ;
//   (b) le NUMÉRO du produit (numeros_cartes.numero, à défaut le segment du slug lu par la fonction du SITE, injectée) est, par `cleNumero` de la
//       production, un numéro d'impression de la carte DANS CE SET (numerosDuSet : tirage, noms d'expansion, deck — la définition du site) ;
//   (c) le NOM concorde : le témoin du nom de la PRODUCTION (`temoinDuNom` de joindre(), jamais une copie) ne contredit pas, ET le nom désigne la
//       carte (clés de la production, alias compris) — ou, comme dans joindre(), les attaques l'emportent sur un nom qui désigne une autre carte ;
//   (d) UNE seule carte du set satisfait (a)-(c), et aucun AUTRE produit ne revendique la même (carte, numéro) — sauf la version V1/V2… d'une fiche
//       DÉJÀ reconnue (même base de slug, ligne existante sur la même carte).
// Deux actions seulement, toutes deux ADDITIVES : « ligne-neuve » (le produit n'a aucune ligne) et « numeroFiche » (sa SEULE ligne est sur la bonne
// carte et son numeroFiche est nul). Un produit qui a déjà un numeroFiche, deux lignes, ou une ligne sur une autre carte n'est jamais touché.
// ⚠️ « 0 ambigu » ne veut pas dire « 0 faux » : la règle se CALIBRE (calibrer) en cachant des lignes déjà justes et en les rejouant.
const { cleNumero, clesNom, nomJointDe, decomposerNomCardmarket, temoinDuNom, estCarteCode } = require('./jointure');
const { aliasDe } = require('./alias-noms');
const { numerosDuSet } = require('./numero-fiche');

const MOTIFS = ['carte-code', 'set-inconnu', 'set-additionals', 'plusieurs-lignes', 'numero-fiche-deja-pose', 'produit-sans-numero', 'set-sans-impression', 'variante-suffixee',
    'numero-absent', 'nom-contredit', 'attaques-contredites', 'nom-non-confirme', 'numero-ambigu', 'deux-candidates', 'deux-produits-revendiquent', 'ligne-sur-une-autre-carte'];
const PREUVE = 'set+numero+nom';

// La position d'une pièce V-UNION (« SWSH215 (Top Left) ») n'est pas le numéro : même retrait que joindre().
const sansPosition = n => String(n).trim().toUpperCase().replace(/\s*\([^)]*\)\s*$/, '');
// « Pikachu-V2-LS5 » et « Pikachu-V1-LS5 » sont deux versions d'UNE fiche : la base du slug retire le « -Vn » (au milieu ou à la fin).
// Les zéros de tête d'un numéro collé au code ne distinguent pas deux fiches (« Alcremie-RCL87 » et « Alcremie-V2-RCL087 » : Cardmarket a changé de graphie).
const baseDuSlug = slug => (slug ? String(slug).replace(/-V\d+(?=-|$)/i, '').replace(/(?<=\D)0+(?=\d)/g, '') : null);
const motsA = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');   // « Gather Snow » = « Snow Gather »
const attaquesContredites = (c, attaquesProduit) => {
    const pa = attaquesProduit || [], ca = (c.attaques || []).map(a => a && a.nom).filter(Boolean);
    return pa.length > 0 && ca.length > 0 && !pa.some(a => ca.some(b => motsA(a) === motsA(b)));
};
const lit = n => (n == null || String(n).trim() === '' ? null : String(n).trim());

/**
 * @param {{set: object, cartes: object[], produits: object[], lignes: object[], segmentDuSlug?: (slug: string, code: string) => string|null, estAdditionals?: (id: string) => boolean}} o
 *   `produits` : les produits du catalogue des expansions du set ({idProduct, idExpansion, idMetacard, name, numero, slug, slugSet}) ; `lignes` : TOUTES les lignes
 *   cartes_produits de ces produits (n'importe quelle carte) ; `cartes` : les cartes à considérer (au moins celles du set).
 */
function preparerSet({ set, cartes, produits, lignes, segmentDuSlug = null, estAdditionals = null }) {
    const idsExp = [].concat(set.idExpansion ?? []);
    // (a)+(b) : les cartes qui déclarent, dans CE set, au moins une impression NUMÉROTÉE — la définition du site (numerosDuSet)
    const numerosDe = new Map(), cs = [];
    for (const c of cartes) {
        if (!c.nomEn) continue;
        const ns = [...new Set(numerosDuSet(c.impressions, set).map(n => String(n).trim()))];
        if (ns.length) { numerosDe.set(c._id, ns); cs.push(c); }
    }
    const csTemoin = cartes.filter(c => c.nomEn && (numerosDe.has(c._id) || (c.sets || []).includes(set._id)));
    const temoin = temoinDuNom(csTemoin, idsExp[0] ?? null);
    // le préfixe de set de joindre() : COMMUN à toutes les impressions numérotées du set (EC1 qui mêle « S04 » et « 004 » n'est pas touché)
    const tousNumeros = cs.flatMap(c => numerosDe.get(c._id).map(sansPosition));
    const prefixes = new Set(tousNumeros.map(n => (n.match(/^([A-Z]+)(?=\d)/) || [])[1] ?? null));
    const prefixeDuSet = tousNumeros.length && prefixes.size === 1 && !prefixes.has(null) ? [...prefixes][0] : null;
    const clesDeNumero = raw => {
        const nu = sansPosition(raw);
        const sans = prefixeDuSet ? nu.replace(new RegExp(`^${prefixeDuSet}(?=\\d)`), '') : nu;
        return new Set([cleNumero(sans), cleNumero(nu)].filter(Boolean));
    };
    const clesImpression = (c) => numerosDe.get(c._id).map(raw => ({ raw, cles: clesDeNumero(raw) }));
    const impCles = new Map(cs.map(c => [c._id, clesImpression(c)]));
    const lignesDe = new Map();
    for (const l of lignes) (lignesDe.get(l.idProduct) || lignesDe.set(l.idProduct, []).get(l.idProduct)).push(l);
    const produitsReels = produits.filter(p => !estCarteCode(p.name));
    const info = new Map(produitsReels.map(p => {
        const d = decomposerNomCardmarket(p.name);
        const numero = lit(p.numero) ?? (segmentDuSlug && p.slug ? lit(segmentDuSlug(p.slug, set.code)) : null);
        const alias = aliasDe(d.nom, p.idExpansion);
        // le numéro d'un produit a, comme celui d'une impression, ses DEUX écritures (avec / sans le préfixe commun du set) : « SM18 » et « 18 » sont le même
        // numéro. Un produit n'est comparé à un autre (condition d) ni à une impression (condition b) que par ces clés — la règle de joindre(), pas une copie.
        const cles = numero ? clesDeNumero(numero) : new Set();
        return [p.idProduct, { d, numero, cle: numero ? cleNumero(numero) : null, cles, kp: [...new Set([...clesNom(d.nom), ...(alias ? clesNom(alias) : [])])] }];
    }));
    const parCle = new Map();
    for (const p of produitsReels) for (const k of info.get(p.idProduct).cles) (parCle.get(k) || parCle.set(k, []).get(k)).push(p);
    const concorde = (c, kp) => clesNom(nomJointDe(c)).some(k => kp.includes(k));
    const parId = new Map(produits.map(p => [p.idProduct, p]));

    function evaluer(idProduct, { cacher = false } = {}) {
        const p = parId.get(idProduct);
        // `candidats` : les cartes du set dont le NOM concorde (avec leurs numéros) — un INDICE pour la relecture humaine, jamais une attribution
        const doute = (motif, detail) => ({ idProduct, verdict: 'doute', motif, detail, candidats: p && info.has(idProduct) ? cs.filter(c => concorde(c, info.get(idProduct).kp)).slice(0, 5).map(c => ({ carteId: c._id, nomEn: c.nomEn, numeros: numerosDe.get(c._id) })) : [] });
        if (!p) return doute('set-inconnu', `produit ${idProduct} absent du catalogue des expansions ${idsExp.join(', ')}`);
        if (estCarteCode(p.name)) return doute('carte-code', `« ${p.name} » est une carte-code : ni fiche ni visuel possibles`);
        // (a)
        if (!idsExp.includes(p.idExpansion)) return doute('set-inconnu', `idExpansion ${p.idExpansion} du produit hors de celles du set « ${set._id} » (${idsExp.join(', ')})`);
        if (p.slugSet != null && p.slugSet !== set._id) return doute('set-inconnu', `le slugSet appris du produit (« ${p.slugSet} ») n'est pas « ${set._id} »`);
        if (estAdditionals && estAdditionals(set._id)) return doute('set-additionals', `« ${set._id} » est un set Additionals : le site ne l'affiche pas`);
        // lignes existantes
        const ls = cacher ? [] : (lignesDe.get(idProduct) || []);
        if (ls.length >= 2) return doute('plusieurs-lignes', `le produit a déjà ${ls.length} lignes (${ls.map(l => l._id).join(', ')}) : jamais touché`);
        if (ls.length === 1 && lit(ls[0].numeroFiche) != null) return doute('numero-fiche-deja-pose', `la ligne ${ls[0]._id} porte déjà numeroFiche « ${ls[0].numeroFiche} »`);
        const action = ls.length === 1 ? 'numeroFiche' : 'ligne-neuve';
        // (b)
        const i = info.get(idProduct);
        if (i.numero == null) return doute('produit-sans-numero', `ni numeros_cartes.numero ni segment de slug lisible (slug ${p.slug ?? '—'})${ls.length ? ` ; la carte ${ls[0].carteId} de sa ligne a ${(numerosDe.get(ls[0].carteId) || []).length} impression(s) numérotée(s) dans le set : fiche non séparable par le numéro` : ''}`);
        if (!cs.length) return doute('set-sans-impression', `aucune carte du set « ${set._id} » ne déclare d'impression numérotée dans ce set (tirage ${set.tirage ?? set.region}, ${[].concat(set.bulba?.expansion ?? []).join(' / ')})`);
        const memeNom = cs.filter(c => concorde(c, i.kp));
        const partage = (cles) => [...cles].some(k => i.cles.has(k));
        const matches = cs.filter(c => impCles.get(c._id).some(x => partage(x.cles)));
        if (!matches.length) {
            const motif = /\d[A-Za-z]$/.test(String(i.numero).trim()) ? 'variante-suffixee' : 'numero-absent';
            const connu = memeNom.length ? ` ; ${memeNom.slice(0, 4).map(c => `« ${c.nomEn} » (${c._id}) est connue aux n° ${numerosDe.get(c._id).join('/')}`).join(' ; ')}` : '';
            return doute(motif, motif === 'variante-suffixee'
                ? `le numéro « ${i.numero} » n'est celui d'aucune impression : variante (tampon ?) dont le scan du numéro nu serait celui d'un autre produit (numero-fiche-freres.js, §19)${connu}`
                : `le numéro « ${i.numero} » n'est celui d'aucune impression du set${connu}`);
        }
        // (c)
        const cause = []; const ok = [];
        for (const c of matches) {
            const autres = temoin(c, { nom: i.d.nom, attaques: i.d.attaques });
            if (autres) { cause.push(['nom-contredit', `le numéro désigne « ${c.nomEn} » (${c._id}), le nom « ${i.d.nom} » est celui de ${autres.slice(0, 3).map(x => `« ${x.nomEn} »`).join(', ')}`]); continue; }
            // témoin POSITIF des attaques : si le produit en liste et que la carte en a, au moins une doit être commune (ordre des mots ignoré). Sinon le numéro ment
            // (358427 : numéro SM18, attaques de la SM127) — jamais une fiche.
            if (attaquesContredites(c, i.d.attaques)) { cause.push(['attaques-contredites', `le numéro désigne « ${c.nomEn} » (${c._id}) mais aucune de ses attaques n'est celle du produit (${(i.d.attaques || []).join(' | ')})`]); continue; }
            if (concorde(c, i.kp)) { ok.push({ c, par: 'nom' }); continue; }
            // le témoin se tait : soit le nom ne désigne AUCUNE carte (écart de forme : rien ne confirme), soit il en désigne une autre et les attaques l'ont emporté (joindre())
            const designees = csTemoin.filter(x => concorde(x, i.kp));
            if (designees.length) ok.push({ c, par: 'attaques' });
            else cause.push(['nom-non-confirme', `le numéro désigne « ${c.nomEn} » (${c._id}) mais le nom « ${i.d.nom} » ne désigne aucune carte du set : rien ne confirme`]);
        }
        if (!ok.length) { const [m, d] = cause.find(x => x[0] === 'nom-contredit') || cause[0]; return doute(m, d); }
        // (d)
        if (ok.length > 1) return doute('deux-candidates', `${ok.length} cartes satisfont le set, le numéro et le nom : ${ok.map(x => `« ${x.c.nomEn} » (${x.c._id})`).join(', ')}`);
        const { c, par } = ok[0];
        const raws = impCles.get(c._id).filter(x => partage(x.cles)).map(x => x.raw);
        if (new Set(raws).size > 1) return doute('numero-ambigu', `la carte ${c._id} porte plusieurs impressions de même clé (${raws.join(' / ')}) : on ne choisit pas`);
        if (action === 'numeroFiche' && ls[0].carteId !== c._id) return doute('ligne-sur-une-autre-carte', `la ligne ${ls[0]._id} est sur la carte ${ls[0].carteId}, le set + numéro + nom désignent ${c._id} : rien n'est modifié`);
        const revendiquants = new Map();
        for (const k of i.cles) for (const q of parCle.get(k) || []) revendiquants.set(q.idProduct, q);
        for (const q of revendiquants.values()) {
            if (q.idProduct === idProduct) continue;
            const iq = info.get(q.idProduct);
            const lq = lignesDe.get(q.idProduct) || [];
            const surC = lq.some(l => l.carteId === c._id);
            if (!(surC || concorde(c, iq.kp))) continue;
            const frere = surC && baseDuSlug(q.slug) != null && baseDuSlug(q.slug) === baseDuSlug(p.slug);
            if (!frere) return doute('deux-produits-revendiquent', `le produit ${q.idProduct} « ${q.name} » (slug ${q.slug ?? '—'}) revendique aussi (carte ${c._id}, n° ${i.numero})${surC ? ' et y est déjà attaché' : ''} sans être une version de la même fiche`);
        }
        const tirage = set.tirage ?? set.region;
        return {
            idProduct, verdict: 'sur', action, carteId: c._id, numeroFiche: raws[0], preuve: PREUVE,
            detail: `set « ${set._id} » · n° ${i.numero} = impression ${raws[0]} de « ${c.nomEn} » · nom « ${i.d.nom} » ${par === 'nom' ? 'concorde' : 'départagé par les attaques (comme joindre())'} · seule carte du set et seul produit à ce (carte, numéro)`,
            horsSet: !(c.sets || []).includes(set._id), idExpansion: p.idExpansion, slugSet: set._id, tirage, slug: p.slug ?? null, idMetacard: p.idMetacard ?? null,
        };
    }

    // TÉMOINS HORS DE LA CLÉ (nom, attaques) : la vérité d'une calibration ne vaut que si une donnée que la clé (set + numéro) n'a PAS utilisée la confirme.
    const cartesParId = new Map(cartes.map(c => [c._id, c]));
    function temoinVerite(idProduct, carteId) {
        const c = cartesParId.get(carteId), i = info.get(idProduct);
        if (!i) return 'produit-absent';
        if (!c) return 'carte-absente';
        if (!concorde(c, i.kp)) return 'nom-ne-concorde-pas';
        if (attaquesContredites(c, i.d.attaques)) return 'attaques-contredites';
        return 'ok';
    }

    function evaluerCibles(ids) {
        const surs = [], doutes = [];
        for (const id of ids) { const r = evaluer(id); (r.verdict === 'sur' ? surs : doutes).push(r); }
        return { surs, doutes };
    }
    return { evaluer, evaluerCibles, temoinVerite, set, produits: produitsReels };
}

/**
 * CALIBRATION « LA VRAIE CARTE RETIRÉE » (§67) : pour chaque produit dont la vérité est connue, la carte vraie est ENLEVÉE de la base (avec toutes ses lignes) et la
 * règle est rejouée. Elle ne PEUT plus désigner la bonne carte : toute affirmation est donc fausse par construction (un faux = un cas qu'elle aurait écrit à tort),
 * et le seul résultat honnête est un doute (muet). La calibration « ligne cachée, carte présente » ne voit que les justes ; celle-ci voit le danger.
 * @param construire (cartesSans, lignesSans) => ctx   @param cartes les cartes du set   @param lignes ses lignes   @param verite Map(idProduct → [{carteId}])
 */
function calibrerCarteRetiree({ construire, cartes, lignes, ids, verite }) {
    const r = { total: 0, faux: [], muets: 0, motifsMuets: {} };
    const groupes = new Map();
    for (const id of ids) {
        const t = verite.get(id);
        if (!t || !t.length) continue;
        const k = [...new Set(t.map(x => x.carteId))].sort((a, b) => a - b).join(',');
        (groupes.get(k) || groupes.set(k, { retirees: new Set(t.map(x => x.carteId)), ids: [] }).get(k)).ids.push(id);
    }
    for (const g of groupes.values()) {
        const ctx = construire(cartes.filter(c => !g.retirees.has(c._id)), lignes.filter(l => !g.retirees.has(l.carteId)));
        for (const id of g.ids) {
            r.total++;
            const v = ctx.evaluer(id, { cacher: true });
            if (v.verdict === 'sur') r.faux.push({ idProduct: id, rendu: v.carteId, numeroFiche: v.numeroFiche, detail: v.detail, verite: verite.get(id) });
            else { r.muets++; r.motifsMuets[v.motif] = (r.motifsMuets[v.motif] || 0) + 1; }
        }
    }
    return r;
}

/**
 * CALIBRATION (§67) : la ligne déjà juste est CACHÉE (le produit redevient une cible sans ligne), la règle est rejouée, et on compte.
 * @param ctx preparerSet(…)  @param ids produits dont la vérité est connue  @param verite Map(idProduct → [{carteId, numeroFiche}])
 * @returns {{justes: number, faux: object[], muets: number, motifsMuets: object, numeroFicheDifferent: object[], total: number}}
 */
function calibrer(ctx, ids, verite) {
    const r = { justes: 0, faux: [], muets: 0, motifsMuets: {}, numeroFicheDifferent: [], total: 0 };
    for (const id of ids) {
        const t = verite.get(id);
        if (!t || !t.length) continue;
        r.total++;
        const v = ctx.evaluer(id, { cacher: true });
        if (v.verdict !== 'sur') { r.muets++; r.motifsMuets[v.motif] = (r.motifsMuets[v.motif] || 0) + 1; continue; }
        if (!t.some(x => x.carteId === v.carteId)) { r.faux.push({ idProduct: id, rendu: v.carteId, numeroFiche: v.numeroFiche, verite: t }); continue; }
        r.justes++;
        const vrai = t.find(x => x.carteId === v.carteId);
        if (vrai.numeroFiche != null && cleNumero(sansPosition(vrai.numeroFiche)) !== cleNumero(sansPosition(v.numeroFiche))) r.numeroFicheDifferent.push({ idProduct: id, rendu: v.numeroFiche, verite: vrai.numeroFiche });
    }
    return r;
}

module.exports = { preparerSet, calibrer, calibrerCarteRetiree, MOTIFS, PREUVE, baseDuSlug, sansPosition };
