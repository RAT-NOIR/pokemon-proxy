// ==UserScript==
// @name         Rat-Market — Apprentissage passif PikaQian
// @namespace    rat-market
// @version      2.0
// @description  Un bouton « Apprendre cette page » sur les pages de set que TU ouvres. Au clic seulement, envoie la page, puis les images que ton navigateur affiche (avec la carte et le numéro), au récepteur LOCAL (127.0.0.1). Ne navigue jamais, ne défile jamais, ne clique rien.
// @match        https://pikaqian.com/sets/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      images.pikaqian.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

// ============================================================
// PASSIF PAR CONSTRUCTION (décisions du testeur, 2026-10-12 puis 2026-10-13)
// ============================================================
// « Un bouton sur les pages de set que J'OUVRE MOI-MÊME, aucune navigation automatique. » (2026-10-12)
// « PikaQian : A. Le script passif envoie l'image telle que mon navigateur l'affiche, avec la carte et le numéro ; le worker ne touche jamais le CDN. Mêmes preuves
//   exigées (numéro, nom, set) ; un doute est un trou. » (2026-10-13)
// · Au chargement, ce script ne fait qu'AJOUTER un bouton à la page. Aucune requête ne part.
// · Au clic, et SEULEMENT au clic : (1) l'adresse de la page (sans requête ni ancre) et son HTML, au récepteur local ; (2) pour chaque tuile dont l'image est DÉJÀ chargée
//   par le navigateur, le code du set (de l'adresse), le nom et le numéro que la page affiche, et les octets de l'image, au récepteur local, par lots bornés.
// · Aucune navigation, aucun défilement, aucune minuterie, aucune fenêtre. Les tuiles dont l'image n'est pas encore chargée (page paresseuse, pas défilée) NE SONT PAS
//   forcées : le panneau les COMPTE et le dit ; c'est à TOI de faire défiler la page, puis de recliquer.
// COMMENT LES OCTETS SONT LUS — trois voies, DANS CET ORDRE, et ce que chacune fait RÉELLEMENT sur le réseau (chaque image dit par quelle voie elle a été lue) :
//   1. « canvas » : l'image affichée est dessinée dans un canvas puis relue (PNG, sans perte : les pixels affichés). AUCUNE requête. Mais un canvas qui a reçu une image
//      d'une AUTRE origine (images.pikaqian.com depuis pikaqian.com) est « taché » et refuse la relecture, sauf si la page a chargé l'image en mode CORS : le plus souvent,
//      cette voie échoue sans rien envoyer — et on passe à la suivante.
//   2. « cache » : fetch de la même adresse avec `cache: 'force-cache'` DEPUIS LA PAGE. Le navigateur réutilise l'entrée du cache HTTP de la page (celle que l'affichage a
//      remplie) s'il y en a une, sans requête ; sinon il REQUÊTE, depuis TON navigateur, pendant TA visite. La lecture exige que le serveur autorise le CORS : sans cela,
//      la réponse est illisible et on passe à la suivante.
//   3. « navigateur » : GM_xmlhttpRequest vers la même adresse (images.pikaqian.com seulement, @connect). Ce n'est PAS le cache de la page : l'extension a son propre
//      contexte, donc le navigateur REQUÊTE l'image (anonyme, sans cookie), depuis TON navigateur, pendant TA visite — une requête par image, comme l'affichage de la page
//      en a fait une. C'est tout ce qui est permis : jamais le worker, jamais une autre adresse que celle de la tuile.
//   CADENCE ET ARRÊT (§17, §38) : le panneau DIT, avant le clic, la voie prévue et le nombre maximal de requêtes (2 par image, ou 0 si le canvas lit). Les voies 2 et 3 attendent au moins
//   500 ms avant chaque requête, s'ARRÊTENT au premier 403, 429 ou 5xx sans réessai (et le panneau l'affiche), et la voie 2 est abandonnée après deux échecs de suite. Redirections refusées.
//   TOUR 2 : le maximum annoncé se recalcule AU CLIC et s'affiche avant l'envoi ; l'URL FINALE de chaque réponse (finalUrl / response.url) doit être l'hôte exact des images et le même chemin,
//   sinon la lecture s'arrête (on ne compte pas sur `redirect: 'error'` seul) ; trois réponses 404 de suite arrêtent aussi la lecture (un CDN qui bloque peut répondre 404).
// · Il pose deux en-têtes au récepteur : Content-Type application/json et X-Rat-Market: rat-market-passif (le récepteur exige les deux).
// Le test statique (test-userscript-pikaqian.js) refuse toute adresse autre que 127.0.0.1 dans ce fichier et tout nom d'hôte autre que HOTE_IMAGES.
(function () {
    'use strict';
    // LE PORT du récepteur : la valeur de `--port` de recepteur-pikaqian.js (défaut 8765). Les deux changent ENSEMBLE (un test les compare).
    var PORT = 8765;
    var RECEPTEUR = 'http://127.0.0.1:' + PORT + '/apprendre';
    var RECEPTEUR_IMAGES = 'http://127.0.0.1:' + PORT + '/images';
    // le motif de code de set : celui de CODE_PK (collecte-cartes/pikaqian.js) ; un test les compare
    var CODE_DE_SET = '[a-z0-9][a-z0-9.-]{0,30}';
    var PAGE_DE_SET = new RegExp('^/sets/' + CODE_DE_SET + '$');
    // les images ne se demandent QU'À cet hôte (celui de @connect) ; plafonds = ceux du récepteur (un test les compare)
    var HOTE_IMAGES = 'images.pikaqian.com';
    var IMAGE_MAX_OCTETS = 2 * 1024 * 1024;
    var LOT_IMAGES_MAX = 10;
    var LOT_B64_MAX = 1500000;
    var UUID = /^\/cards\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

    var panneau = document.createElement('div');
    panneau.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:340px;font:13px/1.4 sans-serif;color:#111;background:#fff;border:1px solid #888;border-radius:6px;padding:8px;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    var bouton = document.createElement('button');
    bouton.textContent = 'Apprendre cette page';
    bouton.style.cssText = 'cursor:pointer;padding:4px 10px';
    var etat = document.createElement('div');
    etat.style.cssText = 'margin-top:6px;white-space:pre-wrap';
    etat.textContent = 'Rien n\'est envoyé tant que tu ne cliques pas.';
    panneau.appendChild(bouton);
    panneau.appendChild(etat);
    document.body.appendChild(panneau);

    // Un POST JSON vers le récepteur local. Résout { status, json } (json null si illisible) ; rejette { reseau: 'erreur' | 'delai' }.
    function poster(adresse, objet) {
        return new Promise(function (resoudre, rejeter) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: adresse,
                headers: { 'Content-Type': 'application/json', 'X-Rat-Market': 'rat-market-passif' },
                data: JSON.stringify(objet),
                anonymous: true,
                timeout: 30000,
                redirect: 'error',
                onload: function (r) {
                    var j = null;
                    try { j = JSON.parse(r.responseText); } catch (e) { j = null; }
                    resoudre({ status: r.status, json: j });
                },
                onerror: function () { rejeter({ reseau: 'erreur' }); },
                ontimeout: function () { rejeter({ reseau: 'delai' }); }
            });
        });
    }

    // Le DIAGNOSTIC d'une page refusée (lot PQ-PROMO) : les lignes que le récepteur a fabriquées (codes lus, dossiers des images, titre, annonce du nombre de cartes), AFFICHÉES telles quelles.
    // Rien n'est interprété ni renvoyé : seules des chaînes sont montrées, 8 lignes au plus, 300 caractères chacune. Aucune requête.
    function lignesDeDiagnostic(j) {
        var l = j && j.diagnostic && j.diagnostic.lignes, sortie = '';
        if (!Array.isArray(l)) return '';
        var gardees = l.filter(function (x) { return typeof x === 'string'; }).slice(0, 8);
        for (var i = 0; i < gardees.length; i++) sortie += '\n' + gardees[i].slice(0, 300);
        return sortie ? '\n— ce que la page portait —' + sortie : '';
    }

    function normaliser(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }

    // Les tuiles TELLES QUE LA PAGE LES AFFICHE : l'identifiant (de l'adresse de la carte), le nom (h2), le numéro (p « code · numéro »), l'image et son état de chargement.
    function lireTuilesDuDom() {
        var sortie = [];
        var ancres = document.querySelectorAll('a[href^="/cards/"]');
        for (var i = 0; i < ancres.length; i++) {
            var a = ancres[i];
            var m = UUID.exec(a.getAttribute('href') || '');
            if (!m) continue;
            var img = a.querySelector('img'), h2 = a.querySelector('h2'), p = a.querySelector('p');
            var ref = p ? String(p.textContent || '').split('·') : [];
            sortie.push({
                id: m[1],
                nom: h2 ? normaliser(h2.textContent) : '',
                numero: ref.length > 1 ? String(ref[1]).trim() : '',
                img: img || null,
                src: img ? (img.currentSrc || img.src || '') : '',
                chargee: !!(img && img.complete && img.naturalWidth > 0)
            });
        }
        return sortie;
    }

    // l'adresse d'une image à lire : https, l'hôte des images, rien d'autre
    function adresseAutorisee(src) {
        try { var u = new URL(src); return u.protocol === 'https:' && u.hostname === HOTE_IMAGES && !u.username && !u.password && !u.search && !u.hash; } catch (e) { return false; }
    }
    function enBase64(buffer) {
        var o = new Uint8Array(buffer), s = '';
        for (var i = 0; i < o.length; i += 0x8000) s += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
        return btoa(s);
    }
    var B64_MAX = Math.ceil(IMAGE_MAX_OCTETS * 4 / 3) + 4;

    // voie 1 : le canvas — aucune requête ; échoue (SecurityError) sur une image d'une autre origine non CORS
    function depuisCanvas(img) {
        try {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            var u = c.toDataURL('image/png');
            var b64 = u.slice(u.indexOf(',') + 1);
            return b64 && b64.length <= B64_MAX ? b64 : null;
        } catch (e) { return null; }
    }
    // ── LA CADENCE ET L'ARRÊT (passe B, tour 1 : §17 et §38 appliqués au navigateur du testeur) ─────────────────────────────────────────────────────
    // Une voie qui peut RÉÉMETTRE une requête (cache sans entrée, navigateur) attend au moins PAUSE_MS avant chaque requête qu'elle émet (sauf la toute première de la page), et
    // S'ARRÊTE au premier 403, 429 ou 5xx — sans réessai. La voie cache, qui échoue deux fois de suite sans rien lire (CORS refusé), est abandonnée pour la suite de la page.
    var PAUSE_MS = 500;
    var lecture = { emises: 0, cacheTentatives: 0, navigateurRequetes: 0, cacheEchecs: 0, cacheMorte: false, suite404: 0 };
    function pause(ms) { return new Promise(function (resoudre) { setTimeout(resoudre, ms); }); }
    function estArret(statut) { return statut === 403 || statut === 429 || statut >= 500; }
    // L'URL FINALE de la réponse, écrite par ce qu'elle AUTORISE : https, l'hôte exact des images, le MÊME chemin que la tuile, rien d'autre. Ne pas compter sur `redirect: 'error'` seul (un
    // gestionnaire de userscript peut l'ignorer) : une URL finale différente — ou illisible — fait de la tuile un trou et ARRÊTE la lecture.
    function urlFinaleOk(finale, src) {
        try { var u = new URL(finale), s = new URL(src); return u.protocol === 'https:' && u.hostname === HOTE_IMAGES && u.pathname === s.pathname && !u.search && !u.hash && !u.port && !u.username && !u.password; } catch (e) { return false; }
    }
    // 404 : une réponse isolée reste un trou nommé, mais TROIS de suite arrêtent la lecture comme un 403 (un CDN qui bloque peut répondre 404)
    var SUITE_404_MAX = 3;
    function arretDe(res, voie, src) {
        if (res.redirige) return { motif: 'redirection : l\'URL finale « ' + res.finale + ' » n\'est pas l\'adresse de la tuile', voie: voie, src: src };
        if (res.b64) lecture.suite404 = 0;
        else if (res.statut === 404) lecture.suite404++;
        else if (res.statut > 0) lecture.suite404 = 0;          // une AUTRE réponse HTTP interrompt la suite ; l'absence de réponse (0) ne la modifie pas
        if (lecture.suite404 >= SUITE_404_MAX) return { motif: 'trois réponses 404 de suite (un CDN qui bloque peut répondre 404)', voie: voie, src: src };
        if (estArret(res.statut)) return { statut: res.statut, voie: voie, src: src };
        return null;
    }
    function avantRequete() {
        var attente = lecture.emises > 0 ? pause(PAUSE_MS) : Promise.resolve();
        lecture.emises++;
        return attente;
    }
    // voie 2 : le cache HTTP de la page ; sinon le navigateur requête (voir l'en-tête). Illisible sans CORS. Résout { b64 } ou { echec, statut } (0 = pas de réponse lisible).
    function depuisLeCache(src) {
        return avantRequete().then(function () {
            lecture.cacheTentatives++;
            return fetch(src, { method: 'GET', mode: 'cors', cache: 'force-cache', credentials: 'omit', redirect: 'error' }).then(function (r) {
                if (!urlFinaleOk(r.url, src)) return { redirige: true, finale: String(r.url) };
                if (!r.ok) return { echec: true, statut: r.status };
                return r.arrayBuffer().then(function (ab) { return ab.byteLength > 0 && ab.byteLength <= IMAGE_MAX_OCTETS ? { b64: enBase64(ab) } : { echec: true, statut: 0 }; });
            }).catch(function () { return { echec: true, statut: 0 }; });
        });
    }
    // voie 3 : GM_xmlhttpRequest, anonyme, vers la seule adresse de la tuile (redirections refusées) — le navigateur du testeur requête, pendant sa visite
    function depuisLeNavigateur(src) {
        return avantRequete().then(function () {
            lecture.navigateurRequetes++;
            return new Promise(function (resoudre) {
                GM_xmlhttpRequest({
                    method: 'GET', url: src, responseType: 'arraybuffer', anonymous: true, timeout: 30000, redirect: 'error',
                    onload: function (r) {
                        var ab = r.response;
                        if (!urlFinaleOk(r.finalUrl, src)) resoudre({ redirige: true, finale: String(r.finalUrl) });
                        else if (r.status === 200 && ab && ab.byteLength > 0 && ab.byteLength <= IMAGE_MAX_OCTETS) resoudre({ b64: enBase64(ab) });
                        else resoudre({ echec: true, statut: r.status });
                    },
                    onerror: function () { resoudre({ echec: true, statut: 0 }); },
                    ontimeout: function () { resoudre({ echec: true, statut: 0 }); }
                });
            });
        });
    }
    // Les octets d'UNE tuile : { b64, voie } ou null (illisible). Jamais une adresse hors HOTE_IMAGES. Lève { arret } au premier 403, 429 ou 5xx.
    function lireImage(t) {
        if (!adresseAutorisee(t.src)) return Promise.resolve(null);
        var b = depuisCanvas(t.img);
        if (b) return Promise.resolve({ b64: b, voie: 'canvas' });
        var etapeCache = lecture.cacheMorte ? Promise.resolve({ echec: true, statut: 0 }) : depuisLeCache(t.src);
        return etapeCache.then(function (c) {
            if (c.b64) { lecture.cacheEchecs = 0; lecture.suite404 = 0; return { b64: c.b64, voie: 'cache' }; }
            if (!lecture.cacheMorte && ++lecture.cacheEchecs >= 2) lecture.cacheMorte = true;
            var ac = arretDe(c, 'cache', t.src);
            if (ac) throw { arret: ac };
            return depuisLeNavigateur(t.src).then(function (n) {
                var an = arretDe(n, 'navigateur', t.src);
                if (an) throw { arret: an };
                if (n.b64) return { b64: n.b64, voie: 'navigateur' };
                return null;
            });
        });
    }
    // le compte RÉEL après coup : les requêtes vers l'hôte des images (cache : 0 ou 1 chacune, selon une entrée de cache ; navigateur : 1 chacune)
    function compteReel() {
        return '\nRequêtes vers ' + HOTE_IMAGES + ' : navigateur ' + lecture.navigateurRequetes + ' · cache ' + lecture.cacheTentatives + ' lecture(s) (0 ou 1 requête chacune, au plus ' + (lecture.navigateurRequetes + lecture.cacheTentatives) + ' au total)' + (lecture.cacheMorte ? ' · voie cache abandonnée après 2 échecs' : '');
    }
    // CE QUI PARTIRA, dit AVANT le clic (aucune requête pour le dire : un essai de canvas est local). Se rafraîchit quand la souris passe sur le panneau.
    function annonce(releve) {
        var tuiles = releve || lireTuilesDuDom();
        var pretes = tuiles.filter(function (t) { return t.chargee && adresseAutorisee(t.src); });
        var n = pretes.length;
        var t = 'Rien n\'est envoyé avant ton clic.\nTuiles : ' + tuiles.length + ', dont ' + n + ' avec une image chargée (les ' + (tuiles.length - n) + ' autres ne seront pas lues : je ne défile pas).\n';
        if (!n) return t + 'Aucune image à lire : seule la page partira vers le récepteur local (127.0.0.1).';
        // chaque image chargée est essayée au canvas (local, sans requête) : la voie prévue est celle de CHACUNE, pas celle de la première
        var parCanvas = pretes.filter(function (p) { return depuisCanvas(p.img); }).length, reste = n - parCanvas;
        if (!reste) return t + 'Voie prévue : canvas — 0 requête vers ' + HOTE_IMAGES + ' (les pixels déjà affichés).';
        return t + 'Voie prévue : ' + (parCanvas ? 'canvas pour ' + parCanvas + ' image(s) (0 requête), puis ' : '') + 'cache puis navigateur pour ' + reste + ' image(s) — le canvas est refusé (image d\'une autre origine). Au plus 2 requêtes par image vers ' + HOTE_IMAGES +
            ', soit au plus ' + (2 * reste) + ' pour ' + reste + ' image(s), depuis TON navigateur ; au moins ' + PAUSE_MS + ' ms entre deux ; arrêt au premier 403, 429 ou 5xx, sans réessai ; la voie cache est abandonnée après 2 échecs de suite (alors 1 requête par image, au plus ' + reste + ').';
    }
    etat.textContent = annonce();
    panneau.addEventListener('mouseover', function () { if (!bouton.disabled) etat.textContent = annonce(); });

    async function apprendre() {
        var url = location.origin + location.pathname;
        var html = document.documentElement.outerHTML;
        lecture = { emises: 0, cacheTentatives: 0, navigateurRequetes: 0, cacheEchecs: 0, cacheMorte: false, suite404: 0 };   // les comptes et la cadence repartent à zéro à chaque clic
        // LE MAXIMUM SE RECALCULE AU CLIC (relecture X, tour 1) sur l'état de la page À CET INSTANT, s'affiche AVANT l'envoi, et c'est ce même relevé de tuiles qui sera lu : jamais plus que l'annoncé
        var tuiles = lireTuilesDuDom();
        var annonceDuClic = annonce(tuiles);
        etat.textContent = annonceDuClic + '\nEnvoi de la page au récepteur local…';
        var rep = await poster(RECEPTEUR, { url: url, html: html });
        var j = rep.json;
        if (!(j && j.ok)) {
            etat.textContent = 'Refusé (HTTP ' + rep.status + ') : ' + ((j && j.motif) || 'réponse illisible du récepteur') + lignesDeDiagnostic(j);
            return;
        }
        var entete = annonceDuClic + '\n— — —\nAppris : ' + j.code + '\n' + j.ancres + ' ancres, ' + j.tuilesLues + ' tuiles lues, ' + j.tuilesAuCode + ' au code du set\n' +
            j.officielles + ' adresse(s) officielle(s) déclarée(s) par la page (flux ' + j.flux + ')\nfichier ' + j.fichier + (j.anomalie ? '\n⚠ ' + j.anomalie : '');
        var pretes = tuiles.filter(function (t) { return t.chargee; });
        var sansImage = tuiles.length - pretes.length;
        entete += '\nImages : ' + pretes.length + ' tuile(s) chargée(s) sur ' + tuiles.length + (sansImage ? ' — ' + sansImage + ' SANS image chargée (je ne défile pas : fais défiler la page, puis reclique)' : '');
        etat.textContent = entete;
        var voies = { canvas: 0, cache: 0, navigateur: 0 }, illisibles = 0, recues = 0, refusees = 0, premierMotif = '', lot = [], tailleLot = 0, faites = 0;
        async function envoyerLot() {
            if (!lot.length) return;
            var corps = { fichier: j.fichier, images: lot, sansImage: sansImage };
            lot = []; tailleLot = 0;
            var r = await poster(RECEPTEUR_IMAGES, corps);
            if (!(r.json && r.json.ok)) throw { refus: 'HTTP ' + r.status + ' : ' + ((r.json && r.json.motif) || 'réponse illisible du récepteur') };
            recues += r.json.recues; refusees += r.json.refusees.length;
            if (r.json.refusees.length && !premierMotif) premierMotif = r.json.refusees[0].motif;
        }
        try {
            for (var i = 0; i < pretes.length; i++) {
                var t = pretes[i];
                var lue = await lireImage(t);
                faites++;
                if (!lue) { illisibles++; }
                else {
                    voies[lue.voie]++;
                    lot.push({ id: t.id, src: t.src, nom: t.nom, numero: t.numero, voie: lue.voie, b64: lue.b64 });
                    tailleLot += lue.b64.length;
                    if (lot.length >= LOT_IMAGES_MAX || tailleLot >= LOT_B64_MAX) await envoyerLot();
                }
                etat.textContent = entete + '\nLecture ' + faites + '/' + pretes.length + ' (canvas ' + voies.canvas + ', cache ' + voies.cache + ', navigateur ' + voies.navigateur + ', illisibles ' + illisibles + ')';
            }
            await envoyerLot();
            if (!pretes.length) {   // aucune image à envoyer : le récepteur retient quand même combien de tuiles n'avaient pas d'image
                etat.textContent = entete + '\nAucune image chargée à envoyer.';
                return;
            }
            etat.textContent = entete + '\nImages envoyées : ' + recues + ' reçues par le récepteur, ' + refusees + ' refusée(s)' + (premierMotif ? ' (« ' + premierMotif + ' »)' : '') +
                '\nVoies : canvas ' + voies.canvas + ', cache ' + voies.cache + ', navigateur ' + voies.navigateur + ' · illisibles ' + illisibles + ' · tuiles sans image ' + sansImage + compteReel();
        } catch (e) {
            if (e && e.arret) {
                // premier 403, 429 ou 5xx : plus AUCUNE requête, aucun réessai ; ce qui a été lu avant part quand même au récepteur
                try { await envoyerLot(); } catch (e2) { /* le récepteur ne répond plus : rien de plus à faire */ }
                etat.textContent = entete + '\n⛔ ARRÊT : ' + (e.arret.motif || 'HTTP ' + e.arret.statut) + ' (voie ' + e.arret.voie + ') — plus aucune requête vers ' + HOTE_IMAGES + ', aucun réessai. Reçues par le récepteur : ' + recues + '.' + compteReel();
            }
            else if (e && e.refus) etat.textContent = entete + '\nLe récepteur a refusé un lot d\'images (' + e.refus + ') : arrêt.';
            else if (e && e.reseau) etat.textContent = entete + '\nLe récepteur ne répond plus (' + e.reseau + ') pendant l\'envoi des images : arrêt.';
            else throw e;
        }
    }

    bouton.addEventListener('click', function () {
        if (!PAGE_DE_SET.test(location.pathname)) {
            etat.textContent = 'Cette page n\'est pas la page d\'un set (/sets/<code>) : rien n\'est envoyé.';
            return;
        }
        bouton.disabled = true;
        apprendre().then(function () { bouton.disabled = false; }, function (e) {
            bouton.disabled = false;
            if (e && e.reseau) etat.textContent = e.reseau === 'delai'
                ? 'Le récepteur ne répond pas (délai dépassé) : vérifie qu\'il tourne, puis recommence.'
                : 'Le récepteur ne répond pas : lance-le sur ce poste (voir le mode d\'emploi), puis recommence.';
            else etat.textContent = 'Erreur du script : ' + (e && e.message ? e.message : String(e));
        });
    });
})();
