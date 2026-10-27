'use strict';
// LOT PERF-SCAN, P3 — le taux de change du jour n'est plus relu en base à CHAQUE scan d'une annonce en devise étrangère (une requête triée + un Intl.DateTimeFormat reconstruit à chaque appel, du CALCUL étiré ~7 fois sur
// 0,15 vCPU) : un cache BORNÉ (64 entrées) et DATÉ (120 s), clé = (devise, jour de Paris), vidé par l'écriture des taux. Aucun changement de décision : le même { versEUR, tauxDate } que la lecture directe, ou — passé le délai,
// jour changé, taux réécrit — la lecture directe. Une panne n'est jamais gardée. Un appelant qui injecte SA collection (les bancs) ne passe jamais par le cache du module.
const T = require('../identifier/taux');
let ok = 0, ko = 0;
const v = (nom, obtenu, attendu) => { const b = JSON.stringify(obtenu) === JSON.stringify(attendu); console.log(`${b ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${b ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); b ? ok++ : ko++; };

(async () => {
    // ── 1. parisDe : la même sortie qu'avec un formateur reconstruit à chaque appel (heure d'été, minuit, changement d'heure)
    const avant = d => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value])); return { jour: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour) }; };
    const dates = ['2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-27T22:59:59Z', '2026-10-27T23:00:00Z', '2026-12-31T23:30:00Z', '2027-01-01T00:00:00Z', '2026-07-14T14:00:00Z'].map(s => new Date(s));
    v('parisDe : identique à la construction d\'avant sur 9 instants dont les deux changements d\'heure et les minuits', dates.map(d => T.parisDe(d)), dates.map(avant));

    // ── 2. le cache : une collection espion
    const jour = '2026-10-27', maintenant = new Date('2026-10-27T10:00:00Z');
    let lectures = 0; const docs = [{ devise: 'GBP', date: '2026-10-27', rate: 0.86 }, { devise: 'PLN', date: '2026-10-20', rate: 4.3 }, { devise: 'CHF', date: '2026-10-01', rate: 0.93 }];
    const col = { find: filtre => { lectures++; const sel = docs.filter(d => d.devise === filtre.devise && d.date <= filtre.date.$lte).sort((a, b) => (a.date < b.date ? 1 : -1)); return { sort: () => ({ limit: () => ({ next: async () => sel[0] || null }) }) }; } };
    let t = 0; const cache = T.creerCacheTaux({ ttlMs: 120000, maintenant: () => t });
    const direct = await T.versEUR('GBP', { maintenant, col });
    const nDirect = lectures;
    const a = await T.versEUR('GBP', { maintenant, col, cache }), b = await T.versEUR('gbp ', { maintenant, col, cache }), c = await T.versEUR('GBP', { maintenant, col, cache });
    v('cache : la valeur est celle de la lecture directe', [a, b, c], [direct, direct, direct]);
    v('cache : UNE lecture pour trois demandes (casse et espaces normalisés), contre une par demande avant', lectures - nDirect, 1);
    const rendu = await T.versEUR('GBP', { maintenant, col, cache }); rendu.versEUR = 999;
    v('cache : l\'objet rendu est une copie (le modifier ne corrompt pas le cache)', (await T.versEUR('GBP', { maintenant, col, cache })).versEUR, direct.versEUR);
    t = 119999; const l1 = lectures; await T.versEUR('GBP', { maintenant, col, cache });
    v('cache : encore valable à 119,999 s', lectures - l1, 0);
    t = 120000; await T.versEUR('GBP', { maintenant, col, cache });
    v('cache : expiré à 120 s (relecture)', lectures - l1, 1);
    const l2 = lectures; await T.versEUR('GBP', { maintenant: new Date('2026-10-28T10:00:00Z'), col, cache });
    v('cache : un autre JOUR de Paris est une autre clé (relecture)', lectures - l2, 1);
    // un taux de plus de 7 jours et une devise inconnue : le même verdict qu'avant, gardés aussi (ce sont des réponses)
    v('cache : taux trop vieux -> versEUR null, comme avant', [await T.versEUR('CHF', { maintenant, col, cache }), await T.versEUR('CHF', { maintenant, col })], [{ versEUR: null, tauxDate: null }, { versEUR: null, tauxDate: null }]);
    const l3 = lectures; await T.versEUR('JPY', { maintenant, col, cache }); await T.versEUR('JPY', { maintenant, col, cache });
    v('cache : une devise sans taux est gardée aussi (une lecture pour deux demandes)', lectures - l3, 1);
    // EUR : jamais de lecture, jamais de cache
    const l4 = lectures; const eur = await T.versEUR('EUR', { maintenant, col, cache });
    v('EUR : 1, sans lecture', [eur, lectures - l4], [{ versEUR: 1, tauxDate: null }, 0]);

    // ── 3. une panne n'est JAMAIS gardée
    let panne = true; const colPanne = { find: () => { lectures++; return { sort: () => ({ limit: () => ({ next: async () => { if (panne) throw new Error('coupure'); return docs[0]; } }) }) }; } };
    const cachePanne = T.creerCacheTaux({ ttlMs: 120000, maintenant: () => t }), muet = { journal: () => { } };
    const p1 = await T.versEUR('GBP', { maintenant, col: colPanne, cache: cachePanne, ...muet }); panne = false;
    const p2 = await T.versEUR('GBP', { maintenant, col: colPanne, cache: cachePanne, ...muet });
    v('panne : null à la première demande, puis la valeur dès que la base répond (la panne n\'a pas été gardée)', [p1, p2.versEUR], [{ versEUR: null, tauxDate: null }, direct.versEUR]);

    // ── 4. l'écriture des taux VIDE le cache (le seul moment où la valeur d'un jour peut changer)
    const cacheE = T.creerCacheTaux({ ttlMs: 120000, maintenant: () => t });
    const stock = []; const colEcr = { find: col.find, insertOne: async () => ({}), updateOne: async (f, u) => { stock.push(f); return { modifiedCount: 1 }; } };
    await T.versEUR('GBP', { maintenant, col, cache: cacheE });
    const lE = lectures; await T.versEUR('GBP', { maintenant, col, cache: cacheE });
    v('invalidation : avant l\'écriture, servi du cache', lectures - lE, 0);
    const xml = '<Cube time="2026-10-27"><Cube currency="GBP" rate="0.87"/></Cube>';
    await T.amorcerTaux({ fetch: async () => ({ ok: true, text: async () => xml }), maintenant: new Date('2026-10-30T10:00:00Z'), col: { find: () => ({ sort: () => ({ limit: () => ({ next: async () => null }) }) }), updateOne: colEcr.updateOne }, journal: () => { }, cache: cacheE });
    const lF = lectures; await T.versEUR('GBP', { maintenant, col, cache: cacheE });
    v('invalidation : après l\'écriture des taux (amorcerTaux), la demande suivante RELIT', [stock.length > 0, lectures - lF], [true, 1]);

    // ── 5. le chemin par défaut : SANS `cache` explicite, la lecture directe d'avant (les bancs qui écrivent dans `taux` à la main entre deux lectures gardent leur comportement)
    const l5 = lectures; await T.versEUR('GBP', { maintenant, col }); await T.versEUR('GBP', { maintenant, col });
    v('sans `cache` : une lecture par demande, comme avant', lectures - l5, 2);
    T.oublierTaux(); const l6 = lectures;
    await T.regleVerdict('GBP', { maintenant, col, cache: T.cacheDuModule }); await T.regleVerdict('GBP', { maintenant, col, cache: T.cacheDuModule });
    v('le cache du module (celui de la route) garde aussi : une lecture pour deux demandes ; oublierTaux() le vide', [lectures - l6, (T.oublierTaux(), await (async () => { const l = lectures; await T.regleVerdict('GBP', { maintenant, col, cache: T.cacheDuModule }); return lectures - l; })())], [1, 1]);
    // ── 5 bis. la COURSE : une lecture commencée AVANT l'écriture des taux ne doit pas poser, APRÈS elle, l'ancienne valeur
    const cacheC = T.creerCacheTaux({ ttlMs: 120000, maintenant: () => t });
    let liberer; const portail = new Promise(r => { liberer = r; });
    const colLente = { find: () => { lectures++; return { sort: () => ({ limit: () => ({ next: async () => { await portail; return { devise: 'GBP', date: jour, rate: 0.86 }; } }) }) }; } };
    const lente = T.versEUR('GBP', { maintenant, col: colLente, cache: cacheC });
    cacheC.oublier();                       // l'écriture des taux passe PENDANT la lecture
    liberer(); await lente;
    const lC = lectures; await T.versEUR('GBP', { maintenant, col, cache: cacheC });
    v('course : la lecture commencée avant l\'oubli ne pose rien — la demande suivante RELIT', lectures - lC, 1);
    // ── 6. bornes
    const petit = T.creerCacheTaux({ ttlMs: 1000, maintenant: () => 0, max: 2 });
    petit.poser('a', 1); petit.poser('b', 2); petit.poser('c', 3);
    v('borne : au plus `max` entrées (la plus ancienne part)', [petit.lire('a'), petit.lire('b'), petit.lire('c')], [undefined, 2, 3]);
    console.log(`\n${ok} réussis, ${ko} échoués`); process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error('❌', e); process.exit(1); });
