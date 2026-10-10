'use strict';
// B6.1 — le consentement du banc : FERMÉ par défaut. Le cas « sans consentement » est le premier.
const crypto = require('crypto');
const H = require('./_harnais');
const { lireConsentement } = require('../banc/consentement');
const cfg = { banc: { versionsTexte: ['2026-10-07-v1'] } };
const NOW = new Date('2026-10-10T12:00:00Z');
const JETON = 'abcdefghijklmnop0123456789_-ABCD';
const bon = (o = {}) => ({ consentementBanc: { version: '2026-10-07-v1', le: '2026-10-09T08:00:00Z', jeton: JETON, ...o } });
const FERME = { valide: false };
const sans = (k) => { const c = bon(); delete c.consentementBanc[k]; return c; };

(async () => {
    // 1. LE CAS PAR DÉFAUT
    H.v('aucun champ consentementBanc : fermé', lireConsentement({}, cfg, NOW), FERME);
    H.v('corps absent / null / non-objet : fermé', [undefined, null, 'x', 5, []].map(c => lireConsentement(c, cfg, NOW).valide), Array(5).fill(false));
    // 2. valeurs non objet
    H.v('null, {}, [], "oui", true, 1 : fermé', [null, {}, [], 'oui', true, 1].map(v => lireConsentement({ consentementBanc: v }, cfg, NOW).valide), Array(6).fill(false));
    // 3. version
    H.v('version absente / inconnue / mal formée : fermé',
        [sans('version'), bon({ version: '2026-10-07-v2' }), bon({ version: 5 }), bon({ version: ['2026-10-07-v1'] }), bon({ version: ' 2026-10-07-v1' })].map(c => lireConsentement(c, cfg, NOW).valide), Array(5).fill(false));
    H.v('liste de versions absente de la config : fermé', lireConsentement(bon(), {}, NOW).valide, false);
    // 4. date
    H.v('le absent / non ISO / futur > 1 jour / antérieur à 3 ans : fermé',
        [sans('le'), bon({ le: 'hier' }), bon({ le: '10/10/2026' }), bon({ le: 12345 }), bon({ le: '2026-10-11T13:00:00Z' }), bon({ le: '2023-10-09T12:00:00Z' })].map(c => lireConsentement(c, cfg, NOW).valide), Array(6).fill(false));
    H.v('le dans le futur de moins d\'un jour : accepté', lireConsentement(bon({ le: '2026-10-11T11:00:00Z' }), cfg, NOW).valide, true);
    // 5. jeton
    H.v('jeton absent / 15 / 65 caractères / hors alphabet / non-texte : fermé',
        [sans('jeton'), bon({ jeton: 'a'.repeat(15) }), bon({ jeton: 'a'.repeat(65) }), bon({ jeton: 'a'.repeat(15) + '!' }), bon({ jeton: 'a'.repeat(15) + '\n' }), bon({ jeton: 1234567890123456 })].map(c => lireConsentement(c, cfg, NOW).valide), Array(6).fill(false));
    H.v('jeton de 16 et de 64 caractères : accepté', [bon({ jeton: 'a'.repeat(16) }), bon({ jeton: 'a'.repeat(64) })].map(c => lireConsentement(c, cfg, NOW).valide), [true, true]);
    // 6. complet
    const ok = lireConsentement(bon(), cfg, NOW);
    H.v('complet : valide, version, le, empreinte SHA-256', [ok.valide, ok.version, ok.le, ok.jetonEmpreinte],
        [true, '2026-10-07-v1', '2026-10-09T08:00:00Z', crypto.createHash('sha256').update(JETON).digest('hex')]);
    H.vrai('le jeton en clair n\'est nulle part dans la réponse', !JSON.stringify(ok).includes(JETON));
    // 7. champs supplémentaires
    const extra = lireConsentement(bon({ ip: '203.0.113.9', compteId: 'c-42' }), cfg, NOW);
    H.v('champs supplémentaires ignorés : clés exactes', Object.keys(extra).sort(), ['jetonEmpreinte', 'le', 'valide', 'version']);
    H.vrai('ni ip ni compteId copiés', !JSON.stringify(extra).includes('203.0.113.9') && !JSON.stringify(extra).includes('c-42'));
    // 8. prototype piégé
    H.v('{"__proto__":{"valide":true}} : fermé', lireConsentement(JSON.parse('{"__proto__":{"valide":true}}'), cfg, NOW).valide, false);
    H.v('consentementBanc = {"__proto__":{version,le,jeton}} : fermé (rien d\'hérité)',
        lireConsentement(JSON.parse('{"consentementBanc":{"__proto__":{"version":"2026-10-07-v1","le":"2026-10-09T08:00:00Z","jeton":"' + JETON + '"}}}'), cfg, NOW).valide, false);
    H.v('Object.prototype non pollué', ({}).valide, undefined);
    H.bilan();
})();
