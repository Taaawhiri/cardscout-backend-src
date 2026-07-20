// Privacy policy served as a static page at /privacy, so the app and the Play
// Store listing can link to a real, stable URL. Plain, accurate description of
// what CardScout collects. Update LAST_UPDATED when the content changes.

const LAST_UPDATED = '18 luglio 2026';
const CONTACT_EMAIL = 'taaawhiri@gmail.com';

const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informativa sulla privacy · CardScout</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 760px; margin: 0 auto; padding: 24px 18px 64px;
         font: 16px/1.6 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
  h1 { font-size: 1.7rem; margin-bottom: 4px; }
  h2 { font-size: 1.2rem; margin-top: 32px; }
  .muted { color: #888; font-size: 0.9rem; }
  code { background: rgba(127,127,127,.15); padding: 1px 5px; border-radius: 5px; }
  ul { padding-left: 20px; }
</style>
</head>
<body>
<h1>Informativa sulla privacy — CardScout</h1>
<p class="muted">Ultimo aggiornamento: ${LAST_UPDATED}</p>

<p>CardScout è un'app per cercare, collezionare e comprare carte da gioco (Pokémon,
One Piece) tramite CardTrader, con un Pokédex e mini-giochi. Questa informativa
spiega quali dati trattiamo e perché. In breve: raccogliamo il minimo
indispensabile, non vendiamo i tuoi dati e non usiamo pubblicità o tracciamento
di terze parti.</p>

<h2>Dati che trattiamo</h2>
<ul>
  <li><strong>Account (facoltativo)</strong>: se accedi con email o Google, usiamo
      Firebase Authentication (Google) per identificarti. Trattiamo la tua email e
      un identificativo utente.</li>
  <li><strong>Notifiche push</strong>: se le attivi, salviamo il token di notifica
      (Firebase Cloud Messaging) per inviarti gli avvisi.</li>
  <li><strong>Wishlist e avvisi prezzo</strong>: le carte che segui e le soglie di
      prezzo sono salvate sul nostro backend per controllare i prezzi e avvisarti.</li>
  <li><strong>Collezione sul cloud (Premium)</strong>: se sei Premium e hai un
      account, la tua collezione viene salvata e sincronizzata su Firebase per
      ritrovarla su altri dispositivi. Senza Premium resta solo sul telefono.</li>
  <li><strong>Token CardTrader</strong>: se colleghi il tuo account CardTrader, il
      token è custodito <strong>cifrato sul tuo dispositivo</strong>. Viene inviato
      al nostro backend solo per <em>inoltrare</em> le tue richieste a CardTrader
      (ricerche e acquisti) e <strong>non viene memorizzato</strong> sui nostri
      server.</li>
  <li><strong>Scansione carte (OCR)</strong>: il riconoscimento avviene
      <strong>sul dispositivo</strong>. Le foto delle carte non vengono caricate né
      conservate.</li>
  <li><strong>Dati locali</strong>: collezione, progressi da allenatore, medaglie e
      serie giornaliera sono salvati sul tuo dispositivo (e sul cloud solo se
      Premium).</li>
</ul>

<h2>Cosa NON facciamo</h2>
<ul>
  <li>Non vendiamo né cediamo i tuoi dati a terzi.</li>
  <li>Nessuna pubblicità e nessun tracciamento pubblicitario.</li>
  <li>Non raccogliamo la posizione né i contatti.</li>
</ul>

<h2>Servizi di terze parti</h2>
<ul>
  <li><strong>Google Firebase</strong> (autenticazione, notifiche, database cloud) —
      soggetto all'informativa privacy di Google.</li>
  <li><strong>CardTrader</strong> (catalogo carte e acquisti) — le operazioni di
      acquisto avvengono sul tuo account CardTrader, soggetto alla loro informativa.</li>
</ul>

<h2>Conservazione e cancellazione</h2>
<p>Puoi scollegare CardTrader in qualsiasi momento dall'app (il token viene rimosso
dal dispositivo) e disattivare le notifiche o uscire dall'account quando vuoi.</p>
<p>Puoi <strong>eliminare il tuo account in autonomia</strong> dall'app, in
<em>Profilo → Elimina account</em>: questo cancella i dati associati al tuo
account (email, token di notifica, wishlist monitorate e collezione salvata sul
cloud) e l'account di autenticazione. In alternativa puoi scriverci all'indirizzo
qui sotto e provvederemo noi.</p>

<h2>Minori</h2>
<p>L'app non è destinata a bambini sotto l'età minima prevista dalla legge locale
per il consenso al trattamento dei dati senza autorizzazione di un genitore.</p>

<h2>Modifiche</h2>
<p>Potremmo aggiornare questa informativa; la data in alto indica l'ultima
revisione.</p>

<h2>Contatti</h2>
<p>Per qualsiasi domanda sulla privacy: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
</body>
</html>`;

module.exports = { html, LAST_UPDATED };
