// Banc de planLogoFr (exposer-logos-fr.js) : n'écrit que des clés ABSENTES, refuse tout set qui n'est pas occidental et toute valeur
// existante contraire. Aucune base, aucun R2.
const assert = require('assert');
const { planLogoFr } = require('./exposer-logos-fr');
const S = 'a'.repeat(40), T = 'b'.repeat(40);
const cas = [
    ['sans logoFr', () => assert.ok(planLogoFr({ region: 'intl' }, S).refus)],
    ['set japonais', () => assert.match(planLogoFr({ region: 'jp', logoFr: { cleR2: 'x' } }, S).refus, /tirage « jp »/)],
    ['set intl au tirage chinois', () => assert.match(planLogoFr({ region: 'intl', tirage: 'zh-hans', logoFr: { cleR2: 'x' } }, S).refus, /zh-hans/)],
    ['region déjà contraire', () => assert.match(planLogoFr({ region: 'intl', logoFr: { cleR2: 'x', region: 'jp' } }, S).refus, /region/)],
    ['langue déjà contraire', () => assert.match(planLogoFr({ region: 'intl', logoFr: { cleR2: 'x', langue: 'en' } }, S).refus, /langue/)],
    ['fichier illisible', () => assert.match(planLogoFr({ region: 'intl', logoFr: { cleR2: 'x' } }, null).refus, /illisible/)],
    ['sha1 écrit ≠ fichier', () => assert.match(planLogoFr({ region: 'intl', logoFr: { cleR2: 'x', sha1: T } }, S).refus, /≠ fichier/)],
    ['tout à poser', () => assert.deepStrictEqual(planLogoFr({ region: 'intl', logoFr: { cleR2: 'x', w: 1, h: 1 } }, S).poser, { region: 'intl', langue: 'fr', sha1: S })],
    ['langue et sha1 déjà justes (manuel)', () => assert.deepStrictEqual(planLogoFr({ region: 'intl', tirage: 'intl', logoFr: { cleR2: 'x', langue: 'fr', sha1: S } }, S).poser, { region: 'intl' })],
    ['complet : rien à poser', () => assert.deepStrictEqual(planLogoFr({ region: 'intl', logoFr: { cleR2: 'x', region: 'intl', langue: 'fr', sha1: S } }, S).poser, {})],
];
let ok = 0;
for (const [nom, f] of cas) { try { f(); ok++; console.log(`  ✅ ${nom}`); } catch (e) { console.log(`  🔴 ${nom} : ${e.message}`); } }
console.log(`${ok}/${cas.length}`);
if (ok !== cas.length) process.exit(1);
