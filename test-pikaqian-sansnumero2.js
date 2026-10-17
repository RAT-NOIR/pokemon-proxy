// node test-pikaqian-sansnumero2.js — LOT PQ-SANSNUM2 (2026-10-17) : la garde « sans numéro » lit les ancres COMME LE DIAGNOSTIC les a lues.
// 🔑 DEMANDE DU TESTEUR (2026-10-17), mot pour mot : « Garde « sans numéro » PikaQian : promo-sv-p est refusée alors que 701 tuiles + 57 cartes au code « sv-p » sans numéro = 758 annoncées. Elles sont
// classées « 0 sans numéro » : une ancre portant le code du set et aucun numéro EST une carte sans numéro (listée, jamais importée). Banc sur une copie anonymisée du diagnostic réel. Rouge puis vert. »
// Le jeu (bancs/pikaqian/promo-sv-p-14-10--diagnostic.json) est une copie du vrai diagnostic du 14/10 sans sha256, horodatage réel ni chemin du poste. Le HTML réel n'est pas archivé : on fabrique
// PLUSIEURS formes plausibles dont `decrireAncresSansTuile` rend EXACTEMENT ce diagnostic, et la garde doit compter les 57 dans chacune (la sonde et la garde ne peuvent plus diverger).
// PK_MODULE / PK_RECEPTEUR : un pikaqian.js ou un récepteur MUTANT à tester à la place du vrai.
const fs = require('fs');
const path = require('path');
const P = require(process.env.PK_MODULE ? path.resolve(process.env.PK_MODULE) : './collecte-cartes/pikaqian');
const R = require(process.env.PK_RECEPTEUR ? path.resolve(process.env.PK_RECEPTEUR) : './recepteur-pikaqian');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const DIAG = JSON.parse(fs.readFileSync(path.join(__dirname, 'bancs', 'pikaqian', 'promo-sv-p-14-10--diagnostic.json'), 'utf8'));
const REEL = DIAG.diagnostic.ancresSansTuile;
const NOMS = REEL.exemples.map(e => e.h2);
const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DOSSIER = 'https://images.pikaqian.com/promo-sv-p';
const tuile = n => ({ id: UUID(n), nom: `Carte ${n}`, code: 'sv-p', numero: String(n).padStart(3, '0'), img: `${DOSSIER}/${UUID(n)}.webp` });
const tuileHtml = t => `<a class="w-full group" data-discover="true" href="/cards/${t.id}"><div class="x"><img alt="${t.nom}" src="${t.img}" loading="lazy"/></div><h2 class="t">${t.nom}</h2><p class="font-mono text-xs">${t.code}<!-- --> · ${t.numero}</p></a>`;
const ancre = (id, nom, interieur) => `<a class="w-full group" data-discover="true" href="/cards/${id}">${interieur(id, nom)}</a>`;
const nomDe = k => NOMS[k] ?? `Carte sans numéro ${k}`;
// Les formes plausibles du HTML réel inconnu : toutes donnent, au diagnostic, h2 non vide + p « sv-p » + img du dossier promo-sv-p + aucune référence « code · numéro »
const FORMES = {
    'forme de base (un h2, une img, un p)': (id, nom) => `<div class="x"><img alt="${nom}" src="${DOSSIER}/${id}.webp" loading="lazy"/></div><h2 class="t">${nom}</h2><p class="font-mono text-xs">sv-p</p>`,
    '<p> entouré d\'espaces et de retours à la ligne': (id, nom) => `<div class="x"><img alt="${nom}" src="${DOSSIER}/${id}.webp"/></div><h2>${nom}</h2><p class="font-mono text-xs">\n    sv-p  \n  </p>`,
    'un second <p> (un prix) après le code': (id, nom) => `<div class="x"><img alt="${nom}" src="${DOSSIER}/${id}.webp"/></div><h2>${nom}</h2><p>sv-p</p><p class="price">$ 12.50</p>`,
    'une <img> dont l\'identifiant diffère de celui du lien': (id, nom) => `<div class="x"><img alt="${nom}" src="${DOSSIER}/${UUID(999000 + Number(id.slice(-6)))}.webp"/></div><h2>${nom}</h2><p>sv-p</p>`,
    'deux <img> (la carte et une icône de foil)': (id, nom) => `<div class="x"><img alt="${nom}" src="${DOSSIER}/${id}.webp"/><img alt="foil" src="${DOSSIER}/${UUID(998000)}.webp"/></div><h2>${nom}</h2><p>sv-p</p>`,
    'tout à la fois (espaces, second <p>, autre identifiant, deux <img>)': (id, nom) => `<div><img src="${DOSSIER}/${UUID(997000)}.webp"/><img src="${DOSSIER}/${id}.webp"/></div><h2>${nom}</h2><p>\n sv-p\n</p><p>$ 3</p>`
};
// Une forme dont l'adresse de l'image porte un paramètre : le dossier n'est plus lisible au diagnostic (null), donc elle ne peut pas être la forme réelle (dossier « promo-sv-p » lu) — la garde la compte quand même
const FORME_PARAMETRE = (id, nom) => `<div class="x"><img alt="${nom}" src="${DOSSIER}/${id}.webp?width=300"/></div><h2>${nom}</h2><p>sv-p</p>`;
const ancresSN = (forme, n = 57) => Array.from({ length: n }, (_, k) => ancre(UUID(200000 + k), nomDe(k), forme));
const page = (nTuiles, ancres, totalTexte) => `<!DOCTYPE html><html><head><title>${DIAG.diagnostic.title}</title></head><body><h1>${DIAG.diagnostic.h1}</h1>${totalTexte === null ? '' : `<p>High to Low ${totalTexte ?? `${nTuiles + ancres.length} of ${nTuiles + ancres.length}`} cards</p>`}${Array.from({ length: nTuiles }, (_, i) => tuileHtml(tuile(i + 1))).join('')}${ancres.join('')}</body></html>`;
const juger = html => R.jugerPage(JSON.stringify({ url: `https://pikaqian.com/sets/${DIAG.code}`, html }));
const appel = (nom, ...args) => (typeof P[nom] === 'function' ? P[nom](...args) : undefined);

// ── 1. LES FORMES : le diagnostic rend EXACTEMENT celui du 14/10, la garde compte les 57, la page est acceptée ────────────────────────
for (const [nom, forme] of Object.entries(FORMES)) {
    const html = page(701, ancresSN(forme), undefined);
    const d = appel('decrireAncresSansTuile', html);
    verifier(`[${nom}] la sonde rend EXACTEMENT le diagnostic du 14/10 (n 57, compteurs, 5 exemples)`, d, REEL);
    verifier(`[${nom}] ancresSansNumero → 57 entrées { nom, lien } dans l'ordre`, [(appel('ancresSansNumero', html, 'promo-sv-p') ?? []).length, (appel('ancresSansNumero', html, 'promo-sv-p') ?? [])[0], (appel('ancresSansNumero', html, 'promo-sv-p') ?? [])[56]?.lien], [57, { nom: NOMS[0], lien: `/cards/${UUID(200000)}` }, `/cards/${UUID(200056)}`]);
    const j = juger(html);
    verifier(`[${nom}] jugerPage accepte « 758 of 758 cards » : 200, 758 ancres, 701 tuiles, 57 sans numéro, total 758`, [j.statut, j.corps.ok, j.corps.ancres, j.corps.tuilesLues, j.corps.sansNumero, j.corps.totalAnnonce ?? j.fiche?.totalAnnonce], [200, true, 758, 701, 57, 758]);
    verifier(`[${nom}] … aucune ancre sans numéro n'est une tuile de la fiche (jamais importée)`, [j.fiche?.tuiles?.length, (j.fiche?.sansNumero ?? []).filter(s => j.fiche.tuiles.some(t => `/cards/${t.id}` === s.lien)).length], [701, 0]);
}
{
    const html = page(701, ancresSN(FORME_PARAMETRE), undefined);
    const d = appel('decrireAncresSansTuile', html);
    verifier('[adresse d\'image à paramètre] la garde compte les 57 et la page est acceptée (la sonde y rend dossier null : ce n\'est pas la forme réelle)', [d.n, d.sansRef, (appel('ancresSansNumero', html, 'promo-sv-p') ?? []).length, juger(html).statut, juger(html).corps.sansNumero], [57, 57, 57, 200, 57]);
}

// ── 2. LA PROPRIÉTÉ : la garde compte toute ancre que la sonde décrit « h2 non vide, p = code, sans référence » ───────────────────────────
// Une ancre à la fois, dans des corps de toutes sortes ; la sonde (exemples[0], sansRef) et la garde doivent dire la même chose.
const CORPS = {};
for (const [nom, forme] of Object.entries(FORMES)) CORPS[nom] = forme;
Object.assign(CORPS, {
    'adresse à paramètre': FORME_PARAMETRE,
    'sans image': (id, nom) => `<h2>${nom}</h2><p>sv-p</p>`,
    'image sans src': (id, nom) => `<img alt="${nom}"/><h2>${nom}</h2><p>sv-p</p>`,
    'image d\'un autre dossier': (id, nom) => `<img src="https://images.pikaqian.com/promo-s-p/${id}.webp"/><h2>${nom}</h2><p>sv-p</p>`,
    'deux <h2> (le premier est le nom)': (id, nom) => `<img src="${DOSSIER}/${id}.webp"/><h2>${nom}</h2><h2>autre</h2><p>sv-p</p>`,
    'p d\'un autre code': (id, nom) => `<img src="${DOSSIER}/${id}.webp"/><h2>${nom}</h2><p>s-p</p>`,
    'p au code complet de l\'adresse': (id, nom) => `<img src="${DOSSIER}/${id}.webp"/><h2>${nom}</h2><p>promo-sv-p</p>`,
    'p « sv-p rare »': (id, nom) => `<img src="${DOSSIER}/${id}.webp"/><h2>${nom}</h2><p>sv-p rare</p>`,
    'p « sv-p · » sans numéro': (id, nom) => `<img src="${DOSSIER}/${id}.webp"/><h2>${nom}</h2><p>sv-p<!-- --> · </p>`,
    'p « sv-p · 012 » (numéro) sans image (pas une tuile)': (id, nom) => `<h2>${nom}</h2><p>sv-p<!-- --> · 012</p>`,
    'h2 vide': (id, nom) => `<img src="${DOSSIER}/${id}.webp"/><h2>   </h2><p>sv-p</p>`,
    'sans h2': (id, nom) => `<img src="${DOSSIER}/${id}.webp"/><p>sv-p</p>`,
    'sans p': (id, nom) => `<img src="${DOSSIER}/${id}.webp"/><h2>${nom}</h2>`,
    'ancre vide': () => ''
});
for (const [nom, forme] of Object.entries(CORPS)) {
    const html = page(2, [ancre(UUID(300001), 'Probe', forme)], null);
    const d = appel('decrireAncresSansTuile', html), e = d?.exemples?.[0];
    const sondeDit = !!d && d.n === 1 && e.h2 != null && e.p === 'sv-p' && d.sansRef === 1;
    verifier(`propriété — ${nom} : la garde compte l'ancre ⇔ la sonde la décrit (h2 non vide, p = sv-p, sans référence) [sonde : ${sondeDit}]`, (appel('ancresSansNumero', html, 'promo-sv-p') ?? ['?']).length === 1, sondeDit);
}

// ── 2 bis. TOUR 1 : une ancre dont un SECOND <p> porte une référence « code · numéro » COMPLÈTE a un numéro : elle n'est jamais « sans numéro » ───────────────────────────
{
    const ref2 = (img) => (id, nom) => `${img ? `<img src="${DOSSIER}/${id}.webp"/>` : ''}<h2>${nom}</h2><p>sv-p</p><p>sv-p<!-- --> · 3</p>`;
    const sansImg = page(701, [...ancresSN(FORMES['forme de base (un h2, une img, un p)'], 56), ancre(UUID(300001), 'N', ref2(false))], undefined);
    verifier('TOUR 1 — second <p> « sv-p · 3 » SANS image : non comptée (la sonde la range hors « sans code · numéro »), la page est refusée à 56 sans numéro', [(appel('ancresSansNumero', sansImg, 'promo-sv-p') ?? ['?']).length, appel('decrireAncresSansTuile', sansImg)?.sansRef, juger(sansImg).statut, juger(sansImg).corps.sansNumero], [56, 56, 422, 56]);
    const avecImg = page(701, [...ancresSN(FORMES['forme de base (un h2, une img, un p)'], 56), ancre(UUID(300001), 'N', ref2(true))], undefined);
    verifier('TOUR 1 — la même ancre AVEC image : c\'est une tuile (lue), jamais comptée sans numéro', [(appel('ancresSansNumero', avecImg, 'promo-sv-p') ?? ['?']).length, juger(avecImg).corps.tuilesLues], [56, 702]);
    const point = page(701, [...ancresSN(FORMES['forme de base (un h2, une img, un p)'], 56), ancre(UUID(300001), 'N', (id, nom) => `<h2>${nom}</h2><p>sv-p</p><p> · </p>`)], undefined);
    verifier('TOUR 1 — second <p> « · » SANS numéro complet : la référence n\'est pas complète, l\'ancre reste comptée sans numéro (57, page acceptée)', [(appel('ancresSansNumero', point, 'promo-sv-p') ?? ['?']).length, appel('decrireAncresSansTuile', point)?.sansRef, juger(point).statut], [57, 57, 200]);
}

// ── 3. CE QUI DOIT TOUJOURS TOMBER ────────────────────────────────────────────────────────────────────────────────────────────────────────
const base = ancresSN(FORMES['forme de base (un h2, une img, un p)'], 56);
const mauvaise = nom => CORPS[nom];
const refuse = (nom, html, motif) => {
    const r = juger(html);
    verifier(nom, [r.statut, r.corps.motif], [422, motif]);
};
refuse('NON — 56 valides + une ancre au p d\'un AUTRE code (s-p) → 422, 56 sans numéro', page(701, [...base, ancre(UUID(300001), 'X', mauvaise('p d\'un autre code'))], undefined), 'page partielle ou forme changée : 758 ancres, 701 tuiles, 56 sans numéro');
refuse('NON — 56 valides + une ancre au h2 vide → 422', page(701, [...base, ancre(UUID(300001), 'X', mauvaise('h2 vide'))], undefined), 'page partielle ou forme changée : 758 ancres, 701 tuiles, 56 sans numéro');
refuse('NON — 56 valides + une ancre « sv-p · 012 » sans image (pas une tuile) → 422', page(701, [...base, ancre(UUID(300001), 'X', mauvaise('p « sv-p · 012 » (numéro) sans image (pas une tuile)'))], undefined), 'page partielle ou forme changée : 758 ancres, 701 tuiles, 56 sans numéro');
const toutes = ancresSN(FORMES['forme de base (un h2, une img, un p)']);
refuse('NON — les 57 sous « 800 of 800 cards » → 422 (total ≠ tuiles + sans numéro)', page(701, toutes, '800 of 800'), 'total annoncé 800 ≠ 701 tuiles + 57 sans numéro');
refuse('NON — les 57 sans aucun total → 422 (obligatoire)', page(701, toutes, null), 'total annoncé absent : obligatoire quand la page porte des cartes sans numéro');
refuse('NON — les 57 sous « 701 of 758 cards » (vue filtrée) → 422', page(701, toutes, '701 of 758'), 'vue filtrée : 701 of 758 cards');
verifier('une « sv-p · 012 » AVEC image est une TUILE : la page à 702 tuiles + 57 sans numéro est acceptée, 57 comptées', (r => [r.statut, r.corps.tuilesLues, r.corps.sansNumero])(juger(page(701, [...toutes, tuileHtml(tuile(702))], '759 of 759'))), [200, 702, 57]);

console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
process.exit(ko ? 1 : 0);
