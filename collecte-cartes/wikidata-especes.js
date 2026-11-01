// ============================================================
// NOMS D'ESPÈCES zh PAR WIKIDATA, ENTITÉ PAR ENTITÉ (CC0) — la logique, SANS réseau (2026-10-31, décision de l'éditeur)
// ============================================================
// Seule voie permise par robots.txt : https://www.wikidata.org/wiki/Special:EntityData/<Q>.json (le SPARQL, /w/api.php et en.wikipedia.org sont FERMÉS). Il faut donc les identifiants Q,
// et RIEN de conforme ne les énumère : on les DÉCOUVRE par le chaînage que l'entité porte elle-même. MESURÉ le 2026-10-31 sur Pikachu (Q9351), Raichu, Arbok, Sandshrew, Ekans :
// la propriété P1685 (« numéro de Pokédex ») porte UNE déclaration par Pokédex ; celle dont le qualificatif P972 (catalogue) vaut Q20005020 est le Pokédex NATIONAL (valeur « 025 »,
// rang préféré), et ses qualificatifs P155 / P156 (« précède / suit ») désignent l'espèce n-1 et n+1. Les « 023 », « R-023 », « 156 »… des autres déclarations sont des Pokédex régionaux.
// ⚠️ Un identifiant tiré d'un pointeur n'est JAMAIS cru : l'entité atteinte doit porter le numéro national ATTENDU (n±1) ; sinon elle n'entre pas dans la table et le rejet est écrit.
// ⚠️ La graine (Q9351 « censée être Pikachu ») est vérifiée par elle-même : son numéro national lu doit être celui que donne son nom anglais dans pokedex-dexids.json.
// ⚠️ Rien n'est deviné : un pointeur absent (hors des deux extrémités 1 et maxDex), un voisin introuvable, un numéro qui ne colle pas = RUPTURE nommée ; la marche continue par l'autre sens.
const { normaliserNom } = require('./jointure');

const NATIONAL = 'Q20005020';
/** La seule forme d'adresse que le script a le droit de demander à www.wikidata.org (robots.txt : `Allow: /wiki/Special:EntityData/*.`). */
const CHEMIN_AUTORISE = /^\/(robots\.txt|wiki\/Special:EntityData\/Q\d{1,10}\.json)$/;
const LANGUES = { 'zh-hk': 'hk', 'zh-hant': 'hant', 'zh-hans': 'hans', 'zh-cn': 'cn', 'zh-tw': 'tw', 'zh-mo': 'mo', 'zh-sg': 'sg', 'zh-my': 'my', zh: 'zh' };
const nz = s => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');

const idsDe = (s, p) => [...new Set(((s.qualifiers || {})[p] || []).map(x => x && x.datavalue && x.datavalue.value && x.datavalue.value.id).filter(Boolean))];
const estNational = s => s && s.rank !== 'deprecated' && idsDe(s, 'P972').includes(NATIONAL);

/** Réduit une réponse EntityData à l'essentiel (id, libellés zh + en, alias zh, déclaration NATIONALE de P1685 avec P972/P155/P156). Une réponse illisible est rendue telle quelle. */
function reduireEntite(brut, q) {
    let j; try { j = typeof brut === 'string' ? JSON.parse(brut) : brut; } catch { return String(brut); }
    const ents = (j && j.entities) || {};
    const e = ents[q] || Object.values(ents)[0];
    if (!e) return typeof brut === 'string' ? brut : JSON.stringify(brut);
    const garde = (o, f) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => f(k)));
    const nat = ((e.claims || {}).P1685 || []).filter(estNational).map(s => ({
        rank: s.rank, mainsnak: s.mainsnak,
        qualifiers: garde(s.qualifiers, k => k === 'P972' || k === 'P155' || k === 'P156')
    }));
    const sortie = { id: e.id, type: e.type, lastrevid: e.lastrevid, modified: e.modified, labels: garde(e.labels, k => k === 'en' || k in LANGUES), aliases: garde(e.aliases, k => k in LANGUES), claims: nat.length ? { P1685: nat } : {} };
    if (e.missing !== undefined) sortie.missing = e.missing;
    return JSON.stringify({ entities: { [q in ents ? q : (e.id || q)]: sortie } });
}

/** Lit une réponse EntityData (brute ou réduite) : { ok, q, n, en, labels, alias, prev, next, prevAmbigu, nextAmbigu } | { ok: false, raison }. */
function lireEntite(brut, qDemande) {
    let j; try { j = typeof brut === 'string' ? JSON.parse(brut) : brut; } catch { return { ok: false, raison: 'réponse illisible (pas du JSON)' }; }
    const ents = j && j.entities;
    if (!ents || typeof ents !== 'object') return { ok: false, raison: 'réponse sans « entities »' };
    const e = ents[qDemande];
    if (!e) return { ok: false, raison: `l'entité ${qDemande} n'est pas dans la réponse (clés : ${Object.keys(ents).join(', ') || 'aucune'}) — redirection ou fusion, non suivie` };
    if (e.missing !== undefined) return { ok: false, raison: `l'entité ${qDemande} n'existe pas (missing)` };
    if (e.id && e.id !== qDemande) return { ok: false, raison: `l'entité demandée ${qDemande} répond sous l'identifiant ${e.id} (redirection) — non suivie` };
    const nat = ((e.claims || {}).P1685 || []).filter(estNational);
    if (nat.length !== 1) return { ok: false, raison: nat.length ? `${nat.length} déclarations « numéro de Pokédex national » (P1685/P972=${NATIONAL}) : plusieurs, aucune n'est arbitrée` : `aucune déclaration « numéro de Pokédex national » (P1685 avec P972=${NATIONAL})` };
    const s = nat[0];
    const valeur = s.mainsnak && s.mainsnak.datavalue && s.mainsnak.datavalue.value;
    if (!/^\d{1,4}$/.test(String(valeur ?? ''))) return { ok: false, raison: `numéro national illisible (« ${valeur} »)` };
    const lib = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => k in LANGUES).map(([k, v]) => [k, v && v.value]).filter(([, v]) => v));
    const alias = Object.fromEntries(Object.entries(e.aliases || {}).filter(([k]) => k in LANGUES).map(([k, v]) => [k, (v || []).map(x => x.value).filter(Boolean)]));
    const prev = idsDe(s, 'P155'), next = idsDe(s, 'P156');
    return {
        ok: true, q: qDemande, n: Number(valeur), en: (e.labels && e.labels.en && e.labels.en.value) || null, labels: lib(e.labels), alias,
        prev: prev.length === 1 ? prev[0] : null, next: next.length === 1 ? next[0] : null, prevAmbigu: prev.length > 1, nextAmbigu: next.length > 1
    };
}

/** Le nom anglais de l'entité donne-t-il ce numéro dans pokedex-dexids.json (la clé de PRODUCTION, normaliserNom) ? 'oui' | 'non' (nom connu, autre numéro) | 'inconnu'. */
function verdictDuNom(en, n, dexids) {
    if (!en) return 'inconnu';
    const d = (dexids || {})[normaliserNom(en)];
    if (!d || !d.length) return 'inconnu';
    return d.includes(n) ? 'oui' : 'non';
}

/** La graine se vérifie ELLE-MÊME : numéro national lu + nom anglais qui donne le même numéro. Un nom inconnu ne vérifie rien (une graine se prouve, elle ne se suppose pas). */
function verifierGraine(entite, dexids) {
    if (!entite || !entite.ok) return { ok: false, raison: `graine non lisible : ${entite && entite.raison}` };
    const v = verdictDuNom(entite.en, entite.n, dexids);
    if (v === 'oui') return { ok: true };
    return { ok: false, raison: v === 'non' ? `graine ${entite.q} : son nom « ${entite.en} » donne un autre numéro que son numéro national lu (${entite.n}) — la graine n'est pas ce qu'on croyait` : `graine ${entite.q} (n° ${entite.n}, « ${entite.en} ») non vérifiable : nom absent de pokedex-dexids` };
}

/** Le pas n±1 : l'entité atteinte porte-t-elle le numéro national ATTENDU ? Son nom anglais, quand il est connu, ne doit pas le contredire. */
function controlerPas(entite, { attendu, dexids }) {
    if (!entite || !entite.ok) return { ok: false, raison: `entité illisible : ${entite && entite.raison}` };
    if (entite.n !== attendu) return { ok: false, raison: `numéro national ${entite.n} ne colle pas avec le numéro attendu ${attendu}` };
    const v = verdictDuNom(entite.en, entite.n, dexids);
    if (v === 'non') return { ok: false, raison: `le nom anglais « ${entite.en} » contredit le numéro ${entite.n} (pokedex-dexids)` };
    return { ok: true, labelControle: v };
}

// ── LA MARCHE ──────────────────────────────────────────────────────────────────────────────────────────────────────

const etatVide = () => ({ graine: null, lus: {}, rejets: [], ruptures: [], lectures: 0, jalonFait: false });
const clone = o => JSON.parse(JSON.stringify(o));
const marquer = (etat, r) => { if (!etat.ruptures.some(x => x.n === r.n && x.sens === r.sens && x.raison === r.raison)) etat.ruptures.push(r); };

/** Les voisins à lire : un pointeur d'une entité lue vers n±1 non lu et non rejeté. Les pointeurs absents ou contradictoires sont consignés en ruptures (jamais devinés). */
function frontiere(etat, maxDex) {
    const sorties = new Map(), rejetes = new Set(etat.rejets.map(r => `${r.q}|${r.attendu}`));
    for (const e of Object.values(etat.lus).sort((a, b) => a.n - b.n)) {
        for (const sens of [1, -1]) {
            const m = e.n + sens;
            if (m < 1) continue;
            const ptr = sens > 0 ? e.next : e.prev, ambigu = sens > 0 ? e.nextAmbigu : e.prevAmbigu;
            const voisin = etat.lus[m];
            if (voisin) { if (ptr && voisin.q !== ptr) marquer(etat, { n: m, sens, q: ptr, raison: `le pointeur de l'espèce n°${e.n} (${ptr}) contredit l'entité lue au n°${m} (${voisin.q})` }); continue; }
            if (!ptr) {
                const fin = sens > 0 ? e.n >= (etat.maxDex ?? Infinity) : e.n <= 1;
                if (!fin) marquer(etat, { n: m, sens, q: null, raison: `aucun ${sens > 0 ? 'suivant' : 'précédent'} déclaré (${ambigu ? 'plusieurs, ' : ''}n°${e.n} n'est pas une extrémité)` });
                continue;
            }
            if (rejetes.has(`${ptr}|${m}`)) continue;
            sorties.set(`${m}|${ptr}`, { n: m, q: ptr, via: e.n, sens });
        }
    }
    return [...sorties.values()];
}

/** Le prochain voisin : si des priorités restent à lire, celui qui en rapproche le plus ; sinon le sens descendant d'abord (24 requêtes seulement pour atteindre le n°1), puis le montant. */
function choisirCible(cibles, nonLues) {
    if (!cibles.length) return null;
    if (nonLues.length) {
        let meilleur = null;
        for (const c of cibles) {
            for (const p of nonLues) {
                if (!((c.sens > 0 && p >= c.n) || (c.sens < 0 && p <= c.n))) continue;
                const cout = Math.abs(p - c.n);
                if (!meilleur || cout < meilleur.cout || (cout === meilleur.cout && c.sens < meilleur.c.sens)) meilleur = { c, cout };
            }
        }
        if (meilleur) return meilleur.c;
    }
    return [...cibles].sort((a, b) => (a.sens - b.sens) || (a.sens < 0 ? b.n - a.n : a.n - b.n))[0];
}

function construireJalon(etat, priorites, luLe) {
    return {
        luLe, licence: 'CC0', source: 'Wikidata (Special:EntityData)', requetes: etat.lectures,
        especes: priorites.map(p => {
            const e = etat.lus[p.dex];
            const valeurs = new Set(Object.values(e.labels).map(nz));
            const noms = (p.noms || []).map(nz);
            return {
                dex: p.dex, q: e.q, en: e.en, labels: e.labels, noms_source: p.noms || [], sets: p.sets || [],
                concordance: !noms.length ? 'sans-nom' : noms.some(n => valeurs.has(n)) ? 'oui' : 'non'
            };
        }).sort((a, b) => a.dex - b.dex)
    };
}

/**
 * La marche, entité par entité, SANS réseau (lire est injecté).
 * @param {object} o
 * @param {(q:string)=>Promise<{json?:any, absente?:boolean, redirigee?:boolean, cache?:boolean}>} o.lire   LÈVE { bloque } sur un arrêt d'hôte, { plafond } sur le plafond de requêtes
 * @param {string} o.graine   identifiant Q de départ — vérifié, jamais cru
 * @param {object} o.dexids   pokedex-dexids.json
 * @param {number} [o.maxDex] numéro national maximal attendu (extrémité haute légitime)
 * @param {Array<{dex:number, noms?:string[], sets?:string[]}>} [o.priorites]
 * @returns {Promise<{etat:object, code:number, message:string}>}  codes : 0 table complète · 3 arrêt d'hôte · 4 erreur de lecture / plafond · 5 graine non vérifiée · 6 marche finie mais INCOMPLÈTE · 7 limite de lectures
 */
async function marcher({ lire, graine, dexids, maxDex = 1025, priorites = [], etatInitial = null, ecrire = () => {}, jalon = () => {}, maxLectures = Infinity, luLe = () => new Date().toISOString() }) {
    const etat = etatInitial ? Object.assign(etatVide(), clone(etatInitial)) : etatVide();
    etat.maxDex = maxDex;
    const lireQ = async q => {
        try { const r = await lire(q); if (!r.cache) etat.lectures++; return { r }; }
        catch (e) {
            etat.lectures++;
            if (e && e.bloque) return { code: 3, message: `ARRÊT DÉFINITIF DE L'HÔTE (${e.message}) — plus aucune requête ; ${Object.keys(etat.lus).length} espèces déjà lues et écrites` };
            if (e && e.plafond) return { code: 4, message: `plafond de requêtes atteint (${e.message}) — ${Object.keys(etat.lus).length} espèces lues` };
            return { code: 4, message: `erreur de lecture sur ${q} : ${e && e.message} — arrêt, ${Object.keys(etat.lus).length} espèces lues` };
        }
    };
    const lesPriorites = [...new Map(priorites.map(p => [p.dex, p])).values()];
    const entree = (ent, ctl) => ({ n: ent.n, q: ent.q, en: ent.en, labels: ent.labels, alias: ent.alias, prev: ent.prev, next: ent.next, prevAmbigu: ent.prevAmbigu, nextAmbigu: ent.nextAmbigu, labelControle: ctl.labelControle, luLe: luLe() });
    const signalerJalon = () => {
        if (etat.jalonFait || !lesPriorites.length || !lesPriorites.every(p => etat.lus[p.dex])) return;
        etat.jalonFait = true; jalon(construireJalon(etat, lesPriorites, luLe())); ecrire(etat);
    };

    // 1. LA GRAINE (vérifiée par elle-même)
    if (!Object.values(etat.lus).some(e => e.q === graine)) {
        const { r, code, message } = await lireQ(graine);
        if (code) return { etat, code, message };   // 3 arrêt d'hôte · 4 erreur de lecture : la graine n'a pas été REFUSÉE, elle n'a pas pu être lue
        if (r.absente || r.redirigee || !r.json) return { etat, code: 5, message: `graine ${graine} non lue (${r.absente ? 'absente' : r.redirigee ? 'redirigée' : 'réponse vide'}) — arrêt avant toute marche` };
        const ent = lireEntite(r.json, graine), v = verifierGraine(ent, dexids);
        if (!v.ok) return { etat, code: 5, message: `graine REFUSÉE : ${v.raison} — arrêt avant toute marche` };
        etat.graine = { q: graine, n: ent.n };
        etat.lus[ent.n] = entree(ent, { labelControle: 'oui' });
        ecrire(etat);
    }
    signalerJalon();

    // 2. LA MARCHE : un seul voisin à la fois, chaque pas vérifié par le numéro attendu
    for (;;) {
        if (etat.lectures >= maxLectures) return { etat, code: 7, message: `limite de ${maxLectures} lectures atteinte — ${Object.keys(etat.lus).length} espèces lues` };
        const cible = choisirCible(frontiere(etat, maxDex), lesPriorites.map(p => p.dex).filter(d => !etat.lus[d]));
        if (!cible) break;
        const { r, code, message } = await lireQ(cible.q);
        if (code) return { etat, code, message };
        const refuser = raison => { etat.rejets.push({ q: cible.q, attendu: cible.n, via: cible.via, raison }); marquer(etat, { n: cible.n, sens: cible.sens, q: cible.q, raison }); ecrire(etat); };
        if (r.absente) { refuser('entité introuvable (404)'); continue; }
        if (r.redirigee) { refuser('entité redirigée (non suivie)'); continue; }
        const ent = lireEntite(r.json, cible.q), ctl = controlerPas(ent, { attendu: cible.n, dexids });
        if (!ctl.ok) { refuser(ctl.raison); continue; }
        const e = entree(ent, ctl);
        const retour = cible.sens > 0 ? ent.prev : ent.next;
        if (retour !== etat.lus[cible.via].q) e.reciproque = false;
        etat.lus[cible.n] = e;
        ecrire(etat);
        signalerJalon();
    }

    // 3. LE BILAN : complet seulement si les DEUX extrémités sont atteintes sans rupture
    const lus = Object.values(etat.lus);
    const bas = etat.lus[1] && etat.lus[1].prev == null;
    const haut = lus.some(e => e.n >= maxDex && e.next == null);
    const nonLues = lesPriorites.filter(p => !etat.lus[p.dex]).map(p => p.dex);
    if (!etat.ruptures.length && bas && haut) return { etat, code: 0, message: `table complète : ${lus.length} espèces, du n°1 au n°${Math.max(...lus.map(e => e.n))}` };
    return {
        etat, code: 6,
        message: `marche INCOMPLÈTE : ${lus.length} espèces lues, ${etat.ruptures.length} rupture(s) ${JSON.stringify(etat.ruptures.slice(0, 6).map(x => `n°${x.n}: ${x.raison}`))}, extrémité basse ${bas ? 'atteinte' : 'NON atteinte'}, haute ${haut ? 'atteinte' : 'NON atteinte'}${nonLues.length ? `, priorités non lues ${JSON.stringify(nonLues)}` : ''}`
    };
}

/** Le fichier lu par table-zh.lireEspecesWikidata : { results: { bindings }, meta, etat }. Un binding par espèce lue ; les libellés par langue (hk, hant, hans, cn, tw, mo, sg, my, zh). */
function construireSortie(etat, { luLe, requetes = etat.lectures } = {}) {
    const bindings = Object.values(etat.lus).sort((a, b) => a.n - b.n).map(e => {
        const b = { n: { value: String(e.n) }, q: { value: e.q } };
        if (e.en) b.en = { value: e.en };
        for (const [lang, champ] of Object.entries(LANGUES)) if (e.labels[lang]) b[champ] = { value: e.labels[lang] };
        return b;
    });
    return {
        results: { bindings },
        meta: { source: 'Wikidata (Special:EntityData/<Q>.json, entité par entité)', licence: 'CC0', luLe, requetes, especes: bindings.length, graine: etat.graine, nationalP972: NATIONAL },
        etat: { graine: etat.graine, lus: etat.lus, rejets: etat.rejets, ruptures: etat.ruptures, lectures: etat.lectures, jalonFait: etat.jalonFait }
    };
}

module.exports = { NATIONAL, CHEMIN_AUTORISE, LANGUES, reduireEntite, lireEntite, verdictDuNom, verifierGraine, controlerPas, frontiere, choisirCible, construireJalon, marcher, construireSortie };
