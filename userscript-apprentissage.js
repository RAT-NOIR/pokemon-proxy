// ==UserScript==
// @name         Rat-Market — Apprentissage manuel Cardmarket
// @namespace    rat-market
// @version      1.2
// @description  Bouton "Apprendre cette page" sur les galeries Singles. Lit UNIQUEMENT la page ouverte — ne navigue jamais.
// @match        https://www.cardmarket.com/*/Pokemon/Products/Singles*
// @grant        GM_xmlhttpRequest
// @connect      pokemon-proxy-ratnoir666.onrender.com
// @run-at       document-idle
// ==/UserScript==

// ============================================================
// CE QUI A CHANGÉ EN 1.2, ET POURQUOI
// ============================================================
// 1. LA QUERY STRING EST RETIRÉE DU SLUG. La 1.1 prenait le dernier segment de l'href
//    tel quel, donc "Rotom-mC248?language=2", et en extrayait les chiffres de FIN : le
//    "2" de `language`. Puis elle envoyait ce "2" comme numeroUrl. C'est exactement le
//    bug qu'on vient de corriger sur 20 917 documents — le script les aurait repollués.
//
// 2. LE numeroUrl N'EST PLUS ENVOYÉ DU TOUT. Le serveur le recalcule lui-même depuis le
//    slug, avec la seule règle qui fait foi (scoring.numeroDepuisSlug). L'ancienne règle
//    /(\d+)$/ avalait aussi les chiffres du code de set : "sI100340" donnait 100340 au
//    lieu de 340, et 28,4 % des numeroUrl étaient faux. Le client n'a plus à connaître
//    cette règle, donc plus à s'en écarter.
//
// 3. LE NUMÉRO DU TITRE EST LA VRAIE PRISE. C'est lui qui fait foi ("Nom (CODE 176)").
//    Le panneau affiche donc combien de cartes de la page en ont un — c'est ça qui
//    mesure l'utilité du passage, pas le nombre de cartes lues.
//
// 4. LA COUVERTURE DE L'EXPANSION est affichée après chaque envoi. Sans elle, on ne sait
//    pas quand une galerie est finie. Le serveur la renvoie désormais.
//
// 5. PAGINATION visible et perSite=100 proposé. Une galerie de 125 cartes se fait en
//    2 pages au lieu de 7. Le script ne navigue jamais de lui-même : il propose un lien.

(function () {
  'use strict';

  // ===================== À CONFIGURER =====================
  const URL_API    = 'https://pokemon-proxy-ratnoir666.onrender.com';
  const JETON      = 'K10-Sr7izvo-CG3bSRfCbhSnw8KTNrbJ';
  const TAILLE_LOT = 25;
  const PAR_PAGE   = 100;   // moins de pages à tourner à la main

  // ===== Lecture de la page ================================================
  // ⚠️ MÊME logique que scraperListeExpansion (live-cardmarket.js), à une exception
  //    près et elle est volontaire : on n'extrait PAS le numéro de l'URL. Le serveur
  //    le fait, pour que la règle n'existe qu'à un seul endroit.
  function lireCartesDeLaPage() {
    const cartes = [];
    document.querySelectorAll('a.galleryBox').forEach(a => {
      // --- idProduct + code set, depuis l'URL de l'image ---
      const img = a.querySelector('img');
      const src = (img && (img.getAttribute('data-echo') || img.getAttribute('src'))) || '';
      const mImg = src.match(/\/(\d+)\/(\d+)\.jpg/i);
      if (!mImg) return;
      const idProduct = parseInt(mImg[1], 10);
      if (!idProduct) return;

      // Le code set est un segment d'URL, donc ENCODÉ ("SV-P%2FCS"). On le décode ici ;
      // le serveur le redécode par sécurité (decoderCodeSet), les deux sont idempotents.
      const mCode = src.match(/cardmarket\.com\/\d+\/([^/]+)\//i);
      let codeSet = mCode ? mCode[1] : null;
      if (codeSet) { try { codeSet = decodeURIComponent(codeSet); } catch (_) { /* brut */ } }

      // --- Nom FRANÇAIS, depuis l'attribut alt ---
      // C'est la prise la plus précieuse de tout le script. Elle permet d'apparier ce que
      // l'IA lit sur une carte française sans passer par TCGdex — mesuré à 97,9 % de
      // couverture, et c'est elle qui a résolu "Carabaffe", "Nix" et "Vesper", trois noms
      // qu'on prenait pour des hallucinations alors qu'ils sont les noms FR officiels.
      const nomFr = (img && img.getAttribute('alt') || '').trim() || null;

      // --- Numéro, depuis le TITRE : "Lambda de la Team Rocket (DRI 176)" ---
      // La source la plus fiable : elle gère les numéros à lettres (TG06, S19).
      const h2 = a.querySelector('h2');
      let numero = null;
      if (h2) {
        const mTitre = h2.textContent.trim().match(/\(([^)\s]+)\s+([^)\s]+)\)\s*$/);
        if (mTitre) numero = mTitre[2];
      }

      // --- Slug + variante, depuis le lien ---
      const href = a.getAttribute('href') || '';
      const morceaux = href.split('/').filter(Boolean);
      // ⚠️ .split('?')[0] : sans lui, "?language=2" reste collé au slug et le serveur en
      // tirerait "2" comme numéro. C'était le bug de la 1.1.
      const dernierSegment = (morceaux[morceaux.length - 1] || '').split('?')[0];
      const slugSet = morceaux[morceaux.length - 2] || null;
      const mVar = dernierSegment.match(/-(V\d+)-/i);
      const variante = mVar ? mVar[1].toUpperCase() : null;

      // Pas de numeroUrl : c'est le serveur qui le dérive du slug (point 2 de l'en-tête).
      cartes.push({ idProduct, numero, codeSet, nomFr, variante, slug: dernierSegment || null, slugSet });
    });
    return cartes;
  }

  // ===== Contexte de la page : quelle galerie, quelle page ? ===============
  function contexteDeLaPage() {
    const morceaux = location.pathname.split('/').filter(Boolean);
    const slugSet = morceaux[morceaux.length - 1] || '?';
    const params = new URLSearchParams(location.search);
    const page = parseInt(params.get('site') || '1', 10) || 1;
    const perSite = parseInt(params.get('perSite') || '0', 10) || null;
    // Nombre total de pages : Cardmarket l'affiche dans sa pagination.
    let pages = null;
    for (const el of document.querySelectorAll('[aria-label], .pagination a, .pagination span')) {
      const m = (el.textContent || '').trim().match(/^(\d+)$/);
      if (m) pages = Math.max(pages || 0, parseInt(m[1], 10));
    }
    return { slugSet, page, perSite, pages };
  }

  function urlAvecPerSite() {
    const u = new URL(location.href);
    u.searchParams.set('perSite', String(PAR_PAGE));
    u.searchParams.delete('site');
    return u.toString();
  }
  function urlPageSuivante(ctx) {
    const u = new URL(location.href);
    u.searchParams.set('site', String(ctx.page + 1));
    return u.toString();
  }

  // ===== Envoi d'un lot (GM_xmlhttpRequest = pas de CORS) ==================
  function envoyerLot(lot) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: URL_API + '/api/apprendre-lot',
        headers: { 'Content-Type': 'application/json', 'x-jeton': JETON },
        data: JSON.stringify({ cartes: lot }),
        timeout: 30000,
        onload:  r => { try { resolve(JSON.parse(r.responseText)); } catch { reject(new Error('réponse illisible')); } },
        onerror: () => reject(new Error('requête échouée')),
        ontimeout: () => reject(new Error('délai dépassé'))
      });
    });
  }

  // ===== UI ===============================================================
  const ctx = contexteDeLaPage();
  const panneau = document.createElement('div');
  panneau.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:99999;background:#0d0d10;color:#eee;' +
    'font:13px system-ui,sans-serif;padding:12px 14px;border:1px solid #D4AF37;border-radius:10px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.4);width:278px';
  panneau.innerHTML =
    '<div style="font-weight:600;margin-bottom:2px">🐀 Apprendre cette page</div>' +
    `<div style="color:#888;font-size:11px;margin-bottom:8px">${ctx.slugSet} · page ${ctx.page}${ctx.pages ? '/' + ctx.pages : ''}${ctx.perSite ? ' · ' + ctx.perSite + '/page' : ''}</div>` +
    (ctx.perSite !== PAR_PAGE
      ? `<div style="margin-bottom:8px"><a id="rm-persite" href="${urlAvecPerSite()}" style="color:#D4AF37;font-size:11px">↻ recharger à ${PAR_PAGE} cartes par page</a></div>`
      : '') +
    '<button id="rm-go" style="width:100%;padding:7px;background:#0c0c0e;color:#D4AF37;' +
    'border:1px solid #D4AF37;border-radius:6px;cursor:pointer;font-weight:600">Apprendre</button>' +
    '<div id="rm-barwrap" style="display:none;height:6px;background:#333;border-radius:3px;margin-top:10px;overflow:hidden">' +
    '<div id="rm-bar" style="height:100%;width:0;background:#D4AF37;transition:width .2s"></div></div>' +
    '<div id="rm-msg" style="margin-top:8px;min-height:16px;color:#bbb;line-height:1.4"></div>';
  document.body.appendChild(panneau);

  const btn     = panneau.querySelector('#rm-go');
  const barwrap = panneau.querySelector('#rm-barwrap');
  const bar     = panneau.querySelector('#rm-bar');
  const msg     = panneau.querySelector('#rm-msg');

  btn.addEventListener('click', async () => {
    const cartes = lireCartesDeLaPage();
    if (!cartes.length) {
      msg.textContent = 'Aucune carte trouvée. Passe en vue GALERIE (icône grille).';
      return;
    }

    // Le numéro du TITRE est ce qui fait foi. S'il manque partout, ce passage
    // n'apportera presque rien, et il vaut mieux le savoir AVANT d'envoyer.
    const avecNumeroTitre = cartes.filter(c => c.numero).length;
    if (avecNumeroTitre === 0) {
      msg.innerHTML = '<span style="color:#e6a23c">⚠️ Aucune carte de cette page n\'affiche de numéro dans son titre.</span>' +
                      '<br><span style="color:#888">L\'apprentissage ne pourra pas renseigner de numéro. On envoie quand même : les noms FR et les codes de set restent utiles.</span>';
    }

    btn.disabled = true; btn.style.opacity = '.6';
    barwrap.style.display = 'block';
    bar.style.width = '0';
    const prefixe = `Lecture : ${cartes.length} cartes, dont ${avecNumeroTitre} avec un numéro de titre…`;
    if (avecNumeroTitre > 0) msg.textContent = prefixe;

    let nouv = 0, amel = 0, exact = 0, sansNum = 0, erreur = false, couverture = null;
    for (let i = 0; i < cartes.length; i += TAILLE_LOT) {
      const lot = cartes.slice(i, i + TAILLE_LOT);
      try {
        const r = await envoyerLot(lot);
        if (r && r.success) {
          nouv += r.nouvelles; amel += r.ameliorees; exact += r.dejaExactes; sansNum += (r.sansNumero || 0);
          if (r.couverture) couverture = r.couverture;   // la dernière renvoyée est la plus à jour
        } else { erreur = true; msg.textContent = '❌ ' + ((r && r.error) || 'refus serveur'); break; }
      } catch (e) { erreur = true; msg.textContent = '❌ ' + e.message; break; }
      bar.style.width = Math.round(((i + lot.length) / cartes.length) * 100) + '%';
    }

    if (!erreur) {
      bar.style.width = '100%';
      let html =
        `✅ <b>${nouv}</b> nouvelles · <b>${amel}</b> améliorées · ${exact} déjà exactes` +
        (sansNum ? `<br><span style="color:#888">${sansNum} sans numéro ignorées</span>` : '');

      // La couverture dit si la galerie est finie. C'est elle qui compte : une expansion
      // à 0 % de numéros est invisible pour l'identification locale.
      if (couverture) {
        const pc = couverture.pourcent;
        const couleur = pc >= 90 ? '#67c23a' : pc >= 50 ? '#e6a23c' : '#f56c6c';
        html += `<br><span style="color:${couleur}">📊 expansion couverte à ${pc} % ` +
                `(${couverture.avecNumero}/${couverture.produits} numéros)</span>`;
        if (pc < 90) {
          html += ctx.pages && ctx.page < ctx.pages
            ? `<br><a href="${urlPageSuivante(ctx)}" style="color:#D4AF37">→ page ${ctx.page + 1}/${ctx.pages}</a>`
            : `<br><span style="color:#888">Reste des cartes sans numéro de titre : rien de plus à tirer d'ici.</span>`;
        } else {
          html += '<br><span style="color:#67c23a">Expansion terminée 🎉</span>';
        }
      }
      msg.innerHTML = html;
    }
    btn.disabled = false; btn.style.opacity = '1';
  });
})();
