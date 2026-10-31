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
function baseFictive({ cartes, images }) {
    const evalCond = (v, c) => {
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
            find: () => ({ async *[Symbol.asyncIterator]() { for (const d of cartes) yield d; } }),   // le faux ne filtre pas : moyen.js REFILTRE en JS
            updateOne: async (f, u, o) => { ecritures.push(['cartes', u]); appliquer(cartes.find(d => d._id === f._id), u, o && o.arrayFilters); return {}; }
        } : {
            find: q => ({ toArray: async () => images.filter(d => q.cleR2.$in.includes(d.cleR2)) }),
            updateOne: async (f, u) => { ecritures.push(['images', u]); const d = images.find(x => x.cleR2 === f.cleR2); if (d) appliquer(d, u); return {}; }
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
            [[['moyens/a/1.webp', 'image/webp', false]], { cleR2: 'moyens/a/1.webp', w: 400, h: 550 }, undefined, undefined, ['a/1.webp'], 1]);
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

    // ── une seule définition : l'outil et la chaîne des vignettes appellent le module, aucun nombre ni préfixe recopié
    const lire = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
    const sansCommentaires = s => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const outil = sansCommentaires(lire('generer-moyens.js')), chaine = sansCommentaires(lire('collecte-cartes/vignettes-apres-jointure.js'));
    verifier('generer-moyens.js appelle le module (assurerMoyens) et ne recopie ni « moyens/ », ni 471, ni 400', [/collecte-cartes\/moyen/.test(outil), /moyens\//.test(outil), /\b471\b/.test(outil), /\b400\b/.test(outil)], [true, false, false, false]);
    verifier('la chaîne des vignettes appelle assurerMoyens dans la même étape', [/assurerMoyens/.test(chaine), /require\('\.\/moyen'\)/.test(chaine)], [true, true]);

    // ── l'outil : arguments inconnus et secret de revalidation refusés AVANT toute connexion
    const lancer = (args, env = {}) => require('child_process').spawnSync(process.execPath, ['generer-moyens.js', ...args], { cwd: __dirname, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 });
    const a = lancer(['--nimporte']);
    verifier('argument inconnu : code 2, aucune connexion', [a.status, /inconnu/.test(a.stderr || ''), /DÉNOMINATEUR/.test(a.stdout || '')], [2, true, false]);
    const g = lancer(['--ecrire', '--sets=banc-set-inexistant'], { REVALIDATION_SECRET: '' });
    verifier('--ecrire sans REVALIDATION_SECRET : code 2, le secret nommé, aucune connexion', [g.status, /REVALIDATION_SECRET/.test(g.stderr || ''), /DÉNOMINATEUR/.test(g.stdout || '')], [2, true, false]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
