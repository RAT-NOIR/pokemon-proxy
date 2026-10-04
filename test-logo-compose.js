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
    console.log(`${ok}/${ok + ko}`); process.exit(ko ? 1 : 0);
})();
