// EN/DE strings for the tutorial world ("Beside Still Waters", world-02). Flat dotted keys, merged
// into the i18next resources in ./index.ts. The shepherd teaches CONTROLS ONLY — there is
// deliberately no mention of the hidden Spirit/flesh system anywhere here.

export const tutorialEn: Record<string, string> = {
  // -- node names --
  'node.tutorial.stillWaters': 'Still Waters',
  'node.tutorial.thicket': 'The Thicket',
  'node.tutorial.restingPlace': 'A Resting Place',
  'node.tutorial.theFold': 'The Fold',
  // fireplace reflection line (shown on the rest screen)
  'node.tutorial.restingPlace.reflect': 'The water lies still, and for a little while, so do you.',

  // -- foes --
  'enemy.bandit': 'Bandit',

  // -- shepherd guide (auto-opens on the first node; controls only) --
  'dialogue.shepherdGuide.name': 'The Shepherd',
  'dialogue.shepherdGuide.greet.line1': '“Peace, traveler. New to the road, I’d wager — your steps are careful. Bide a moment, and I’ll tell you what you need to walk it. What would you know?”',
  'dialogue.shepherdGuide.choice.travel': 'How do I travel?',
  'dialogue.shepherdGuide.choice.places': 'What are these places on the map?',
  'dialogue.shepherdGuide.choice.fight': 'What if something attacks?',
  'dialogue.shepherdGuide.choice.rest': 'Where can I rest?',
  'dialogue.shepherdGuide.choice.bye': 'I’m ready. Thank you.',
  'dialogue.shepherdGuide.choice.back': 'Ask something else',
  'dialogue.shepherdGuide.travel.line1': '“Simple enough. On the map, the places open to you will be lit. Click one to walk there. Take it slow — the path forks soon enough.”',
  'dialogue.shepherdGuide.places.line1': '“Each spot carries its own mark. A cross is a calm place to rest and tend your hurts. A sharp mark means trouble waits — best be ready for a scrap.”',
  'dialogue.shepherdGuide.places.line2': '“Further on, a heavier mark shows the hardest trial at the road’s end. And at many places you may look about — point at what catches your eye to study it, pick it up, or speak with whoever is there.”',
  'dialogue.shepherdGuide.fight.line1': '“If a bandit bars the way, you’ll face him with the cards in your hand. Each one costs energy — spend it wisely, for it is limited each turn.”',
  'dialogue.shepherdGuide.fight.line2': '“Play a card, then choose your target. When you’ve nothing more to do, end your turn and let the foe make his move. If things turn grim, you may flee. And should more than one stand against you, choose your mark with care — bring down the fiercest first.”',
  'dialogue.shepherdGuide.rest.line1': '“When you’re weary, stop at a fire. Rest there, and your wounds will mend. A shepherd learns to rest before the climb.”',

  // -- outro (the bandits are driven off) --
  'story.tutorialOutro.title': 'The Path Opens',
  'story.tutorialOutro.p1': 'You plant your staff and stand your ground as the bandits close in. They test your guard, find it firmer than they reckoned, and break — scattering into the hills with empty hands. The valley falls quiet again.',
  'story.tutorialOutro.p2': 'You have learned to read the road, to hold your ground, and to rest when the day grows long. Beyond the pasture a longer road waits — the dusty way down to Jericho. Take up your staff; the true journey is only beginning.',
  'story.tutorialOutro.attribution': '— Beside Still Waters',
}

export const tutorialDe: Record<string, string> = {
  'node.tutorial.stillWaters': 'Stille Wasser',
  'node.tutorial.thicket': 'Das Dickicht',
  'node.tutorial.restingPlace': 'Ein Rastplatz',
  'node.tutorial.theFold': 'Der Pferch',
  'node.tutorial.restingPlace.reflect': 'Das Wasser liegt still, und für einen Augenblick liegst auch du still.',

  'enemy.bandit': 'Bandit',

  'dialogue.shepherdGuide.name': 'Der Hirte',
  'dialogue.shepherdGuide.greet.line1': '„Friede, Wanderer. Neu auf dem Weg, möchte ich wetten — deine Schritte sind bedacht. Bleib einen Augenblick, und ich sage dir, was du zum Gehen brauchst. Was möchtest du wissen?“',
  'dialogue.shepherdGuide.choice.travel': 'Wie reise ich?',
  'dialogue.shepherdGuide.choice.places': 'Was sind diese Orte auf der Karte?',
  'dialogue.shepherdGuide.choice.fight': 'Was, wenn mich etwas angreift?',
  'dialogue.shepherdGuide.choice.rest': 'Wo kann ich rasten?',
  'dialogue.shepherdGuide.choice.bye': 'Ich bin bereit. Danke.',
  'dialogue.shepherdGuide.choice.back': 'Etwas anderes fragen',
  'dialogue.shepherdGuide.travel.line1': '„Ganz einfach. Auf der Karte leuchten die Orte, die dir offenstehen. Klicke einen an, um dorthin zu gehen. Lass dir Zeit — bald gabelt sich der Pfad.“',
  'dialogue.shepherdGuide.places.line1': '„Jeder Ort trägt sein eigenes Zeichen. Ein Kreuz ist ein ruhiger Platz zum Rasten und Heilen. Ein scharfes Zeichen bedeutet Ärger — sei lieber auf einen Kampf gefasst.“',
  'dialogue.shepherdGuide.places.line2': '„Weiter vorn zeigt ein schwereres Zeichen die härteste Prüfung am Ende des Weges. Und an vielen Orten kannst du dich umsehen — zeige auf das, was dir auffällt, um es zu betrachten, aufzuheben oder mit jemandem zu sprechen.“',
  'dialogue.shepherdGuide.fight.line1': '„Versperrt dir ein Bandit den Weg, stellst du dich ihm mit den Karten in deiner Hand. Jede kostet Energie — teile sie gut ein, denn pro Runde ist sie knapp.“',
  'dialogue.shepherdGuide.fight.line2': '„Spiel eine Karte und wähle dann dein Ziel. Hast du nichts mehr zu tun, beende deinen Zug und lass den Gegner ziehen. Wird es brenzlig, darfst du fliehen. Und stehen dir mehrere gegenüber, wähle dein Ziel mit Bedacht — strecke den Stärksten zuerst nieder.“',
  'dialogue.shepherdGuide.rest.line1': '„Wenn du müde bist, halt an einem Feuer. Raste dort, und deine Wunden heilen. Ein Hirte lernt, vor dem Aufstieg zu rasten.“',

  'story.tutorialOutro.title': 'Der Weg öffnet sich',
  'story.tutorialOutro.p1': 'Du stützt dich auf deinen Stab und hältst stand, als die Banditen herandrängen. Sie prüfen deine Deckung, finden sie fester als gedacht, und brechen ab — sie zerstreuen sich mit leeren Händen in die Hügel. Das Tal wird wieder still.',
  'story.tutorialOutro.p2': 'Du hast gelernt, den Weg zu lesen, dich zu behaupten und zu rasten, wenn der Tag lang wird. Jenseits der Weide wartet ein längerer Weg — die staubige Straße hinab nach Jericho. Nimm deinen Stab; die eigentliche Reise beginnt erst.',
  'story.tutorialOutro.attribution': '— An stillen Wassern',
}
