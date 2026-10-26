/* OpenRoad phrasebook: what you need to say at fuel stations, garages, hotels, roadside checks and in an emergency,
   in French, Dutch and German. Shown large to show someone, and spoken by the phone. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  OR.PHRASE_LANGS = [['fr', 'French', 'fr-FR', 'France, Wallonia (south Belgium), Luxembourg'], ['nl', 'Dutch', 'nl-NL', 'Netherlands, Flanders (north Belgium)'], ['de', 'German', 'de-DE', 'Germany, Austria, east Belgium, Luxembourg']];
  // [English, French, Dutch, German]
  OR.PHRASES = [
    ['Fuel', 'fuel', [
      ['Where is the nearest petrol station?', 'Où est la station-service la plus proche ?', 'Waar is het dichtstbijzijnde tankstation?', 'Wo ist die nächste Tankstelle?'],
      ['Fill it up with 95 unleaded, please.', 'Le plein de sans plomb 95, s\'il vous plaît.', 'Graag vol met Euro 95.', 'Einmal volltanken mit Super, bitte.'],
      ['Can I pay by card?', 'Est-ce que je peux payer par carte ?', 'Kan ik met de kaart betalen?', 'Kann ich mit Karte zahlen?'],
      ['The pump won\'t take my card.', 'La pompe n\'accepte pas ma carte.', 'De pomp accepteert mijn kaart niet.', 'Die Zapfsäule nimmt meine Karte nicht an.']]],
    ['Breakdown and garage', 'wrench', [
      ['My motorbike has broken down.', 'Ma moto est en panne.', 'Ik heb pech met mijn motor.', 'Mein Motorrad hat eine Panne.'],
      ['I have a flat tyre.', 'J\'ai un pneu crevé.', 'Ik heb een lekke band.', 'Ich habe einen Platten.'],
      ['Is there a motorbike garage near here?', 'Y a-t-il un garage moto près d\'ici ?', 'Is er een motorgarage in de buurt?', 'Gibt es hier in der Nähe eine Motorradwerkstatt?'],
      ['Can you fix it today?', 'Pouvez-vous la réparer aujourd\'hui ?', 'Kunt u hem vandaag repareren?', 'Können Sie es heute reparieren?'],
      ['I need a tow truck.', 'J\'ai besoin d\'une dépanneuse.', 'Ik heb een sleepwagen nodig.', 'Ich brauche einen Abschleppwagen.']]],
    ['Hotel', 'bed', [
      ['Do you have a room for tonight?', 'Avez-vous une chambre pour cette nuit ?', 'Heeft u een kamer voor vannacht?', 'Haben Sie ein Zimmer für heute Nacht?'],
      ['Is there secure parking for motorbikes?', 'Y a-t-il un parking sécurisé pour les motos ?', 'Is er een beveiligde parkeerplaats voor motoren?', 'Gibt es einen sicheren Parkplatz für Motorräder?'],
      ['What time is breakfast?', 'À quelle heure est le petit-déjeuner ?', 'Hoe laat is het ontbijt?', 'Um wie viel Uhr gibt es Frühstück?'],
      ['Can I dry my riding gear somewhere?', 'Est-ce que je peux faire sécher mon équipement de moto quelque part ?', 'Kan ik mijn motorkleding ergens laten drogen?', 'Kann ich meine Motorradkleidung irgendwo trocknen?']]],
    ['Police and roadside checks', 'shield', [
      ['Here are my licence and documents.', 'Voici mon permis et mes papiers.', 'Hier zijn mijn rijbewijs en papieren.', 'Hier sind mein Führerschein und meine Papiere.'],
      ['The bike is registered in the UK.', 'La moto est immatriculée au Royaume-Uni.', 'De motor is in het Verenigd Koninkrijk geregistreerd.', 'Das Motorrad ist im Vereinigten Königreich zugelassen.'],
      ['Do you speak English?', 'Parlez-vous anglais ?', 'Spreekt u Engels?', 'Sprechen Sie Englisch?'],
      ['Sorry, I don\'t understand.', 'Désolé, je ne comprends pas.', 'Sorry, ik begrijp het niet.', 'Entschuldigung, ich verstehe nicht.']]],
    ['Emergency', 'helmet', [
      ['There has been an accident.', 'Il y a eu un accident.', 'Er is een ongeluk gebeurd.', 'Es hat einen Unfall gegeben.'],
      ['Please call an ambulance.', 'Appelez une ambulance, s\'il vous plaît.', 'Bel alstublieft een ambulance.', 'Bitte rufen Sie einen Krankenwagen.'],
      ['I am hurt.', 'Je suis blessé.', 'Ik ben gewond.', 'Ich bin verletzt.'],
      ['Nobody is hurt.', 'Personne n\'est blessé.', 'Er is niemand gewond.', 'Niemand ist verletzt.']]],
    ['Food and everyday', 'cup', [
      ['A table for two, please.', 'Une table pour deux, s\'il vous plaît.', 'Een tafel voor twee, alstublieft.', 'Einen Tisch für zwei, bitte.'],
      ['The bill, please.', 'L\'addition, s\'il vous plaît.', 'De rekening, alstublieft.', 'Die Rechnung, bitte.'],
      ['Where are the toilets?', 'Où sont les toilettes ?', 'Waar zijn de toiletten?', 'Wo sind die Toiletten?'],
      ['Thank you very much.', 'Merci beaucoup.', 'Dank u wel.', 'Vielen Dank.']]]];

  OR.sayIn = function (text, lang) {
    const L = OR.PHRASE_LANGS.find(l => l[0] === lang), tag = L ? L[2] : lang;
    if (OR.native && OR.native.speakIn) return OR.native.speakIn(text, tag);
    try { const u = new SpeechSynthesisUtterance(text); u.lang = tag; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { }
  };
  window.onPhraseVoice = s => { if (s === 'missing') OR.toast('This phone has no voice for that language yet. Add it in Android Settings, Text-to-speech, then try again. You can still show the words.', 8000); };

  OR.pagePhrases = function (box) {
    const lang = OR.store.get('phraseLang', 'fr'), li = OR.PHRASE_LANGS.findIndex(l => l[0] === lang) + 1, L = OR.PHRASE_LANGS[li - 1];
    box.innerHTML = '<div class="seg" id="phLang">' + OR.PHRASE_LANGS.map(l => '<button data-l="' + l[0] + '" class="' + (l[0] === lang ? 'on' : '') + '">' + l[1] + '</button>').join('') + '</div>' +
      '<p class="small muted">Used in ' + esc(L[3]) + '. Tap a phrase to see it large and hear it.</p>' +
      OR.PHRASES.map(([title, icon, list]) => '<h3 class="grp">' + esc(title) + '</h3><div class="menu">' + list.map((p, i) => '<button data-ph="' + esc(title) + '|' + i + '">' + OR.badge(icon, '#00703c') + '<span><b>' + esc(p[li]) + '</b><small>' + esc(p[0]) + '</small></span>' + ic('vol', 'chev') + '</button>').join('') + '</div>').join('');
    $$('#phLang button', box).forEach(b => b.onclick = () => { OR.store.set('phraseLang', b.dataset.l); OR.pagePhrases(box); });
    $$('[data-ph]', box).forEach(b => b.onclick = () => {
      const [t, i] = b.dataset.ph.split('|'), p = OR.PHRASES.find(x => x[0] === t)[2][+i];
      OR.sayIn(p[li], lang);
      OR.sheet('<div class="phbig"><p class="phl">' + esc(p[li]) + '</p><p class="phe">' + esc(p[0]) + '</p></div><div class="row"><button class="btn pri" id="phAgain">' + ic('vol') + 'Say it again</button></div>', s => { $('#phAgain', s).onclick = () => OR.sayIn(p[li], lang); });
    });
  };
})(window.OR);
