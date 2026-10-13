'use strict';
// Banc B1a.2 — la question qui sépare 2 ou 3 candidats (CONTRAT-2 §3.3). Module PUR.
const { v, vrai, bilan } = require('./_harnais');
const { construireProduit } = require('../identifier/produit');
const { construireQuestion, verifierBijection, CODES_QUESTION } = require('../identifier/questions');

const HOTE = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/';
let compteur = 1000;
const prod = (o = {}) => {
    const id = o.idProduct ?? ++compteur;
    const set = o.set || { slug: 'set-' + id, nom: 'Set ' + id };
    return construireProduit({ idProduct: id, nomCardmarket: o.nomCardmarket ?? 'Eevee', set, numero: o.numero === undefined ? '12' : o.numero,
        total: o.total === undefined ? '100' : o.total, langue: o.langue === undefined ? 'EN' : o.langue, variante: o.variante === undefined ? null : o.variante,
        rarete: 'Rare', visuel: o.visuel === undefined ? { url: `${HOTE}${id}.webp`, w: 255, h: 356 } : o.visuel }, { langueInterface: 'fr' });
};
const Q = (c, l = 'fr') => construireQuestion(c, { langueInterface: l });
const leve = f => { try { f(); return false; } catch { return true; } };
const toutesPhrases = q => [q.texte, q.aide, ...q.choix.map(c => c.libelle)].filter(Boolean);
v('liste fermée des codes', [...CODES_QUESTION], ['reverse', 'symbole', 'numero', 'langue', 'premiere-edition', 'visuel', 'confirmation']);

// (1) reverse / normale
{
    const a = prod({ variante: 'reverse' }), b = prod({ variante: 'normale' });
    const q = Q([a, b]);
    v('reverse : code', q.code, 'reverse');
    v('reverse : 2 choix', q.choix.length, 2);
    vrai('reverse : bijection', verifierBijection(q, [a, b]));
    const choixA = q.choix.find(c => c.idProduct === a.idProduct), choixB = q.choix.find(c => c.idProduct === b.idProduct);
    v('reverse : libellé du reverse', choixA.libelle, 'Reflet sur toute la carte (reverse)');
    v('reverse : libellé de l\'autre', choixB.libelle, 'Sans reflet sur la carte');
    v('reverse : forme { code, texte, aide, zone, choix }', Object.keys(q), ['code', 'texte', 'aide', 'zone', 'choix']);
    v('reverse : forme d\'un choix', Object.keys(q.choix[0]), ['id', 'libelle', 'idProduct']);
    v('reverse : zone null', q.zone, null);
    const q2 = Q([prod({ variante: 'reverse' }), prod({ variante: 'holo' })]);
    v('reverse/holo -> reverse', q2.code, 'reverse');
}
// (2) symbole
{
    const cs = [prod({ set: { slug: 's1', nom: 'Expansion Sheet' } }), prod({ set: { slug: 's2', nom: 'Pokémon Jungle' } }), prod({ set: { slug: 's3', nom: 'Rocket Gang' } })];
    const q = Q(cs);
    v('symbole : code', q.code, 'symbole');
    vrai('symbole : bijection', verifierBijection(q, cs));
    v('symbole : libellés = noms de sets', q.choix.map(c => c.libelle).sort(), ['Expansion Sheet', 'Pokémon Jungle', 'Rocket Gang']);
    v('symbole : ids a b c', q.choix.map(c => c.id), ['a', 'b', 'c']);
    vrai('symbole : choix triés par idProduct (choixPour)', q.choix.every((c, i, t) => !i || t[i - 1].idProduct < c.idProduct));
    const z = q.zone;
    v('symbole : zone gardée (255 px × 0,30 = 76 px)', z, { x: 0.02, y: 0.84, w: 0.30, h: 0.14 });
}
// symbole refusé : numéro inconnu / noms différents / mêmes noms de set
{
    const sansNumero = [prod({ numero: null, set: { slug: 'a', nom: 'A' } }), prod({ numero: null, set: { slug: 'b', nom: 'B' } })];
    v('numéro inconnu -> pas symbole (visuel)', Q(sansNumero).code, 'visuel');
    const nomsDiff = [prod({ nomCardmarket: 'Eevee', set: { slug: 'a', nom: 'A' } }), prod({ nomCardmarket: 'Vaporeon', set: { slug: 'b', nom: 'B' } })];
    v('noms différents, même numéro -> pas symbole', Q(nomsDiff).code === 'symbole', false);
    const memeNomSet = [prod({ set: { slug: 'a', nom: 'Même nom' } }), prod({ set: { slug: 'b', nom: 'Même nom' } })];
    v('deux sets au même nom affiché -> pas symbole (libellés indiscernables)', Q(memeNomSet).code, 'visuel');
    const memeSlug = [prod({ set: { slug: 'a', nom: 'A' } }), prod({ set: { slug: 'a', nom: 'A' } })];
    v('même set -> pas symbole', Q(memeSlug).code, 'visuel');
}
// (3) numéro
{
    const cs = [prod({ numero: '4', total: '102', set: { slug: 'x', nom: 'X' } }), prod({ numero: '12', total: '102', set: { slug: 'x', nom: 'X' } })];
    const q = Q(cs);
    v('numéro : code', q.code, 'numero');
    vrai('numéro : bijection', verifierBijection(q, cs));
    v('numéro : libellés', q.choix.map(c => c.libelle).sort(), ['n° 12/102', 'n° 4/102']);
    v('numéro : zone gardée', q.zone, { x: 0.02, y: 0.90, w: 0.40, h: 0.08 });
    const sansTotal = Q([prod({ numero: '4', total: null, set: { slug: 'x', nom: 'X' } }), prod({ numero: '5', total: null, set: { slug: 'x', nom: 'X' } })]);
    v('numéro sans total : « n° 4 »', sansTotal.choix.map(c => c.libelle).sort(), ['n° 4', 'n° 5']);
    v('numéro en anglais', Q(cs, 'en').choix.map(c => c.libelle).sort(), ['No. 12/102', 'No. 4/102']);
    const numeroInconnu = [prod({ numero: '4', set: { slug: 'x', nom: 'X' } }), prod({ numero: null, set: { slug: 'x', nom: 'X' } })];
    v('un numéro inconnu -> pas numéro', Q(numeroInconnu).code, 'visuel');
}
// (4) langue
{
    const cs = [prod({ langue: 'EN', numero: '5', set: { slug: 'x', nom: 'X' } }), prod({ langue: 'FR', numero: '5', set: { slug: 'x', nom: 'X' } }), prod({ langue: 'JP', numero: '5', set: { slug: 'x', nom: 'X' } })];
    const q = Q(cs);
    v('langue : code', q.code, 'langue');
    vrai('langue : bijection', verifierBijection(q, cs));
    v('langue : en toutes lettres (fr)', q.choix.map(c => c.libelle).sort(), ['Anglais', 'Français', 'Japonais']);
    v('langue : en toutes lettres (en)', Q(cs, 'en').choix.map(c => c.libelle).sort(), ['English', 'French', 'Japanese']);
    v('langue : zone null', q.zone, null);
    const inconnue = [prod({ langue: 'EN', numero: '5', set: { slug: 'x', nom: 'X' } }), prod({ langue: 'XX', numero: '5', set: { slug: 'x', nom: 'X' } })];
    v('langue inconnue de la table -> pas langue', Q(inconnue).code, 'visuel');
}
// (5) ordre fermé : variante ET numéro distincts -> reverse
{
    const cs = [prod({ variante: 'reverse', numero: '4', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'normale', numero: '5', set: { slug: 'x', nom: 'X' } })];
    v('ordre fermé : reverse passe avant numero', Q(cs).code, 'reverse');
    const cs2 = [prod({ variante: 'reverse', numero: '4', langue: 'EN', set: { slug: 'a', nom: 'A' } }), prod({ variante: 'normale', numero: '4', langue: 'FR', set: { slug: 'b', nom: 'B' } })];
    v('ordre fermé : reverse passe avant symbole et langue', Q(cs2).code, 'reverse');
}
// première édition
{
    const cs = [prod({ variante: 'premiere-edition', numero: '4', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'holo', numero: '4', set: { slug: 'x', nom: 'X' } })];
    const q = Q(cs);
    v('première édition : code', q.code, 'premiere-edition');
    vrai('première édition : bijection', verifierBijection(q, cs));
    v('première édition : libellé tampon', q.choix.find(c => c.idProduct === cs[0].idProduct).libelle, 'Avec le tampon « Edition 1 »');
    v('première édition : libellé sans', q.choix.find(c => c.idProduct === cs[1].idProduct).libelle, 'Sans le tampon');
    v('première édition : zone gardée', q.zone, { x: 0.05, y: 0.44, w: 0.25, h: 0.10 });
}
// (6) rien ne sépare -> visuel
{
    const cs = [prod({ set: { slug: 'x', nom: 'X' } }), prod({ set: { slug: 'x', nom: 'X' } })];
    const q = Q(cs);
    v('rien ne sépare : visuel', q.code, 'visuel');
    vrai('visuel : bijection', verifierBijection(q, cs));
    v('visuel : « Carte A/B » + le set', q.choix.map(c => c.libelle), ['Carte A — X', 'Carte B — X']);
    v('visuel : zone null', q.zone, null);
    const trois = [prod({ set: { slug: 'x', nom: 'X' } }), prod({ set: { slug: 'x', nom: 'X' } }), prod({ set: { slug: 'x', nom: 'X' } })];
    v('visuel à 3 : A B C', Q(trois).choix.map(c => c.libelle), ['Carte A — X', 'Carte B — X', 'Carte C — X']);
}
// (7) variante inconnue : ni reverse ni première édition
{
    const cs = [prod({ variante: null, numero: '4', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'reverse', numero: '4', set: { slug: 'x', nom: 'X' } })];
    const q = Q(cs);
    vrai('variante inconnue : pas reverse (on ne devine pas)', q.code !== 'reverse');
    const pe = [prod({ variante: null, numero: '4', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'premiere-edition', numero: '4', set: { slug: 'x', nom: 'X' } })];
    vrai('variante inconnue : pas première édition', Q(pe).code !== 'premiere-edition');
    v('variantes égales -> pas reverse', Q([prod({ variante: 'reverse', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'reverse', set: { slug: 'x', nom: 'X' } })]).code, 'visuel');
    v('reverse sans reverse (normale/holo) -> pas reverse', Q([prod({ variante: 'normale', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'holo', set: { slug: 'x', nom: 'X' } })]).code, 'visuel');
    v('tampon/reverse hors du sous-ensemble -> pas reverse', Q([prod({ variante: 'reverse', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'tampon', set: { slug: 'x', nom: 'X' } })]).code, 'visuel');
    // trois variantes : deux libellés ne peuvent pas désigner trois candidats
    const tro = [prod({ variante: 'reverse', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'normale', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'holo', set: { slug: 'x', nom: 'X' } })];
    const qt = Q(tro);
    vrai('3 candidats reverse/normale/holo : jamais deux libellés pour trois', qt.code !== 'reverse' && verifierBijection(qt, tro));
}
// (8) 1 ou 4 candidats lèvent
vrai('0 candidat -> lève', leve(() => Q([])));
v('1 candidat -> la question de confirmation (UN-CANDIDAT, D1) : code, un choix', (q => [q.code, q.choix.length])(Q([prod()])), ['confirmation', 1]);
vrai('4 candidats -> lève', leve(() => Q([prod(), prod(), prod(), prod()])));
vrai('0 candidat -> lève', leve(() => Q([])));
vrai('non-tableau -> lève', leve(() => Q(null)));
vrai('doublon d\'idProduct -> lève', leve(() => { const a = prod(); Q([a, a]); }));
// (9) zone ≥ 25 px
{
    const grands = [prod({ set: { slug: 'a', nom: 'A' } }), prod({ set: { slug: 'b', nom: 'B' } })];
    v('zone gardée à 255 px (76 px)', Q(grands).zone !== null, true);
    const petit = { w: 60, h: 84 };
    const petits = [0, 1].map(i => prod({ set: { slug: 's' + i, nom: 'S' + i }, visuel: { url: `${HOTE}p${i}.webp`, ...petit } }));
    v('visuels de 60 px (18 px) -> zone null', Q(petits).zone, null);
    const mixte = [prod({ set: { slug: 'a', nom: 'A' } }), prod({ set: { slug: 'b', nom: 'B' }, visuel: null })];
    v('un candidat sans visuel -> zone null', Q(mixte).zone, null);
    const unPetit = [prod({ set: { slug: 'a', nom: 'A' } }), prod({ set: { slug: 'b', nom: 'B' }, visuel: { url: `${HOTE}q.webp`, w: 60, h: 84 } })];
    v('un seul visuel trop petit suffit -> zone null', Q(unPetit).zone, null);
    // frontière : w 0,30 × 84 px = 25,2 px -> gardée ; × 83 = 24,9 -> null
    const f = w => [0, 1].map(i => prod({ set: { slug: 'f' + i, nom: 'F' + i }, visuel: { url: `${HOTE}f${i}.webp`, w, h: 400 } }));
    v('frontière : 84 px de large -> 25,2 px -> gardée', Q(f(84)).zone !== null, true);
    v('frontière : 83 px de large -> 24,9 px -> null', Q(f(83)).zone, null);
    // la hauteur compte aussi : symbole h 0,14 × 100 = 14 px < 25
    const bas = [0, 1].map(i => prod({ set: { slug: 'g' + i, nom: 'G' + i }, visuel: { url: `${HOTE}g${i}.webp`, w: 400, h: 100 } }));
    v('hauteur trop faible (14 px) -> zone null', Q(bas).zone, null);
}
// (10) langue des phrases + vouvoiement
{
    const exemples = () => {
        const s = [prod({ set: { slug: 'a', nom: 'A' } }), prod({ set: { slug: 'b', nom: 'B' } })];
        const n = [prod({ numero: '4', set: { slug: 'x', nom: 'X' } }), prod({ numero: '5', set: { slug: 'x', nom: 'X' } })];
        const l = [prod({ langue: 'EN', set: { slug: 'x', nom: 'X' } }), prod({ langue: 'FR', set: { slug: 'x', nom: 'X' } })];
        const r = [prod({ variante: 'reverse', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'normale', set: { slug: 'x', nom: 'X' } })];
        const p = [prod({ variante: 'premiere-edition', set: { slug: 'x', nom: 'X' } }), prod({ variante: 'holo', set: { slug: 'x', nom: 'X' } })];
        const vi = [prod({ set: { slug: 'x', nom: 'X' } }), prod({ set: { slug: 'x', nom: 'X' } })];
        return [s, n, l, r, p, vi];
    };
    const tous = new Set();
    for (const cs of exemples()) {
        const qfr = Q(cs, 'fr');
        tous.add(qfr.code);
        vrai(`fr/${qfr.code} : jamais « tu », « ton », « ta »`, toutesPhrases(qfr).every(t => !/\b(tu|ton|ta|tes|toi)\b/i.test(t)));
        vrai(`fr/${qfr.code} : jamais de prix ni de classement`, toutesPhrases(qfr).every(t => !/€|prix|meilleur|moins cher|plus cher|classement|score/i.test(t)));
        for (const l of ['en', 'de', undefined]) {
            const qe = construireQuestion(cs, { langueInterface: l });
            vrai(`${l}/${qe.code} : phrases anglaises (même texte que en)`, qe.texte === Q(cs, 'en').texte && qe.aide === Q(cs, 'en').aide);
            vrai(`${l}/${qe.code} : jamais de prix ni de classement`, toutesPhrases(qe).every(t => !/€|price|best|cheap|rank|score/i.test(t)));
        }
        vrai(`${qfr.code} : texte fr différent de en`, qfr.texte !== Q(cs, 'en').texte);
        vrai(`${qfr.code} : texte et aide non vides`, qfr.texte.length > 5 && typeof qfr.aide === 'string' && qfr.aide.length > 5);
    }
    v('les six codes ont été exercés', [...tous].sort(), ['langue', 'numero', 'premiere-edition', 'reverse', 'symbole', 'visuel']);
}
// verifierBijection SAIT dire non
{
    const cs = [prod({ set: { slug: 'a', nom: 'A' } }), prod({ set: { slug: 'b', nom: 'B' } })];
    const q = Q(cs);
    const faux = (m) => leve(() => verifierBijection(m, cs));
    vrai('bijection : choix dédoublé refusé', faux({ ...q, choix: [q.choix[0], { ...q.choix[1], idProduct: q.choix[0].idProduct }] }));
    vrai('bijection : choix manquant refusé', faux({ ...q, choix: [q.choix[0]] }));
    vrai('bijection : idProduct étranger refusé', faux({ ...q, choix: [q.choix[0], { ...q.choix[1], idProduct: 1 }] }));
    vrai('bijection : code hors liste refusé', faux({ ...q, code: 'prix' }));
    vrai('bijection : libellés identiques refusés', faux({ ...q, choix: q.choix.map(c => ({ ...c, libelle: 'pareil' })) }));
}

bilan();
