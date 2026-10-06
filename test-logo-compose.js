// Banc de collecte-cartes/logo-compose.js — le plan (qui reçoit, qui est gardé, qui est refusé), l'unicité, la transparence du fond.
const assert = require('assert');
const sharp = require('sharp');
const M = require('./collecte-cartes/logo-compose');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`❌ ${nom} : ${e.message}`); } };

(async () => {
    const tete = { _id: 'Base-Set', region: 'intl', logo: { cleR2: 'bulbapedia/logos/old.png', sha1: 'aa', preuve: 'set occidental, aucun suffixe de langue' } };
    const C = {
        'WP': { famille: 'promos', logo: { serie: 'Base-Set' }, etoile: true, etiquette: 'PROMOS' },
        'POP1': { famille: 'pop', logo: { source: 'pop' }, etiquette: 'POP Série 1' },
        'JPBA': { famille: 'battle-academy', logo: null, etiquette: 'Battle Academy', sous: 'Japon' },
        'IDP': { famille: 'promos', logo: { serie: 'Base-Set' }, etoile: true, etiquette: 'PROMOS' },
        'ABSENT': { famille: 'pop', logo: { source: 'pop' }, etiquette: 'X' }
    };
    const action = (plan, slug) => plan.find(p => p.slug === slug)?.action;

    await t('aucun logo -> écrire, avec le logo de tête de série', () => {
        const p = M.planifier([tete, { _id: 'WP', region: 'intl' }], C);
        assert.equal(action(p, 'WP'), 'ecrire'); assert.equal(p.find(x => x.slug === 'WP').logoCle, 'bulbapedia/logos/old.png');
    });
    await t('set absent -> refus', () => assert.equal(action(M.planifier([tete], C), 'ABSENT'), 'refus'));
    await t('logo propre -> gardé', () => assert.equal(action(M.planifier([tete, { _id: 'WP', region: 'intl', logo: { cleR2: 'x.png', sha1: 'bb' } }], C), 'WP'), 'garde-logo-propre'));
    await t('logo générique (marqué) -> écrire', () => assert.equal(action(M.planifier([tete, { _id: 'WP', region: 'intl', logo: { cleR2: 'x.png', sha1: 'bb', logoGenerique: true } }], C), 'WP'), 'ecrire'));
    await t('logo générique (sha1 sur deux pages) -> écrire', () => assert.equal(action(M.planifier([tete, { _id: 'WP', region: 'intl', bulba: { pageid: 1 }, logo: { cleR2: 'x.png', sha1: 'cc' } }, { _id: 'Z', region: 'intl', bulba: { pageid: 2 }, logo: { cleR2: 'x.png', sha1: 'cc' } }], C), 'WP'), 'ecrire'));
    await t('logoCompose déjà là -> gardé', () => assert.equal(action(M.planifier([tete, { _id: 'WP', region: 'intl', logoCompose: { cleR2: 'logos/composes/WP.png' } }], C), 'WP'), 'garde-deja-compose'));
    await t('logo de série anglais sur un tirage indonésien -> refus', () => assert.equal(action(M.planifier([tete, { _id: 'IDP', region: 'intl', tirage: 'id' }], C), 'IDP'), 'refus'));
    await t('set de tête sans preuve occidentale -> refus', () => assert.equal(action(M.planifier([{ ...tete, logo: { cleR2: 'y.png', preuve: 'suffixé « JP »' } }, { _id: 'WP', region: 'intl' }], C), 'WP'), 'refus'));
    await t('logo commun anglais (POP) sur un set japonais -> refus', () => assert.equal(action(M.planifier([tete, { _id: 'POP1', region: 'jp' }], C), 'POP1'), 'refus'));
    await t('étiquette seule sur un set japonais -> écrire sans logo', () => { const p = M.planifier([tete, { _id: 'JPBA', region: 'jp' }], C); assert.equal(action(p, 'JPBA'), 'ecrire'); assert.equal(p.find(x => x.slug === 'JPBA').logoCle, null); });
    await t('collision : deux sets au même logo et même étiquette', () => {
        const p = M.planifier([tete, { _id: 'WP', region: 'intl' }, { _id: 'IDP', region: 'intl' }], C);
        assert.deepEqual(M.collisions(p), [['WP', 'IDP']]);
    });
    await t('la table réelle : aucune collision si tout était à écrire', () => {
        const plan = Object.entries(M.COMPOSITIONS).map(([slug, c]) => ({ slug, ...c, action: 'ecrire', logoCle: c.logo?.serie ? `serie:${c.logo.serie}` : c.logo?.source ? `source:${c.logo.source}` : null }));
        assert.deepEqual(M.collisions(plan), []);
    });
    await t('transparence : fond blanc ôté depuis les bords, blanc enfermé gardé', async () => {
        const W = 40, px = Buffer.alloc(W * W * 4);
        for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4, anneau = x >= 10 && x < 30 && y >= 10 && y < 30 && !(x >= 15 && x < 25 && y >= 15 && y < 25);
            const v = anneau ? 0 : 255; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
        }
        const buf = await sharp(px, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer();
        assert.equal(await M.fondBlancOpaque(buf), true);
        const out = await sharp(await M.transparentiserFond(buf)).ensureAlpha().raw().toBuffer();
        const a = (x, y) => out[(y * W + x) * 4 + 3];
        assert.equal(a(0, 0), 0, 'coin'); assert.equal(a(5, 20), 0, 'fond');
        assert.equal(a(12, 12), 255, 'anneau noir'); assert.equal(a(20, 20), 255, 'blanc ENFERMÉ dans le dessin');
    });
    await t('un logo transparent n\'est pas un fond blanc', async () => {
        const buf = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
        assert.equal(await M.fondBlancOpaque(buf), false);
    });
    await t('deux étiquettes différentes -> deux fichiers différents', async () => {
        const a = await M.composer({ logo: null, etoile: true, etiquette: 'PROMOS', sous: 'Épée et Bouclier · thaï' });
        const b = await M.composer({ logo: null, etoile: true, etiquette: 'PROMOS', sous: 'Épée et Bouclier · indonésien' });
        assert.notEqual(M.sha1(a), M.sha1(b));
    });
    // (2026-10-07) les 272 sets sans logo : 175 noms de plus de 22 caractères, jusqu'à 61 — l'étiquette passe sur DEUX lignes
    await t('nom long : deux lignes, chacune courte ; nom court : une ligne', () => {
        assert.deepEqual(M.lignesEtiquette('POP Série 1'), ['POP Série 1']);
        const l = M.lignesEtiquette('Venusaur Charizard Blastoise Random Constructed Starter Decks');
        assert.equal(l.length, 2); assert.ok(Math.max(...l.map(x => x.length)) <= Math.ceil(61 / 2) + 4, `coupe équilibrée : ${JSON.stringify(l)}`);
        assert.equal(l.join(' '), 'Venusaur Charizard Blastoise Random Constructed Starter Decks');
    });
    await t('le rendu VALIDÉ ne bouge pas : une étiquette de 22 caractères au plus rend le SVG d\'avant, au caractère près', () => {
        const avant = (texte, sous, { largeur = 400, haut = sous ? 84 : 66 } = {}) => {     // la fonction de la planche du 2026-10-04, recopiée
            const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const tt = texte.length > 22 ? 24 : 30, y = sous ? 36 : haut / 2 + tt / 3;
            return { haut, largeur, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${haut}">
      <rect x="0" y="0" width="${largeur}" height="${haut}" rx="16" fill="#151922" stroke="#e8b23a" stroke-width="2"/>
      <rect x="0" y="0" width="9" height="${haut}" rx="4" fill="#e8b23a"/>
      <text x="${largeur / 2}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${tt}" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">${esc(texte)}</text>
      ${sous ? `<text x="${largeur / 2}" y="${y + 28}" font-family="Segoe UI, Arial, sans-serif" font-weight="600" font-size="17" fill="#e8b23a" text-anchor="middle">${esc(sous)}</text>` : ''}
      <text x="${largeur - 12}" y="${haut - 7}" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="#7d8696" text-anchor="end">RAT-MARKET</text></svg>` };
        };
        for (const [e, s, o] of [['POP Série 1', null], ['Édition 2020', 'Dracaufeu-GX · Raichu-GX · Mewtwo-GX'], ['PROMOS', 'Épée et Bouclier · thaï'], ['Battle Academy', 'Écarlate et Violet · Japon', { largeur: 440, haut: 120 }]])
            assert.deepEqual(M.svgEtiquette(e, s, o), avant(e, s, o));
    });
    await t('étiquette sur deux lignes : la hauteur s\'agrandit, le sous-titre reste sous les deux lignes', () => {
        const e = M.svgEtiquette('Starter Set ex Marnie\'s Morpeko & Grimmsnarl ex', 'Japon', { largeur: 440, haut: 120 });
        const ys = [...e.svg.matchAll(/<text x="[^"]+" y="([\d.]+)"/g)].map(m => Number(m[1]));
        assert.equal(ys.length, 4, 'deux lignes, le sous-titre, la marque');
        assert.ok(ys[0] < ys[1] && ys[1] < ys[2] && ys[2] < e.haut, JSON.stringify({ ys, haut: e.haut }));
        assert.ok(/&amp;/.test(e.svg) && /Marnie&#39;s|Marnie's/.test(e.svg));
    });
    console.log(`${ok}/${ok + ko}`); process.exit(ko ? 1 : 0);
})();
