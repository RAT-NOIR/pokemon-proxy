// node test-moyen.js — banc du scan « moyen » (collecte-cartes/moyen.js), SANS R2 ni base de production : la règle pure (clé, seuil,
// proportion), la fabrication sur des images fabriquées par sharp, et assurerMoyens sur une base FICTIVE en mémoire + un R2 faux
// (injecté). Aucun dossier du testeur n'est cité. Demande du site : DEMANDE-CATALOGUE.md, « le scan MOYEN ».
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const M = require('./collecte-cartes/moyen');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const image = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 100, b: 50 } } }).webp().toBuffer();
const leve = async f => { try { await f(); return null; } catch (e) { return e.message; } };

// ── une base fictive : cartes + images, avec le sous-ensemble de MongoDB que moyen.js emploie (find itérable, updateOne + arrayFilters)
// L'ÉVALUATEUR DU FILTRE (relecture du scan moyen, M6) : le filtre `$elemMatch` que moyen.js envoie à Mongo est EXÉCUTÉ ici, avec la sémantique documentée des
// opérateurs qu'il emploie ($elemMatch, $or, $type, $exists, $gte, $lt, $ne, $in, égalité, null = absent ou null). Un opérateur hors de cette liste LÈVE : le faux ne devine pas.
function correspond(obj, cond) {
    for (const [k, c] of Object.entries(cond)) {
        if (k === '$or') { if (!c.some(s => correspond(obj, s))) return false; continue; }
        const v = obj?.[k];
        if (c && typeof c === 'object' && !Array.isArray(c)) {
            if ('$elemMatch' in c) { if (!Array.isArray(v) || !v.some(e => correspond(e, c.$elemMatch))) return false; continue; }
            for (const [op, x] of Object.entries(c)) {
                const bon = op === '$type' ? (x === 'string' ? typeof v === 'string' : (() => { throw new Error('$type non prévu'); })())
                    : op === '$exists' ? (v !== undefined) === x : op === '$gte' ? typeof v === 'number' && v >= x : op === '$lt' ? typeof v === 'number' && v < x
                    : op === '$ne' ? v !== x : op === '$in' ? x.includes(v) : (() => { throw new Error('opérateur de filtre non prévu par le faux : ' + op); })();
                if (!bon) return false;
            }
        } else if (c === null) { if (v !== null && v !== undefined) return false; } else if (v !== c) return false;
    }
    return true;
}
function baseFictive({ cartes, images }) {
    const evalCond = (v, c) => {
        if (c === null) return v === null || v === undefined;
        if (c && typeof c === 'object' && !Array.isArray(c)) {
            if ('$exists' in c) return (v !== undefined) === c.$exists;
            if ('$ne' in c) return v !== c.$ne;
            if ('$lt' in c) return typeof v === 'number' && v < c.$lt;
            throw new Error('condition de arrayFilters non prévue par le faux : ' + JSON.stringify(c));
        }
        return v === c;
    };
    const ecritures = [];
    const appliquer = (doc, u, arrayFilters) => {
        for (const op of ['$set', '$unset']) for (const [chemin, val] of Object.entries(u[op] || {})) {
            const m = /^images\.\$\[e\]\.(\w+)$/.exec(chemin);
            if (!m) { if (op === '$set') doc[chemin] = val; else delete doc[chemin]; continue; }
            const f = (arrayFilters || [])[0] || {};
            for (const e of doc.images) if (Object.entries(f).every(([k, c]) => evalCond(e[k.replace(/^e\./, '')], c))) { if (op === '$set') e[m[1]] = val; else delete e[m[1]]; }
        }
    };
    return {
        ecritures,
        collection: nom => nom === 'cartes' ? {
            find: filtre => ({ async *[Symbol.asyncIterator]() { for (const d of cartes) if (correspond(d, filtre)) yield d; } }),   // le filtre RÉEL est exécuté (correspond)
            updateOne: async (f, u, o) => { ecritures.push(['cartes', u]); appliquer(cartes.find(d => d._id === f._id), u, o && o.arrayFilters); return { modifiedCount: 1 }; }
        } : {
            // la PROJECTION est appliquée (comme Mongo : _id toujours, puis les seuls champs demandés) — un champ lu sans être projeté est `undefined`
            find: (q, o = {}) => ({ toArray: async () => images.filter(d => q.cleR2.$in.includes(d.cleR2)).map(d => o.projection ? Object.fromEntries(Object.entries(d).filter(([k]) => k === '_id' || o.projection[k])) : d) }),
            updateOne: async (f, u) => { ecritures.push(['images', u]); const d = images.find(x => f._id !== undefined ? x._id === f._id : x.cleR2 === f.cleR2); if (d) appliquer(d, u); return {}; }
        }
    };
}
function r2Faux(fichiers) {
    const r = { lectures: [], depots: [], verifie: 0, fichiers };
    r.verifierBucket = async () => { r.verifie++; };
    r.lireBinaire = async (b, cle) => { r.lectures.push(cle); if (!fichiers[cle]) throw new Error('absent ' + cle); return fichiers[cle]; };
    r.deposerBinaire = async (b, cle, buf, type, opt = {}) => { r.depots.push({ cle, type, ecraser: !!opt.ecraser }); return { ecrit: true, cle }; };
    return r;
}

(async () => {
    // ── la clé
    verifier('clé : sous « moyens/ », l\'extension remplacée par .webp, jamais la clé de l\'image ni celle d\'une vignette',
        [M.cleMoyen('tcgdex/Prismatic-Evolutions/153-323158.webp'), M.cleMoyen('bulbapedia/Arceus/89-41586.png')],
        ['moyens/tcgdex/Prismatic-Evolutions/153-323158.webp', 'moyens/bulbapedia/Arceus/89-41586.webp']);
    verifier('une clé de vignette en entrée LÈVE', /vignette/.test(await leve(async () => M.cleMoyen('vignettes/x.webp')) || ''), true);
    verifier('une clé de moyen en entrée LÈVE (on ne réduit pas un moyen)', /moyen/.test(await leve(async () => M.cleMoyen('moyens/x.webp')) || ''), true);
    verifier('une clé vide LÈVE', !!(await leve(async () => M.cleMoyen(''))), true);

    // ── la décision (le seuil et l'exclusion basseDefinition)
    const d = e => M.decisionMoyen(e).raison;
    verifier('seuil : 471 px admis, 470 refusé (400 ≤ 85 % de la largeur)', [d({ cleR2: 'a', w: 471 }), d({ cleR2: 'a', w: 470 })], ['ok', 'trop-petite']);
    verifier('basseDefinition : exclue, même à 700 px', d({ cleR2: 'a', w: 700, basseDefinition: true }), 'basse-definition');
    verifier('largeur inconnue : nommée (pas devinée) ; sans clé : nommée', [d({ cleR2: 'a' }), d({ w: 600 })], ['largeur-inconnue', 'sans-cle']);
    verifier('les constantes de la demande', [M.LARGEUR_MOYEN, M.LARGEUR_MIN_MOYEN, M.QUALITE_MOYEN], [400, 471, 80]);

    // ── la fabrication
    const f = await M.fabriquerMoyen(await image(600, 825));
    const meta = await sharp(f.buffer).metadata();
    verifier('600×825 → 400×550 en WebP, dimensions RELUES dans le fichier, proportion à 2 % près',
        [f.w, f.h, meta.width, meta.height, meta.format, Math.abs(f.w / f.h - 600 / 825) / (600 / 825) < 0.02], [400, 550, 400, 550, 'webp', true]);
    verifier('jamais agrandie : 471 px → 400 px (une réduction), jamais plus large que l\'original', (await M.fabriquerMoyen(await image(471, 648))).w, 400);
    verifier('une image de 470 px LÈVE (pas de moyen sous le seuil)', /471/.test(await leve(async () => M.fabriquerMoyen(await image(470, 646))) || ''), true);
    verifier('une image de 300 px LÈVE (pas d\'agrandissement)', !!(await leve(async () => M.fabriquerMoyen(await image(300, 420)))), true);
    verifier('un fichier illisible LÈVE', !!(await leve(async () => M.fabriquerMoyen(Buffer.from('pas une image')))), true);
    // proportion : un arrondi d'un pixel reste dans les 2 % ; la fonction pure refuse un écart de plus de 2 %
    verifier('proportion : 400×550 vs 600×825 admis ; 400×530 refusé', [M.proportionAdmise({ w: 600, h: 825 }, { w: 400, h: 550 }), M.proportionAdmise({ w: 600, h: 825 }, { w: 400, h: 530 })], [true, false]);
    verifier('le site ignore un moyen de plus de 85 % de la largeur : admis 500/600 refusé, 400/600 admis', [M.moyenAdmis({ w: 600, h: 825 }, { cleR2: 'moyens/a.webp', w: 510, h: 701 }), M.moyenAdmis({ w: 600, h: 825 }, { cleR2: 'moyens/a.webp', w: 400, h: 550 })], [false, true]);

    // ── assurerMoyens
    const O = await image(600, 825);
    const jeu = () => ({
        cartes: [{ _id: 1, images: [
            { set: 'Set-A', numero: '1', cleR2: 'a/1.webp', w: 600, h: 825 },
            { set: 'Set-A', numero: '2', cleR2: 'a/2.webp', w: 600, h: 825, basseDefinition: true },
            { set: 'Set-A', numero: '3', cleR2: 'a/3.webp', w: 400, h: 550 }] }],
        images: [{ cleR2: 'a/1.webp', sha256: 'AAA', w: 600 }, { cleR2: 'a/2.webp', sha256: 'BBB', w: 600 }, { cleR2: 'a/3.webp', sha256: 'CCC', w: 400 }]
    });
    {
        const J = jeu(), db = baseFictive(J), r2 = r2Faux({ 'a/1.webp': O });
        const B = await M.assurerMoyens(db, { bucket: 'b', r2, journal: { error() { } } });
        const e1 = J.cartes[0].images[0];
        verifier('fabrication : le dépôt est sous moyens/…webp ; l\'entrée porte {cleR2,w,h} et RIEN d\'autre ; la basseDefinition et les 400 px ne sont ni lues ni touchées',
            [r2.depots.map(x => [x.cle, x.type, x.ecraser]), e1.moyen, J.cartes[0].images[1].moyen, J.cartes[0].images[2].moyen, r2.lectures, B.fabriquees],
            [[['moyens/a/1.webp', 'image/webp', true]], { cleR2: 'moyens/a/1.webp', w: 400, h: 550 }, undefined, undefined, ['a/1.webp'], 1]);   // ecraser:true : un moyen est dérivé, un fichier sans provenance prouvée se refait
        verifier('le document `images` garde le moyen ET l\'empreinte de l\'original dont il vient (pour déceler un remplacement)', [J.images[0].moyen.cleR2, J.images[0].moyen.de], ['moyens/a/1.webp', 'AAA']);
        verifier('le bilan nomme le set touché (revalidation)', B.sets, ['Set-A']);
        const avant = JSON.stringify(J), nEcr = db.ecritures.length;
        const B2 = await M.assurerMoyens(db, { bucket: 'b', r2, journal: { error() { } } });
        verifier('idempotence : une seconde passe ne lit rien, ne dépose rien, n\'écrit rien, ne touche aucun set',
            [r2.lectures.length, r2.depots.length, db.ecritures.length - nEcr, JSON.stringify(J) === avant, B2.sets, B2.fabriquees], [1, 1, 0, true, [], 0]);
    }
    {   // simulation : rien n'est lu, rien n'est écrit, le plan est compté
        const J = jeu(), db = baseFictive(J), r2 = r2Faux({ 'a/1.webp': O });
        const B = await M.assurerMoyens(db, { bucket: 'b', r2, ecrire: false });
        verifier('simulation : 0 lecture R2, 0 écriture, 1 image à faire, le set nommé', [r2.lectures.length, r2.depots.length, db.ecritures.length, B.cles, B.sets, r2.verifie], [0, 0, 0, 1, ['Set-A'], 0]);
    }
    {   // recopie depuis le document : l'entrée réécrite par une jointure retrouve le moyen sans relire R2
        const J = jeu(); J.images[0].moyen = { cleR2: 'moyens/a/1.webp', w: 400, h: 550, de: 'AAA' };
        const db = baseFictive(J), r2 = r2Faux({});
        const B = await M.assurerMoyens(db, { bucket: 'b', r2, journal: { error() { } } });
        verifier('recopie : l\'entrée sans moyen reprend celui du document (sans `de`), 0 lecture R2, 0 dépôt, 1 depuisDocument',
            [J.cartes[0].images[0].moyen, r2.lectures.length, r2.depots.length, B.depuisDocument, B.fabriquees], [{ cleR2: 'moyens/a/1.webp', w: 400, h: 550 }, 0, 0, 1, 0]);
    }
    {   // remplacement sous la MÊME clé R2 : l'empreinte de l'original a changé -> le moyen est refait, en ÉCRASANT
        const J = jeu();
        J.cartes[0].images[0].moyen = { cleR2: 'moyens/a/1.webp', w: 400, h: 550 };
        Object.assign(J.cartes[0].images[0], { w: 700, h: 900 });   // l'entrée décrit le NOUVEAU original (sinon le site ignorerait le moyen refait)
        J.images[0].moyen = { cleR2: 'moyens/a/1.webp', w: 400, h: 550, de: 'ANCIEN' };   // l'original a maintenant l'empreinte 'AAA'
        const db = baseFictive(J), r2 = r2Faux({ 'a/1.webp': await image(700, 900) });
        const sans = await M.assurerMoyens(db, { bucket: 'b', r2, journal: { error() { } }, ecrire: false });
        verifier('sans --reverifier, une entrée qui a déjà un moyen n\'est pas relue (le coût du stock reste nul)', [sans.cles, r2.depots.length], [0, 0]);
        const B = await M.assurerMoyens(db, { bucket: 'b', r2, journal: { error() { } }, reverifier: true });
        verifier('remplacement sous même clé : le moyen est refait, déposé en ÉCRASANT, document et entrée remis à jour (400×514)',
            [r2.depots.map(x => [x.cle, x.ecraser]), J.cartes[0].images[0].moyen, J.images[0].moyen.de, B.refaites], [[['moyens/a/1.webp', true]], { cleR2: 'moyens/a/1.webp', w: 400, h: 514 }, 'AAA', 1]);
    }
    {   // une image devenue basseDefinition (ou sous le seuil) perd son moyen : le site garde son scan tel quel
        const J = jeu();
        J.cartes[0].images[1].moyen = { cleR2: 'moyens/a/2.webp', w: 400, h: 550 };
        const db = baseFictive(J), r2 = r2Faux({});
        const B = await M.assurerMoyens(db, { bucket: 'b', r2, journal: { error() { } }, parallele: 1 });
        verifier('entrée devenue basseDefinition : son moyen est RETIRÉ de l\'entrée, le set est nommé pour la revalidation', [J.cartes[0].images[1].moyen, B.retirees, B.sets.includes('Set-A')], [undefined, 1, true]);
    }
    {   // un original dont la largeur RÉELLE est sous le seuil (l'entrée disait 600) : compté, pas de moyen, pas d'écriture
        const J = jeu(), db = baseFictive(J), r2 = r2Faux({ 'a/1.webp': await image(300, 412) });
        const B = await M.assurerMoyens(db, { bucket: 'b', r2, journal: { error() { } } });
        verifier('largeur réelle < 471 : échec COMPTÉ et nommé, aucun dépôt, aucune entrée écrite', [B.echecs.length, r2.depots.length, J.cartes[0].images[0].moyen], [1, 0, undefined]);
    }

    // ══ TOUR 1 (relecture du scan moyen) ══
    const muet = { error() { } };
    {   // I2 — la revalidation ne se perd pas : chaque set est DÉCLARÉ (surEcriture) AVANT l'écriture de ses entrées, une fois, même si le run meurt ensuite
        const J = jeu();
        J.cartes.push({ _id: 2, images: [{ set: 'Set-B', numero: '1', cleR2: 'b/1.webp', w: 600, h: 825 }] });
        J.images.push({ cleR2: 'b/1.webp', sha256: 'BB1', w: 600 });
        const db = baseFictive(J), r2 = r2Faux({ 'a/1.webp': O });   // b/1.webp est ABSENT du faux R2 : la lecture lèvera (le run « casse » sur le 2e set)
        const evt = [];
        const B = await M.assurerMoyens(db, { bucket: 'b', r2, journal: muet, parallele: 1, surEcriture: async ss => { evt.push([ss.join(','), db.ecritures.filter(x => x[0] === 'cartes').length]); } });
        verifier('surEcriture : le set est déclaré AVANT l\'écriture de ses entrées (0 écriture de carte déjà faite), une seule fois, et le set du 2e (en échec) ne l\'est pas',
            [evt, J.cartes[0].images[0].moyen !== undefined, B.echecs.length], [[['Set-A', 0]], true, 1]);
        const pasDeCallback = await M.assurerMoyens(baseFictive(jeu()), { bucket: 'b', r2: r2Faux({ 'a/1.webp': O }), journal: muet });
        verifier('sans callback, rien ne casse', pasDeCallback.fabriquees, 1);
    }
    {   // M1 — jamais écrire ce que le site ignorerait : l'entrée porte h:1100 (proportion fausse), le moyen est refusé AVANT dépôt et AVANT écriture
        const J = jeu(); J.cartes[0].images[0].h = 1100;
        const db = baseFictive(J), r2 = r2Faux({ 'a/1.webp': O });
        const B = await M.assurerMoyens(db, { bucket: 'b', r2, journal: muet });
        verifier('moyen que le site ignorerait : échec nommé, 0 dépôt, 0 écriture d\'entrée, 0 de document', [B.echecs.length, /site/.test(B.echecs[0]?.erreur || ''), r2.depots.length, db.ecritures.length, J.cartes[0].images[0].moyen], [1, true, 0, 0, undefined]);
        const J2 = jeu(); J2.cartes[0].images[0].h = 1100; J2.images[0].moyen = { cleR2: 'moyens/a/1.webp', w: 400, h: 550, de: 'AAA' };
        const db2 = baseFictive(J2), B2 = await M.assurerMoyens(db2, { bucket: 'b', r2: r2Faux({}), journal: muet });
        verifier('la recopie depuis le document est jugée de même (proportion de l\'ENTRÉE)', [B2.echecs.length, db2.ecritures.length, J2.cartes[0].images[0].moyen], [1, 0, undefined]);
    }
    {   // M2 — deux documents `images` pour une même cleR2 : celui à l'état « ok » gagne (la projection porte `etat`)
        const J = jeu();
        J.images = [{ _id: 1, cleR2: 'a/1.webp', etat: 'remplace', sha256: 'OLD', moyen: { cleR2: 'moyens/a/1.webp', w: 400, h: 100, de: 'OLD' } },
            { _id: 2, cleR2: 'a/1.webp', etat: 'ok', sha256: 'NEW', moyen: { cleR2: 'moyens/a/1.webp', w: 400, h: 550, de: 'NEW' } }];
        const B = await M.assurerMoyens(baseFictive(J), { bucket: 'b', r2: r2Faux({}), journal: muet });
        verifier('document « ok » préféré à un document « remplace » de même cleR2', [J.cartes[0].images[0].moyen, B.echecs.length], [{ cleR2: 'moyens/a/1.webp', w: 400, h: 550 }, 0]);
    }
    {   // M3 — deux clés qui ne diffèrent que par l'extension donneraient la même clé de moyen : la seconde (ordre des clés) est REFUSÉE et nommée
        const J = { cartes: [{ _id: 1, images: [{ set: 'Set-A', numero: '1', cleR2: 'a/n.png', w: 600, h: 825 }, { set: 'Set-A', numero: '2', cleR2: 'a/n.webp', w: 600, h: 825 }] }],
            images: [{ cleR2: 'a/n.png', sha256: 'P' }, { cleR2: 'a/n.webp', sha256: 'W' }] };
        const db = baseFictive(J), r2 = r2Faux({ 'a/n.png': O, 'a/n.webp': O });
        const B = await M.assurerMoyens(db, { bucket: 'b', r2, journal: muet, parallele: 1 });
        verifier('collision de clé de moyen : la première reçoit son moyen, la seconde est refusée et nommée, un seul dépôt',
            [J.cartes[0].images[0].moyen?.cleR2, J.cartes[0].images[1].moyen, B.echecs.map(x => [x.cleR2, /collision/.test(x.erreur)]), r2.depots.map(x => x.cle)], ['moyens/a/n.webp', undefined, [['a/n.webp', true]], ['moyens/a/n.webp']]);
        const J3 = { cartes: [{ _id: 1, images: [{ set: 'Set-A', numero: '2', cleR2: 'a/n.webp', w: 600, h: 825 }] }], images: [{ cleR2: 'a/n.webp', sha256: 'W' }, { cleR2: 'a/n.png', sha256: 'P' }] };
        const B3 = await M.assurerMoyens(baseFictive(J3), { bucket: 'b', r2: r2Faux({ 'a/n.webp': O }), journal: muet });
        verifier('… même quand la sœur n\'est pas dans la vague (elle est cherchée dans les documents `images`)', [B3.echecs.length, /collision/.test(B3.echecs[0]?.erreur || '')], [1, true]);
    }
    {   // M4 — un retrait sans effet n'est pas compté ; les retraits sont bornés par `limite`
        const J = { cartes: [{ _id: 1, images: [{ set: 'Set-A', numero: '1', cleR2: 'a/1.webp', moyen: { cleR2: 'moyens/a/1.webp', w: 400, h: 550 } },   // largeur inconnue : pas retirée
            { set: 'Set-A', numero: '2', cleR2: 'a/2.webp', w: 600, h: 825, basseDefinition: true, moyen: { cleR2: 'moyens/a/2.webp', w: 400, h: 550 } },
            { set: 'Set-B', numero: '3', cleR2: 'b/3.webp', w: 600, h: 825, basseDefinition: true, moyen: { cleR2: 'moyens/b/3.webp', w: 400, h: 550 } }] }], images: [] };
        const db = baseFictive(J);
        const B = await M.assurerMoyens(db, { bucket: 'b', r2: r2Faux({}), journal: muet, limite: 1 });
        verifier('retraits : la largeur inconnue n\'est pas retirée ni comptée ; --limite 1 borne les retraits (1 seul, 1 set)', [B.retirees, B.sets, J.cartes[0].images[0].moyen !== undefined, J.cartes[0].images[1].moyen, J.cartes[0].images[2].moyen !== undefined], [1, ['Set-A'], true, undefined, true]);
        const sim = await M.assurerMoyens(baseFictive(J), { bucket: 'b', r2: r2Faux({}), ecrire: false });
        verifier('simulation : le même compte de retraits (1 restant, la largeur inconnue exclue)', sim.retirees, 1);
    }
    {   // M5 — `moyen: null` est « sans moyen » ET s'écrit (le filtre d'écriture le voit)
        const J = jeu(); J.cartes[0].images[0].moyen = null;
        const B = await M.assurerMoyens(baseFictive(J), { bucket: 'b', r2: r2Faux({ 'a/1.webp': O }), journal: muet });
        verifier('moyen:null : fabriqué ET écrit sur l\'entrée', [B.fabriquees, J.cartes[0].images[0].moyen?.w], [1, 400]);
    }
    {   // M6 — le filtre RÉEL est exécuté : une carte sans aucune entrée éligible n'est pas lue ; une carte à basseDefinition non plus
        const J = { cartes: [{ _id: 1, images: [{ set: 'Set-A', numero: '1', cleR2: 'a/1.webp', w: 600, h: 825, basseDefinition: true }] }, { _id: 2, images: [{ set: 'Set-A', numero: '2', cleR2: 'a/2.webp', w: 400, h: 550 }] },
            { _id: 3, images: [{ set: 'Set-B', numero: '3', cleR2: 'b/3.webp', w: 600, h: 825 }] }], images: [] };
        const lues = []; const db = baseFictive(J); const col = db.collection;
        db.collection = n => { const c = col(n); if (n === 'cartes') { const f = c.find; c.find = fl => { const it = f(fl); return { async *[Symbol.asyncIterator]() { for await (const d of it) { lues.push(d._id); yield d; } } }; }; } return c; };
        const B = await M.assurerMoyens(db, { bucket: 'b', r2: r2Faux({}), ecrire: false, slug: 'Set-A' });
        verifier('filtre réel : sur Set-A, ni la basseDefinition ni les 400 px ne sont lues ; Set-B hors périmètre', [lues, B.cles], [[], 0]);
        const lues2 = lues.splice(0);
        const B2 = await M.assurerMoyens(db, { bucket: 'b', r2: r2Faux({}), ecrire: false });
        verifier('filtre réel : tout le stock -> seule la carte 3 est lue', [lues, B2.cles], [[3], 1]);
    }

    // ── une seule définition : l'outil et la chaîne des vignettes appellent le module, aucun nombre ni préfixe recopié
    const lire = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
    const sansCommentaires = s => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const outil = sansCommentaires(lire('generer-moyens.js')), chaine = sansCommentaires(lire('collecte-cartes/vignettes-apres-jointure.js'));
    verifier('generer-moyens.js appelle le module (assurerMoyens) et ne recopie ni « moyens/ », ni 471, ni 400', [/collecte-cartes\/moyen/.test(outil), /moyens\//.test(outil), /\b471\b/.test(outil), /\b400\b/.test(outil)], [true, false, false, false]);
    verifier('la chaîne des vignettes appelle assurerMoyens dans la même étape', [/assurerMoyens/.test(chaine), /require\('\.\/moyen'\)/.test(chaine)], [true, true]);

    verifier('generer-moyens.js : chaque set est inscrit en attente par surEcriture, la fin de run vide l\'attente (viderAttente) sans condition de nombre, SIGINT/SIGTERM câblés',
        [/surEcriture/.test(outil), /mettreEnAttente\(\{/.test(outil), /viderAttente\(/.test(outil), /SIGINT/.test(outil) && /arreter: \(\) => arretDemande/.test(outil), /if \(R\.sets\.length && revalider\)/.test(outil)], [true, true, true, true, false]);

    // ── l'outil : arguments inconnus et secret de revalidation refusés AVANT toute connexion
    const lancer = (args, env = {}) => require('child_process').spawnSync(process.execPath, ['generer-moyens.js', ...args], { cwd: __dirname, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 });
    const a = lancer(['--nimporte']);
    verifier('argument inconnu : code 2, aucune connexion', [a.status, /inconnu/.test(a.stderr || ''), /DÉNOMINATEUR/.test(a.stdout || '')], [2, true, false]);
    const g = lancer(['--ecrire', '--sets=banc-set-inexistant'], { REVALIDATION_SECRET: '' });
    verifier('--ecrire sans REVALIDATION_SECRET : code 2, le secret nommé, aucune connexion', [g.status, /REVALIDATION_SECRET/.test(g.stderr || ''), /DÉNOMINATEUR/.test(g.stdout || '')], [2, true, false]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
