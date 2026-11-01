// node test-r2-ecraser.js — le VRAI collecte-cartes/r2.js (deposerBinaire), avec un client S3 FAUX injecté (_poserClient) : aucun réseau, aucun seau.
// Une garde s'écrit par ce qu'elle AUTORISE : `ecraser: true` n'est accepté que pour une clé sous `moyens/` ; partout ailleurs, il LÈVE avant toute requête.
// Tue les mutants : « défaut ecraser = true » (le dépôt ordinaire écraserait) et « garde par préfixe retirée ».
const r2 = require('./collecte-cartes/r2');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

function clientFaux(existants) {
    const c = { commandes: [] };
    c.send = async cmd => {
        const nom = cmd.constructor.name; c.commandes.push([nom, cmd.input.Key]);
        if (nom === 'HeadObjectCommand') { if (existants.has(cmd.input.Key)) return {}; const e = new Error('NotFound'); e.name = 'NotFound'; e.$metadata = { httpStatusCode: 404 }; throw e; }
        return {};
    };
    return c;
}
const puts = c => c.commandes.filter(x => x[0] === 'PutObjectCommand').map(x => x[1]);
const leve = async f => { try { await f(); return null; } catch (e) { return e.message; } };

(async () => {
    {   // défaut : un objet existant n'est JAMAIS écrasé
        const c = clientFaux(new Set(['tcgdex/a/1.webp'])); r2._poserClient(c);
        const r = await r2.deposerBinaire('b', 'tcgdex/a/1.webp', Buffer.from('x'), 'image/webp');
        verifier('défaut : une clé existante n\'est pas écrasée (ecrit:false, aucun PutObject)', [r.ecrit, puts(c)], [false, []]);
    }
    {   // défaut : une clé absente est écrite
        const c = clientFaux(new Set()); r2._poserClient(c);
        const r = await r2.deposerBinaire('b', 'tcgdex/a/2.webp', Buffer.from('x'), 'image/webp');
        verifier('défaut : une clé absente est écrite', [r.ecrit, puts(c)], [true, ['tcgdex/a/2.webp']]);
    }
    {   // ecraser:true sous moyens/ : écrit même si l'objet existe
        const c = clientFaux(new Set(['moyens/a/1.webp'])); r2._poserClient(c);
        const r = await r2.deposerBinaire('b', 'moyens/a/1.webp', Buffer.from('x'), 'image/webp', { ecraser: true });
        verifier('ecraser:true sous moyens/ : l\'objet existant est remplacé', [r.ecrit, puts(c)], [true, ['moyens/a/1.webp']]);
    }
    // ecraser:true partout ailleurs : LÈVE, aucune requête (ni Head ni Put)
    for (const cle of ['tcgdex/a/1.webp', 'bulbapedia/Arceus/89-41586.webp', 'vignettes/a/1.webp', 'logos/x.png', 'moyensX/a.webp', 'a/moyens/b.webp', '', 'moyens']) {
        const c = clientFaux(new Set([cle])); r2._poserClient(c);
        const m = await leve(() => r2.deposerBinaire('b', cle, Buffer.from('x'), 'image/webp', { ecraser: true }));
        verifier(`ecraser:true sur « ${cle} » : lève, aucune requête`, [/moyens\//.test(m || ''), c.commandes.length], [true, 0]);
    }
    r2._poserClient(null);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
