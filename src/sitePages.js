// Small public pages served at / (landing) and /terms, so there's a real
// website URL to give a payment provider / merchant-of-record at signup and a
// Terms page for their review. Keep content accurate. Update LAST_UPDATED when
// the terms change.

const CONTACT_EMAIL = 'taaawhiri@gmail.com';
const LAST_UPDATED = '18 luglio 2026';

const _style = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { max-width: 820px; margin: 0 auto; padding: 28px 18px 72px;
         font: 16px/1.6 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
  h1 { font-size: 2rem; margin-bottom: 2px; }
  h2 { font-size: 1.25rem; margin-top: 34px; }
  .tag { color: #888; font-size: 1.05rem; margin-top: 0; }
  .muted { color: #888; font-size: .9rem; }
  ul { padding-left: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: 14px; margin: 18px 0; }
  .card { border: 1px solid rgba(127,127,127,.25); border-radius: 14px; padding: 14px 16px; }
  .card h3 { margin: 0 0 4px; font-size: 1rem; }
  .price { display:inline-block; border:1px solid rgba(127,127,127,.3); border-radius: 10px; padding: 8px 14px; margin-right: 10px; font-weight:600; }
  a { color: #3b82f6; }
  footer { margin-top: 40px; border-top: 1px solid rgba(127,127,127,.2); padding-top: 16px; }
`;

const landing = `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CardScout — cerca, colleziona e compra carte</title>
<style>${_style}</style>
</head><body>
<h1>CardScout</h1>
<p class="tag">Cerca, colleziona e compra vere carte da gioco (Pokémon, One Piece) tramite CardTrader.</p>

<h2>Cosa fa</h2>
<div class="grid">
  <div class="card"><h3>Ricerca &amp; acquisto</h3>Cerca tra tutte le espansioni (anche per numero carta) e compra col tuo account CardTrader.</div>
  <div class="card"><h3>Collezione &amp; wishlist</h3>Tieni traccia di collezione e wishlist con valore aggiornato ai prezzi reali di mercato.</div>
  <div class="card"><h3>Scanner carte</h3>Riconoscimento OCR dalla fotocamera (anche carte asiatiche, cercate per numero).</div>
  <div class="card"><h3>Avvisi prezzo</h3>Notifiche quando una carta scende sotto il tuo obiettivo o torna disponibile.</div>
  <div class="card"><h3>Sync sul cloud</h3>Collezione salvata sull'account e sincronizzata tra i dispositivi.</div>
  <div class="card"><h3>Pokédex &amp; giochi</h3>Un Pokédex e mini-giochi per divertirsi mentre si colleziona.</div>
</div>

<h2>Premium</h2>
<p>Alcune funzioni avanzate (avvisi prezzo illimitati, backup e sync sul cloud, statistiche
avanzate, scanner senza limiti) sono disponibili con un abbonamento Premium:</p>
<p><span class="price">€2,99 / mese</span><span class="price">€29,99 / anno</span></p>
<p class="muted">L'abbonamento si rinnova automaticamente e può essere annullato in qualsiasi
momento; l'accesso resta attivo fino a fine periodo.</p>

<footer>
  <p><a href="/privacy">Informativa sulla privacy</a> · <a href="/terms">Termini di servizio</a></p>
  <p class="muted">Contatti: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
</footer>
</body></html>`;

const terms = `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Termini di servizio · CardScout</title>
<style>${_style}</style>
</head><body>
<h1>Termini di servizio</h1>
<p class="muted">Ultimo aggiornamento: ${LAST_UPDATED}</p>

<p>Usando l'app CardScout accetti questi termini. Se non li accetti, non usare l'app.</p>

<h2>Il servizio</h2>
<p>CardScout aiuta a cercare, collezionare e comprare carte da gioco tramite CardTrader. Gli
acquisti di carte avvengono sul tuo account CardTrader e sono soggetti ai termini di CardTrader.
CardScout non è affiliato a CardTrader, Nintendo/The Pokémon Company o Bandai.</p>

<h2>Abbonamento Premium</h2>
<ul>
  <li>Il Premium sblocca funzioni avanzate ed è offerto come abbonamento mensile (€2,99) o
      annuale (€29,99).</li>
  <li>Il rinnovo è automatico a fine periodo, salvo annullamento.</li>
  <li>Puoi annullare in qualsiasi momento; l'accesso resta attivo fino alla scadenza del periodo
      già pagato.</li>
  <li>I pagamenti sono gestiti dal fornitore di pagamento indicato al momento dell'acquisto.</li>
</ul>

<h2>Rimborsi</h2>
<p>Trattandosi di contenuti/funzioni digitali attivati immediatamente, i rimborsi sono valutati
caso per caso. Per richieste scrivi a <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> entro
14 giorni dall'acquisto; eventuali diritti di recesso previsti dalla legge restano garantiti.</p>

<h2>Uso corretto</h2>
<p>Non usare l'app per scopi illeciti né tentare di comprometterne il funzionamento o quello dei
servizi collegati.</p>

<h2>Nessuna garanzia</h2>
<p>Il servizio è fornito "così com'è". I prezzi e la disponibilità delle carte provengono da terzi
e possono cambiare; non garantiamo l'assenza di interruzioni o errori.</p>

<h2>Modifiche</h2>
<p>Possiamo aggiornare questi termini; la data in alto indica l'ultima revisione.</p>

<h2>Contatti</h2>
<p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
<p><a href="/">← Home</a> · <a href="/privacy">Privacy</a></p>
</body></html>`;

module.exports = { landing, terms };
