'use strict';
// COMPTE-ESSAI tour 1 — la saisie masquée, tenue par un banc. Un FAUX terminal (PassThrough avec isTTY = true et setRawMode simulé), sortie capturée, journal d'événements ordonné.
// Aucun vrai terminal, aucune base. Le mot de passe ne doit apparaître dans AUCUN caractère écrit.
const { PassThrough } = require('stream');
const H = require('./_harnais');
let E = null;
try { E = require('../admin/compte-essai'); } catch (e) { H.vrai(`0. le module compte-essai existe (${e.code || e.name})`, false); H.bilan(); }

const SECRET = 'SecretTresLong-9!zz';
const tick = ms => new Promise(r => setTimeout(r, ms));
function faux({ tty = true } = {}) {
    const entree = new PassThrough(); entree.isTTY = tty; const evenements = [];
    if (tty) entree.setRawMode = m => { evenements.push(`raw:${m}`); return entree; };
    const sortie = { write(c) { evenements.push(`ecrit:${String(c)}`); return true; } };
    const ecrit = () => evenements.filter(e => e.startsWith('ecrit:')).map(e => e.slice(6)).join('');
    return { entree, sortie, evenements, ecrit };
}
// un fragment de 6 caractères du secret : assez long pour ne pas coïncider avec un mot des invites (« Adresse » contient « res »), assez court pour attraper un écho partiel
const fuite = (out, secret = SECRET) => [...Array(secret.length - 5).keys()].some(i => out.includes(secret.slice(i, i + 6)));
const issue = async (p, ms = 300) => Promise.race([p.then(v => ({ ok: v }), e => ({ erreur: e })), tick(ms).then(() => ({ attente: true }))]);

if (E) (async () => {
    // 1. frappe normale + retour arrière + Entrée : lu juste, rien d'affiché ; le mode muet (brut) est posé AVANT l'invite
    {
        const f = faux(); const s = E.saisieTerminal({ entree: f.entree, sortie: f.sortie });
        const pa = s.ligne('Adresse : '); await tick(20); f.entree.write('a@b.fr\r'); const a = await pa;
        const ps = s.secret('Mot de passe : '); await tick(20);
        f.entree.write(SECRET.slice(0, 8)); f.entree.write('\x7f\x7f'); f.entree.write(SECRET.slice(6)); f.entree.write('\r');
        const m = await ps; s.fermer();
        H.v('1. adresse lue (et affichée : ce n\'est pas un secret)', [a, f.ecrit().includes('a@b.fr')], ['a@b.fr', true]);
        H.v('   mot de passe lu juste malgré le retour arrière', m, SECRET);
        H.v('   sortie du secret : l\'invite et un saut de ligne, aucun caractère du mot de passe', [f.ecrit().includes('Mot de passe : \n'), fuite(f.ecrit())], [true, false]);
        const iRaw = f.evenements.indexOf('raw:true'), iPrem = f.evenements.findIndex(e => e.startsWith('ecrit:Adresse'));
        H.vrai('   le mode brut (muet) est posé AVANT la première invite', iRaw >= 0 && iRaw < iPrem);
        H.vrai('   le terminal est rendu (raw:false) à la fermeture', f.evenements[f.evenements.length - 1] === 'raw:false');
    }
    // 2. Ctrl+C pendant le secret
    {
        const f = faux(); const s = E.saisieTerminal({ entree: f.entree, sortie: f.sortie });
        const ps = s.secret('MDP : '); await tick(20); f.entree.write('abc'); f.entree.write('\x03');
        const r = await issue(ps);
        H.v('2. Ctrl+C pendant le secret : refus nommé « saisie interrompue », classe sûre', [r.erreur && r.erreur.message, r.erreur && r.erreur.sure === true, r.erreur && r.erreur.name], ['saisie interrompue', true, 'ErreurSaisie']);
        H.v('   rien du secret à l\'écran', f.ecrit().includes('abc'), false);
        s.fermer(); H.vrai('   terminal rendu', f.evenements.includes('raw:false'));
    }
    // 3. fin d'entrée pendant le secret
    {
        const f = faux(); const s = E.saisieTerminal({ entree: f.entree, sortie: f.sortie });
        const ps = s.secret('MDP : '); await tick(20); f.entree.write('abc'); f.entree.end();
        const r = await issue(ps);
        H.v('3. fin d\'entrée pendant le secret : « saisie interrompue »', r.erreur && r.erreur.message, 'saisie interrompue');
        s.fermer();
    }
    // 4. frappe AVANT l'invite : jamais affichée ; elle est lue par la question suivante
    {
        const f = faux(); const s = E.saisieTerminal({ entree: f.entree, sortie: f.sortie });
        const pa = s.ligne('Adresse : '); await tick(20); f.entree.write('a@b.fr\r'); await pa;
        f.entree.write('FRAPPE-ANTICIPEE\r'); await tick(30);
        H.vrai('4. frappe anticipée entre deux questions : rien d\'écrit à l\'écran', !f.ecrit().includes('FRAPPE') && !f.ecrit().includes('ANTICIPEE'));
        const m = await s.secret('MDP : ');
        H.v('   ... elle sert au secret suivant (muet)', [m, f.ecrit().includes('FRAPPE')], ['FRAPPE-ANTICIPEE', false]);
        s.fermer();
    }
    // 5. collage « mot de passe, Entrée, mot de passe, Entrée » : le second reste muet et sert à la confirmation
    {
        const f = faux(); const s = E.saisieTerminal({ entree: f.entree, sortie: f.sortie });
        const p1 = s.secret('MDP : '); await tick(20); f.entree.write(SECRET + '\r' + SECRET + '\r'); const m1 = await p1;
        const m2 = await s.secret('Encore : ');
        H.v('5. collage de deux lignes : les deux lues, la seconde sert à la confirmation', [m1 === SECRET, m2 === SECRET], [true, true]);
        H.v('   ... jamais affichées', fuite(f.ecrit()), false);
        s.fermer();
    }
    // 6. collage « mot de passe, Entrée, reste, Entrée » : le reste est lu comme confirmation (qui ne concordera pas), jamais affiché
    {
        const f = faux(); const s = E.saisieTerminal({ entree: f.entree, sortie: f.sortie });
        const p1 = s.secret('MDP : '); await tick(20); f.entree.write(SECRET + '\nREST-DU-COLLAGE\n'); await p1;
        const m2 = await s.secret('Encore : ');
        H.v('6. le reste d\'un collage est la seconde réponse, jamais affiché', [m2, f.ecrit().includes('REST'), fuite(f.ecrit())], ['REST-DU-COLLAGE', false, false]);
        s.fermer();
    }
    // 7. \r\n : un seul saut de ligne
    {
        const f = faux(); const s = E.saisieTerminal({ entree: f.entree, sortie: f.sortie });
        const p1 = s.secret('MDP : '); await tick(20); f.entree.write('abcdefghij\r\nklmnopqrst\r\n'); const m1 = await p1; const m2 = await s.secret('Encore : ');
        H.v('7. \\r\\n compte pour une seule fin de ligne', [m1, m2], ['abcdefghij', 'klmnopqrst']);
        s.fermer();
    }
    // 8. séquences d'échappement (flèches) ignorées
    {
        const f = faux(); const s = E.saisieTerminal({ entree: f.entree, sortie: f.sortie });
        const p1 = s.secret('MDP : '); await tick(20); f.entree.write('ab\x1b[Acd\x1b[3~ef\r'); const m1 = await p1;
        H.v('8. flèches et touches spéciales ne font pas partie du mot de passe', m1, 'abcdef');
        s.fermer();
    }
    // 9. sans terminal
    {
        const f = faux({ tty: false }); const s = E.saisieTerminal({ entree: f.entree, sortie: f.sortie });
        const r = await issue(s.secret('MDP : '));
        H.v('9. sans terminal interactif : « pas de terminal interactif », classe sûre, rien écrit', [r.erreur && /pas de terminal interactif/.test(r.erreur.message), r.erreur && r.erreur.sure === true, f.ecrit()], [true, true, '']);
        s.fermer();
    }
    // 10. après la fermeture, plus de question
    {
        const f = faux(); const s = E.saisieTerminal({ entree: f.entree, sortie: f.sortie }); s.fermer();
        const r = await issue(s.secret('MDP : '));
        H.v('10. une question après fermer() est refusée (jamais en attente sans fin)', r.erreur && r.erreur.message, 'saisie interrompue');
    }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
