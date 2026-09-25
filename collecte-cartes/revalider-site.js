// ============================================================
// LA REVALIDATION À LA DEMANDE DU SITE — à appeler en fin de lot, pour les sets touchés et eux seuls
// ============================================================
//   node collecte-cartes/revalider-site.js --sets=Slug-A,Slug-B [--catalogue]
//   const { revaliderSets } = require('./collecte-cartes/revalider-site'); await revaliderSets(slugs, { catalogue: true })
//
// POURQUOI (site, 2026-09-25, DEMANDE-serveur-illustrateurs-logos.md « PRIORITÉ 0 bis ») : le site ne régénère plus ses pages
// toutes les heures (quota Vercel) ; sans cet appel, une page attend 30 jours. Contrat : POST https://rat-market.fr/api/revalider,
// `Authorization: Bearer <REVALIDATION_SECRET>`, corps `{ sets: [slugs ≤ 500], catalogue: bool }` ; 200 `{ sets, catalogue, le }`,
// 404 sans le bon secret, 400 sans corps JSON. `catalogue: true` quand un nom, une date ou un compte a changé (/fr/sets).
// ⚠️ Le secret ne s'imprime JAMAIS, ni dans un message d'erreur. Une réponse autre que 200 LÈVE : un lot dont les pages ne sont
// pas revalidées n'est pas fini, et il doit le dire au lieu de rendre la main en silence.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const URL_REVALIDER = 'https://rat-market.fr/api/revalider';
const PAR_APPEL = 500;

// Le motif que la route du site accepte (app/api/revalider/route.ts) : un slug hors motif y serait IGNORÉ sans un mot.
const MOTIF_SLUG = /^[A-Za-z0-9.-]{1,120}$/;

async function revaliderSets(slugs, { catalogue = false, especes = false, journal = console } = {}) {
    const secret = process.env.REVALIDATION_SECRET;
    if (!secret) throw new Error('REVALIDATION_SECRET absent du .env : la revalidation ne peut pas partir');
    const tous = [...new Set((slugs || []).filter(s => typeof s === 'string' && s))];
    const horsMotif = tous.filter(s => !MOTIF_SLUG.test(s));
    if (horsMotif.length) journal.log(`   🔴 revalidation : ${horsMotif.length} slug(s) hors du motif de la route, que le site ignorerait — ${horsMotif.slice(0, 8).join(', ')}`);
    const uniques = tous.filter(s => MOTIF_SLUG.test(s));
    if (!uniques.length && !catalogue && !especes) { journal.log('   revalidation : aucun set touché, rien à demander'); return { appels: 0, sets: 0, horsMotif }; }
    let appels = 0, total = 0;
    for (let i = 0; i < Math.max(uniques.length, 1); i += PAR_APPEL) {
        const lot = uniques.slice(i, i + PAR_APPEL);
        const r = await fetch(URL_REVALIDER, {
            method: 'POST', signal: AbortSignal.timeout(60000),
            headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
            // catalogue et espèces une seule fois, au premier appel
            body: JSON.stringify({ sets: lot, catalogue: !!catalogue && i === 0, especes: !!especes && i === 0 })
        });
        const texte = await r.text();
        appels++;
        if (r.status !== 200) throw new Error(`revalidation refusée : HTTP ${r.status} (${texte.slice(0, 120)}) — ${lot.length} sets non revalidés`);
        let corps = {}; try { corps = JSON.parse(texte); } catch { /* corps non JSON : on imprime le brut */ }
        total += Number(corps.sets ?? lot.length);
        journal.log(`   revalidation ${appels} : HTTP 200 · ${corps.sets ?? '?'} set(s) · catalogue ${corps.catalogue ?? catalogue} · le ${corps.le ?? '?'}`);
    }
    return { appels, sets: total, horsMotif };
}

module.exports = { revaliderSets, URL_REVALIDER, MOTIF_SLUG };

if (require.main === module) {
    const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
    const inconnus = process.argv.slice(2).filter(a => !/^--(sets=|catalogue$|especes$)/.test(a));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — --sets=A,B [--catalogue] [--especes]`); process.exit(2); }
    revaliderSets(arg('sets').split(',').map(s => s.trim()).filter(Boolean), { catalogue: process.argv.includes('--catalogue'), especes: process.argv.includes('--especes') })
        .then(r => console.log(`   ✅ ${r.appels} appel(s), ${r.sets} set(s) revalidé(s)`))
        .catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
