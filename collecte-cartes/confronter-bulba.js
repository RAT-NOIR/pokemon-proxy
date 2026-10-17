// ============================================================
// CONFRONTER LES CHAMPS D'ORIGINE BULBAPEDIA À D'AUTRES SOURCES — fonction PURE (aucune base, aucun réseau)
// ============================================================
// Port testé de la mesure du 2026-10-17 (couverture/S7/BULBA-REMPLACEMENT/mesure2.js), pour que l'arbitrage, la provenance et la mesure d'alias lisent
// la MÊME chose (CLAUDE.md : « la sonde lit ce que lit la production »). Sources : pkc = PTCG-database en (pkmncards), tdx = clone TCGdex, jp = PTCG-database jp
// (pokemon-card.com). Ces sources sont des DONNÉES : seul leur contenu JSON est comparé, rien n'en est exécuté.
//
// 🔑 LE NOM EST UN TÉMOIN, JAMAIS UN ACCORD COMPTÉ : la clé d'appariement est (set, numéro) ; le nom de la source doit ensuite concorder avec nomEn / nomJa
// pour que l'impression compte comme « confirmée ». Un nom qui diverge n'est pas confirmé (nomDiff) et ne fait comparer AUCUN champ.
// 🔑 UN ALIAS DE SET est une entrée d'une table FERMÉE et PROUVÉE (collecte-cartes/alias-sets-bulba.js) : ici il est seulement LU. Sans table, la comparaison reste
// celle de la mesure (nom de set exact et unique + deux alias historiques « EX », « Platinum: »).

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[’‘`´]/g, "'").replace(/[^a-z0-9぀-ヿ一-鿿]/g, '');
const cn = n => {
    if (n === null || n === undefined) return null;
    const s = String(n).trim().toLowerCase().split('/')[0].replace(/\s+/g, '');
    const m = s.match(/^([a-z-]*)0*(\d+)([a-z]*)$/);
    return m ? m[1] + m[2] + m[3] : s;
};
const entier = v => { const m = String(v ?? '').match(/\d+/); return m ? +m[0] : null; };
const dateIso = s => { if (!s) return null; const t = Date.parse(s + (/^\d{4}-\d\d-\d\d$/.test(s) ? 'T00:00:00Z' : ' UTC')); return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10); };
const TYPE = { electric: 'lightning', dark: 'darkness', steel: 'metal' };
const typeN = s => { const n = norm(s); return TYPE[n] || n; };
const tokens = s => String(s ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

const egalNum = (a, b) => Number(a) === Number(b);
const egalIll = (a, s) => { const A = norm(a), S = norm(s); return !!A && !!S && (A === S || S.includes(A) || A.includes(S)); };
const egalAtt = (a, s) => {
    const A = new Set(a.map(norm)), S = new Set(s.map(norm));
    const incl = (x, y) => [...x].every(v => y.has(v));
    if (A.size === S.size && incl(A, S)) return true;
    if (incl(A, S) || incl(S, A)) return 'approx';
    return false;
};

function indexer(cartes, cleSet, nomSet) {
    const noms = new Map(), card = new Map(), compteur = new Map();
    for (const c of cartes) {
        const ks = cleSet(c); const kn = norm(nomSet(c));
        if (kn) { if (!noms.has(kn)) noms.set(kn, new Set()); noms.get(kn).add(ks); }
        const num = cn(c.number ?? c.numero);
        const k = ks + '|' + num;
        if (!card.has(k)) card.set(k, []); card.get(k).push(c);
        if (!compteur.has(ks)) compteur.set(ks, new Set()); compteur.get(ks).add(num);
    }
    return { noms, card, compteur };
}

/** Les index des sources (exportés : le prouveur d'alias lit les mêmes index). */
function construireIndex(sources) {
    const tdx = sources.tdx || { sets: [], cartes: [] };
    const tdxSetParCle = new Map(tdx.sets.map(s => [s.serie + '/' + s.fichier, s]));
    const IX = {
        pkc: indexer(sources.pkc || [], c => c.dossier, c => c.set_full_name),
        tdx: indexer(tdx.cartes, c => c.serie + '/' + c.dossierSet, c => (tdxSetParCle.get(c.serie + '/' + c.dossierSet) || {}).nom),
        jp: indexer(sources.jp || [], c => c.dossier.toLowerCase(), c => c.dossier),
    };
    const pkcSet = new Map();
    for (const c of sources.pkc || []) if (!pkcSet.has(c.dossier)) pkcSet.set(c.dossier, { nom: c.set_full_name, date: c.date });
    return { IX, tdxSetParCle, pkcSet };
}

const NOMS_SOURCE = { pkc: 'pkmncards', tdx: 'tcgdex', jp: 'pokemon-card.com' };

/**
 * @param {{cartes:object[], sets:object[], sources:{pkc:object[], tdx:{sets:object[],cartes:object[]}, jp:object[]}, alias:null|{intl:Object,jp:Object}}} d
 *   alias.intl[normExpansion] = { pkc:[dossiers], tdx:['serie/dossier'] } · alias.jp[normExpansion] = ['dossier en minuscules']
 * @returns {{lignes:object[], appar:object, nonResolues:object, confirmees:object}}
 */
function confronter({ cartes, sets, sources, alias = null }) {
    const { IX, tdxSetParCle, pkcSet } = construireIndex(sources);
    const AL = alias || { intl: {}, jp: {} };
    const DEN = new Map();   // `${champ}\u0000${cle}` -> { champ, cle, bulba, contexte, parSource }
    const den = (champ, cle, bulba, contexte) => { const k = champ + '\u0000' + cle; const o = { champ, cle, bulba, contexte, parSource: {} }; DEN.set(k, o); return o; };
    const lg = (champ, cle) => DEN.get(champ + '\u0000' + cle);
    // `extra` : un champ de la MÊME fiche source, étranger au champ comparé, que l'arbitrage lit comme preuve structurelle (ex. les variantes TCGdex pour la rareté)
    const rec = (champ, cle, src, statut, valeur, via, extra) => { const o = lg(champ, cle); if (o) { const e = { statut, valeur }; if (via) e.via = via; if (extra) e.extra = extra; o.parSource[src] = e; } };
    const cmp = (champ, cle, src, bulba, srcVal, egal, via, extra) => {
        if (srcVal === null || srcVal === undefined || srcVal === '' || (Array.isArray(srcVal) && !srcVal.length)) return rec(champ, cle, src, 'abs', null, via, extra);
        const r = egal(bulba, srcVal);
        rec(champ, cle, src, r === true ? 'ok' : r === 'approx' ? 'approx' : 'ko', srcVal, via, extra);
    };

    const setParExp = new Map();
    for (const s of sets) { const e = s.bulba?.expansion; if (!e) continue; const k = (s.tirage || s.region) + '|' + norm(e); if (!setParExp.has(k)) setParExp.set(k, []); setParExp.get(k).push(s); }
    // `cle` = clé (set, numéro) trouvée, comme la mesure du 2026-10-17 (en intl elle compte aussi les noms divergents) ; `confirmees` = clé ET nom concordant (seules celles-là comparent des champs)
    const appar = { intl: { impr: 0, cle: 0, confirmees: 0, non: 0, doublon: 0, nomDiff: 0 }, jp: { impr: 0, cle: 0, confirmees: 0, non: 0, doublon: 0, nomDiff: 0 }, 'zh-hant': { impr: 0, cle: 0, non: 0 }, 'zh-hans': { impr: 0, cle: 0, non: 0 } };
    const nonResolues = { intl: {}, jp: {} };
    const appariements = [];   // chaque clé (set, numéro) trouvée chez une source : { carteId, idx de l'impression, tirage, src, nomOk } — la preuve du nom ET du numéro, par impression
    const confirmees = { pkc: new Set(), tdx: new Set(), jp: new Set() };

    for (const k of cartes) {
        const bul = { illustrateur: k.illustrateur, pv: k.pv, retraite: k.retraite, faiblesse: k.faiblesse, resistance: k.resistance, ndex: k.ndex, attaques: (k.attaques || []).length ? k.attaques : null };
        const ctxC = { carteId: k._id, nomEn: k.nomEn, categorie: k.categorie ?? null };
        for (const [ch, v] of Object.entries(bul)) if (v !== null && v !== undefined && v !== '') den('carte.' + ch, k._id, v, ctxC);
        const accord = { pkc: [], tdx: [], jp: [] };
        (k.impressions || []).forEach((im, idx) => {
            const tir = im.tirage; const ikey = k._id + '#' + idx;
            const ctxI = { carteId: k._id, nomEn: k.nomEn, categorie: k.categorie ?? null, tirage: tir, exp: im.expansion, numero: im.numero };
            const numerique = im.total && /^\d+$/.test(String(im.total).trim());
            if (tir === 'intl' || tir === 'jp') { if (numerique) den('impression.total', ikey, im.total, ctxI); if (tir === 'intl' && im.rarete) den('impression.rarete', ikey, im.rarete, ctxI); }
            if (tir === 'intl') {
                appar.intl.impr++;
                const kn = norm(im.expansion); const num = cn(im.numero); let got = false, confirmee = false;
                const alt = [kn, norm(String(im.expansion).replace(/^EX /, '')), norm(String(im.expansion).replace(/^Platinum: /, ''))];
                const al = AL.intl[kn] || null;
                for (const [src, ix] of [['pkc', IX.pkc], ['tdx', IX.tdx]]) {
                    let sks;
                    if (al && Array.isArray(al[src]) && al[src].length) sks = al[src];
                    else { const kk = alt.find(a => { const s = ix.noms.get(a); return s && s.size === 1; }); sks = kk ? [...ix.noms.get(kk)] : []; }
                    if (!sks.length) continue;
                    const cs = sks.flatMap(sk => ix.card.get(sk + '|' + num) || []);
                    if (!cs.length) continue;
                    if (cs.length > 1) { appar.intl.doublon++; continue; }
                    const c = cs[0]; got = true;
                    appariements.push({ carteId: k._id, idx, tirage: 'intl', src, nomOk: norm(c.name) === norm(k.nomEn) });
                    if (norm(c.name) !== norm(k.nomEn)) { appar.intl.nomDiff++; continue; }
                    accord[src].push({ c, im }); confirmee = true;
                    const totS = src === 'pkc' ? entier(c.set_total) : (tdxSetParCle.get(c.serie + '/' + c.dossierSet) || {}).total;
                    if (numerique) cmp('impression.total', ikey, src, im.total, totS, (a, b) => entier(a) === b);
                    if (im.rarete) cmp('impression.rarete', ikey, src, im.rarete, c.rarity, (a, b) => tokens(a) === tokens(b), null, src === 'tdx' && Array.isArray(c.variants) ? { variants: c.variants } : null);
                }
                if (confirmee) appar.intl.confirmees++;
                if (got) appar.intl.cle++; else { appar.intl.non++; nonResolues.intl[im.expansion] = (nonResolues.intl[im.expansion] || 0) + 1; }
            } else if (tir === 'jp') {
                appar.jp.impr++;
                const kn = norm(im.expansion);
                let codes;
                if (AL.jp[kn] && AL.jp[kn].length) codes = AL.jp[kn];
                else { const ss = setParExp.get('jp|' + kn); codes = ss && ss.length === 1 && ss[0].code ? [String(ss[0].code).toLowerCase()] : []; }
                const cs = codes.flatMap(code => IX.jp.card.get(code + '|' + cn(im.numero)) || []);
                if (!cs.length) { appar.jp.non++; nonResolues.jp[im.expansion] = (nonResolues.jp[im.expansion] || 0) + 1; return; }
                if (cs.length > 1) { appar.jp.doublon++; return; }
                const c = cs[0];
                appariements.push({ carteId: k._id, idx, tirage: 'jp', src: 'jp', nomOk: !!(k.nomJa && norm(c.name) === norm(k.nomJa)) });
                if (!(k.nomJa && norm(c.name) === norm(k.nomJa))) { appar.jp.nomDiff++; return; }
                appar.jp.cle++; appar.jp.confirmees++;
                accord.jp.push({ c, im });
                if (numerique) cmp('impression.total', ikey, 'jp', im.total, entier(c.set_total), (a, b) => entier(a) === b);
            } else if (tir === 'zh-hant' || tir === 'zh-hans') { appar[tir].impr++; }
        });
        for (const src of ['pkc', 'tdx', 'jp']) {
            const L = accord[src]; if (!L.length) continue;
            confirmees[src].add(k._id);
            const pkcLike = src === 'pkc' || src === 'jp';
            const val = (champ, c) => {
                if (pkcLike) switch (champ) {
                    case 'illustrateur': return Array.isArray(c.author) ? c.author.join(' & ') : c.author;
                    case 'pv': return c.hp ?? null; case 'retraite': return c.retreat ?? null;
                    case 'faiblesse': return c.weakness && Array.isArray(c.weakness.type) ? (c.weakness.type[0] || null) : null;
                    case 'resistance': return c.resistance && Array.isArray(c.resistance.type) ? (c.resistance.type[0] || null) : null;
                    case 'attaques': return Array.isArray(c.attacks) && c.attacks.length ? c.attacks.map(a => a.name) : null;
                    case 'ndex': return c.pokedex_number != null ? entier(c.pokedex_number) : null;
                } else switch (champ) {
                    case 'illustrateur': return c.illustrator; case 'pv': return c.hp; case 'retraite': return c.retreat;
                    case 'faiblesse': return c.weakness; case 'resistance': return c.resistance;
                    case 'attaques': return c.attacks && c.attacks.length ? c.attacks : null; case 'ndex': return c.dexId;
                }
            };
            const champs = src === 'jp' ? ['illustrateur', 'pv', 'retraite', 'faiblesse', 'attaques', 'ndex'] : ['illustrateur', 'pv', 'retraite', 'faiblesse', 'resistance', 'attaques', 'ndex'];
            for (const ch of champs) {
                let b = bul[ch];
                if (b === null || b === undefined || b === '') continue;
                if (ch === 'attaques') b = b.map(a => (src === 'jp' ? (a.nomJa || a.nom) : a.nom)).filter(Boolean);
                if (ch === 'attaques' && !b.length) continue;
                const egal = ch === 'attaques' ? egalAtt : (ch === 'pv' || ch === 'retraite' || ch === 'ndex') ? egalNum : ch === 'illustrateur' ? egalIll : (a, s) => typeN(a) === typeN(s);
                const vals = L.map(x => val(ch, x.c)).filter(v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
                let sv = null;
                if (vals.length) { const bon = vals.find(v => egal(b, v) === true) ?? vals.find(v => egal(b, v) === 'approx'); sv = bon ?? vals[0]; }
                cmp('carte.' + ch, k._id, src, b, sv, egal, L[0].im.expansion + ' ' + L[0].im.numero);
            }
        }
    }

    // ── sets (tirage intl)
    for (const s of sets.filter(s => (s.tirage || s.region) === 'intl')) {
        const kn = norm(s.nomEn || s.bulba?.expansion);
        const al = AL.intl[kn] || (s.bulba?.expansion ? AL.intl[norm(s.bulba.expansion)] : null) || null;
        const un = (ix, src) => { if (al && Array.isArray(al[src]) && al[src].length === 1) return al[src][0]; const t = ix.noms.get(kn); return t && t.size === 1 ? [...t][0] : null; };
        const kP = un(IX.pkc, 'pkc'), kT = un(IX.tdx, 'tdx');
        const ctxS = { setId: s._id };
        if (s.dateSortieEn) {
            const b = dateIso(s.dateSortieEn);
            den('set.dateSortieEn', s._id, b, ctxS);
            const dcmp = (src, sd) => cmp('set.dateSortieEn', s._id, src, b, sd, (a, c) => a === c ? true : (c.slice(0, 7) === a.slice(0, 7) && c.endsWith('-01') ? 'approx' : false));
            if (kP && pkcSet.get(kP)) dcmp('pkc', dateIso(pkcSet.get(kP).date));
            if (kT && tdxSetParCle.get(kT)) dcmp('tdx', dateIso(tdxSetParCle.get(kT).date));
        }
        if (s.totalImprime) {
            den('set.totalImprime', s._id, s.totalImprime, ctxS);
            // ⚠️ `totalImprime` de Bulbapedia = le NOMBRE DE CARTES du set, secrètes comprises (Paldea Evolved 279 = 279 numéros distincts, dénominateur imprimé 193) :
            // mesuré le 2026-10-17 sur 89 sets appariés des deux côtés — égal au décompte de numéros de TCGdex pour 71, au dénominateur officiel pour 14. Le comparateur
            // « dénominateur imprimé » fabriquait 76 désaccords : on compte donc les numéros distincts, comme la mesure d'origine.
            if (kP && IX.pkc.compteur.get(kP)) cmp('set.totalImprime', s._id, 'pkc', s.totalImprime, IX.pkc.compteur.get(kP).size, (a, c) => a === c);
            if (kT && IX.tdx.compteur.get(kT)) cmp('set.totalImprime', s._id, 'tdx', s.totalImprime, IX.tdx.compteur.get(kT).size, (a, c) => a === c);
        }
    }

    const lignes = [];
    for (const o of DEN.values()) {
        const st = Object.values(o.parSource).map(x => x.statut);
        o.statut = st.includes('ok') ? 'accord' : st.includes('approx') ? 'approx' : st.includes('ko') ? 'desaccord' : 'sans';
        lignes.push(o);
    }
    return { lignes, appar, nonResolues, appariements, confirmees: { pkc: confirmees.pkc.size, tdx: confirmees.tdx.size, jp: confirmees.jp.size } };
}

/** Synthèse par champ (même découpage que la mesure : accord / approx seul / désaccord seul / sans remplaçant), dénominateur imprimé. */
function synthese(lignes) {
    const o = {};
    for (const l of lignes) { const s = (o[l.champ] ||= { bulba: 0, accord: 0, approxSeul: 0, desaccordSeul: 0, sansRemplacant: 0 }); s.bulba++; s[{ accord: 'accord', approx: 'approxSeul', desaccord: 'desaccordSeul', sans: 'sansRemplacant' }[l.statut]]++; }
    return o;
}

module.exports = { confronter, synthese, construireIndex, norm, cn, entier, NOMS_SOURCE };
