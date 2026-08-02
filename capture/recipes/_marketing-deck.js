/**
 * The bilingual sample deck used by the marketing capture recipes
 * (deckyard-website `public/images/marketing/`).
 *
 * Where `_sample-content.js` is a plain three-slide deck for the docs
 * screenshots, this one exists to be *photographed*: it carries a typed slide
 * with visible structure (funnel + timeline) so the editor form has named
 * fields to show, a poll whose result is worth looking at, and the
 * follow-along invite for the join-screen shot.
 *
 * Both languages live in one deck (`i18n.versions`), so a recipe switches
 * language with `?lang=nl` / `?lang=en-GB` instead of seeding a second deck.
 * Use `en-GB`, not `en`: `normalizeLang()` only accepts the two canonical
 * presentation languages, so `?lang=en` silently falls back to the dominant
 * one. Slide ids are shared between the versions — that is what pairs a Dutch
 * slide with its English translation, and it keeps poll interaction state
 * (keyed on slide id) identical in both languages.
 *
 * Content is a fictional lemonade stand: no real people, no addresses, no
 * client data. The running joke — an ambitious marketing budget financed by
 * the founders' parents while the test panel is politely evasive about the
 * taste — is there so the numbers on the funnel and the winning poll option
 * read as a story rather than as filler.
 */

import { randomUUID } from 'node:crypto';

import {
  CAPTURE_ACCOUNT_NAME,
  deleteDecksByPrefix,
  setDisplayName,
  setUiLocale,
} from '../lib/api.js';
import {
  MARKETING_LANGS,
  MARKETING_THEME,
  seedBilingualDeck,
} from '../lib/marketing.js';

/**
 * Title prefix for the marketing sample deck, in the dominant (Dutch)
 * language. Recipes delete any deck whose title starts with this before
 * re-seeding, so re-runs stay idempotent.
 */
export const MARKETING_DECK_TITLE = 'Limonadekraam Zonnehoek';

/** English title for the same deck (stored in `i18n.versions['en-GB']`). */
export const MARKETING_DECK_TITLE_EN = 'Sunnyside Lemonade Stand';

/**
 * One entry per slide, with the content of both language versions side by
 * side. Ids are attached in {@link marketingDeckVersions} so the two versions
 * stay paired.
 *
 * `notes` is the speaker note, per language, and it is what the presenter
 * console shot photographs — a console whose notes pane says "No notes for
 * this slide" illustrates nothing. The follow-invite slide has none on
 * purpose: nobody talks over a QR code.
 *
 * @type {Array<{type: string, nl: object, 'en-GB': object, notes?: {nl: string, 'en-GB': string}}>}
 */
const SLIDE_SPECS = [
  {
    type: 'title-slide',
    notes: {
      nl:
        'Even wachten tot iedereen zit. Zeggen dat het kwartaaloverleg is en dat ' +
        'er aan het eind één besluit valt.',
      'en-GB':
        'Wait until everyone is seated. Say that this is the quarterly review and ' +
        'that one decision gets made at the end.',
    },
    nl: {
      title: 'Limonadekraam Zonnehoek',
      subheading: 'Groeiplan voor de zomer, plus een klein verzoek aan onze investeerders',
      meta: 'Kwartaaloverleg, keukentafel',
      background: 'lime',
      titleBlockAlign: 'left',
      logoCorner: 'right',
    },
    'en-GB': {
      title: 'Sunnyside Lemonade Stand',
      subheading: 'Summer growth plan, plus a small request for our investors',
      meta: 'Quarterly review, kitchen table',
      background: 'lime',
      titleBlockAlign: 'left',
      logoCorner: 'right',
    },
  },
  {
    // Managed by the server (presentationId / enabled are filled in by
    // normalizeFollowInviteSlides on save); it has no translatable fields, so
    // both versions are identical. The invite's language is not stored at all:
    // it is derived at render time from the deck's resolved language
    // (resolveDeckLang: active version first, then dominant).
    type: 'follow-invite-slide',
    nl: { presentationId: '', enabled: true },
    'en-GB': { presentationId: '', enabled: true },
  },
  {
    type: 'kpi-metrics-slide',
    notes: {
      nl: 'Drie zaterdagen, verder niets. Niet verdedigen, gewoon voorlezen.',
      'en-GB': 'Three Saturdays, nothing else. Do not defend it, just read it out.',
    },
    nl: {
      headerAlign: 'left',
      title: 'Waar we nu staan',
      subheading: 'Drie zaterdagen, één kraam, geen personeel',
      bottomSubheading: '',
      background: 'mist',
      accent: 'none',
      countUp: 'off',
      metrics: [
        { value: '38', unit: '', label: 'Bekers verkocht', note: 'Sinds de opening' },
        { value: '0,50', unit: '€', label: 'Prijs per beker', note: 'Rietje inbegrepen' },
        { value: '19', unit: '€', label: 'Omzet', note: 'Citroenen van thuis niet meegerekend' },
        { value: '3', unit: '', label: 'Vaste klanten', note: 'Twee daarvan wonen hier' },
      ],
    },
    'en-GB': {
      headerAlign: 'left',
      title: 'Where we stand',
      subheading: 'Three Saturdays, one stand, no staff',
      bottomSubheading: '',
      background: 'mist',
      accent: 'none',
      countUp: 'off',
      metrics: [
        { value: '38', unit: '', label: 'Cups sold', note: 'Since opening day' },
        { value: '0.50', unit: '€', label: 'Price per cup', note: 'Straw included' },
        { value: '19', unit: '€', label: 'Revenue', note: 'Lemons from the kitchen not counted' },
        { value: '3', unit: '', label: 'Regulars', note: 'Two of whom live here' },
      ],
    },
  },
  {
    // The shot for `editor-form-{en,nl}`: a typed slide whose form is a set of
    // named fields (label / value / description per stage), not a text box.
    type: 'funnel-slide',
    notes: {
      nl:
        'De cijfers komen van de streepjeslijst, dus ze kloppen. Blijf hangen bij ' +
        'de stap van kopen naar opdrinken; daar zit het gesprek.',
      'en-GB':
        'The numbers come off the tally sheet, so they are right. Linger on the ' +
        'step from buying to finishing; that is where the conversation is.',
    },
    nl: {
      title: 'Van voorbijganger tot vaste klant',
      subheading: 'Geteld over drie zaterdagen',
      bottomSubheading: 'De grootste sprong zit tussen kopen en opdrinken.',
      background: 'mist',
      items: [
        { label: 'Loopt of fietst langs', value: '240', text: 'Fietsers meegeteld' },
        { label: 'Kijkt naar het bord', value: '86', text: 'Het bord werkt' },
        { label: 'Koopt een beker', value: '38', text: 'Het bord werkt echt' },
        { label: 'Drinkt de beker leeg', value: '11', text: 'Hier zit onze uitdaging' },
        { label: 'Komt een keer terug', value: '3', text: '' },
      ],
    },
    'en-GB': {
      title: 'From passer-by to regular',
      subheading: 'Counted across three Saturdays',
      bottomSubheading: 'The biggest drop sits between buying and finishing.',
      background: 'mist',
      items: [
        { label: 'Walks or cycles past', value: '240', text: 'Cyclists included' },
        { label: 'Looks at the sign', value: '86', text: 'The sign works' },
        { label: 'Buys a cup', value: '38', text: 'The sign really works' },
        { label: 'Finishes the cup', value: '11', text: 'This is where our challenge lives' },
        { label: 'Comes back once', value: '3', text: '' },
      ],
    },
  },
  {
    type: 'comparison-slide',
    notes: {
      nl:
        'Links eerst helemaal voorlezen, dan pas rechts laten zien. Het tekort ' +
        'zelf noemen voordat iemand anders het doet.',
      'en-GB':
        'Read the left column out in full before showing the right one. Name the ' +
        'shortfall yourself before anyone else does.',
    },
    nl: {
      title: 'Het plan voor de zomer',
      subheading: 'Wat we willen uitgeven, en wat er in de pot zit',
      bottomSubheading: '',
      leftTitle: 'Marketingbegroting',
      leftBody:
        '- Spandoek met eigen logo: € 45,00\n' +
        '- Flyers voor de hele wijk: € 30,00\n' +
        '- Krijtbord met dagaanbieding: € 12,00\n' +
        '- Shirtsponsoring buurttoernooi: € 25,00',
      rightTitle: 'Beschikbaar eigen vermogen',
      rightBody:
        '- Omzet tot nu toe: € 19,00\n' +
        '- Spaarpot: € 6,50\n' +
        '- Statiegeld, nog in te leveren: € 2,40',
      verdict: 'Tekort € 84,10. Voorstel: een investeringsronde bij papa en mama.',
      background: 'mist',
    },
    'en-GB': {
      title: 'The plan for the summer',
      subheading: 'What we want to spend, and what is actually in the jar',
      bottomSubheading: '',
      leftTitle: 'Marketing budget',
      leftBody:
        '- Banner with our own logo: € 45.00\n' +
        '- Flyers for the whole neighbourhood: € 30.00\n' +
        '- Chalkboard for the daily special: € 12.00\n' +
        '- Shirt sponsorship, local tournament: € 25.00',
      rightTitle: 'Available own funds',
      rightBody:
        '- Revenue so far: € 19.00\n' +
        '- Savings jar: € 6.50\n' +
        '- Bottle deposits, not yet returned: € 2.40',
      verdict: 'Shortfall € 84.10. Proposal: a funding round with mum and dad.',
      background: 'mist',
    },
  },
  {
    // The slide the presenter-console shot is taken on: its notes are what the
    // console's notes pane renders, and the list slide after it is the "Next"
    // thumbnail.
    type: 'timeline-slide',
    notes: {
      nl:
        'Dit is de ambitie, niet de belofte. Augustus hangt op wie er kan fietsen ' +
        'met een volle kan - dat er meteen bij zeggen.\n\n' +
        'Daarna doorstappen naar het testpanel; niet blijven hangen in volgend jaar.',
      'en-GB':
        'This is the ambition, not the promise. August depends on who can cycle ' +
        'with a full jug - say that straight away.\n\n' +
        'Then move on to the test panel; do not get stuck on next year.',
    },
    nl: {
      title: 'Onze routekaart',
      subheading: 'Ambitieus, maar dat mag in een groeiplan',
      bottomSubheading: '',
      background: 'mist',
      items: [
        { date: 'Juli', title: 'Eigen spandoek', text: 'Zichtbaar vanaf de hoek' },
        {
          date: 'Augustus',
          title: 'Tweede kraam',
          text: 'Bij de speeltuin, mits iemand kan fietsen met een volle kan',
        },
        { date: 'September', title: 'Wijkdekkend', text: 'Vier straten, één merk' },
        {
          date: 'Volgend jaar',
          title: 'Ook ijsthee',
          text: 'Onder voorbehoud van het testpanel',
        },
      ],
    },
    'en-GB': {
      title: 'Our roadmap',
      subheading: 'Ambitious, which is allowed in a growth plan',
      bottomSubheading: '',
      background: 'mist',
      items: [
        { date: 'July', title: 'Our own banner', text: 'Visible from the corner' },
        {
          date: 'August',
          title: 'A second stand',
          text: 'By the playground, if someone can cycle with a full jug',
        },
        { date: 'September', title: 'Neighbourhood coverage', text: 'Four streets, one brand' },
        {
          date: 'Next year',
          title: 'Iced tea as well',
          text: 'Subject to test panel approval',
        },
      ],
    },
  },
  {
    type: 'list-slide',
    notes: {
      nl: 'Citaten voorlezen, de lezing eronder alleen laten staan. Werkt beter droog.',
      'en-GB':
        'Read the quotes out, leave the reading underneath on the slide. It lands ' +
        'better deadpan.',
    },
    nl: {
      headerAlign: 'left',
      title: 'Wat het testpanel zei',
      subheading: 'Letterlijke citaten, met onze eigen lezing erachter',
      variant: 'bullets',
      layout: 'auto',
      density: 'auto',
      background: 'lime',
      items: [
        { title: '“Verfrissend. Echt heel erg verfrissend.”', text: 'Er zit veel water in.' },
        { title: '“Je proeft de citroen goed.”', text: 'Er zit ook veel citroen in.' },
        { title: '“Ik neem de rest mee naar huis.”', text: 'De beker is thuis nooit aangekomen.' },
        { title: '“Voor dit weer is dit precies goed.”', text: 'Het regende.' },
      ],
    },
    'en-GB': {
      headerAlign: 'left',
      title: 'What the test panel said',
      subheading: 'Direct quotes, with our own reading underneath',
      variant: 'bullets',
      layout: 'auto',
      density: 'auto',
      background: 'lime',
      items: [
        { title: '“Refreshing. Really very refreshing.”', text: 'There is a lot of water in it.' },
        { title: '“You can really taste the lemon.”', text: 'There is a lot of lemon in it too.' },
        { title: '“I will take the rest home.”', text: 'The cup never arrived home.' },
        { title: '“Perfect for this weather.”', text: 'It was raining.' },
      ],
    },
  },
  {
    // The shot for `poll-live-{en,nl}`. The options are deliberately uneven:
    // one of them quietly wins, which is the point the deck is making.
    type: 'poll-slide',
    notes: {
      nl: 'Stemmen openzetten en stil zijn. Pas sluiten als de balken stilstaan.',
      'en-GB':
        'Open the vote and then be quiet. Only close it once the bars stop moving.',
    },
    nl: {
      pollId: '',
      question: 'Waar zetten we de investering van papa en mama op in?',
      option1: 'Een spandoek met ons logo',
      option2: 'Flyers voor de hele wijk',
      option3: 'Eerst nog even aan het recept werken',
      option4: 'Shirtsponsoring bij het buurttoernooi',
      background: 'lime',
      onClose: 'stay',
      onCloseTarget: '',
    },
    'en-GB': {
      pollId: '',
      question: 'Where do we put the investment from mum and dad?',
      option1: 'A banner with our logo',
      option2: 'Flyers for the whole neighbourhood',
      option3: 'Work on the recipe first',
      option4: 'Shirt sponsorship at the local tournament',
      background: 'lime',
      onClose: 'stay',
      onCloseTarget: '',
    },
  },
  {
    type: 'end-slide',
    notes: {
      nl: 'Het besluit hardop herhalen en dan pas naar de proeverij.',
      'en-GB': 'Repeat the decision out loud, and only then move to the tasting.',
    },
    nl: {
      title: 'Dank, en tot zaterdag',
      body:
        '- Besluit vandaag: passen we eerst het recept aan?\n' +
        '- De begroting blijft staan, alleen de volgorde verandert\n' +
        '- Proeverij om 15.00 uur, deelname vrijwillig',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      contactUrl: '',
      social1Label: '',
      social1Url: '',
      social2Label: '',
      social2Url: '',
      background: 'lime',
    },
    'en-GB': {
      title: 'Thanks, and see you Saturday',
      body:
        '- Decision today: do we fix the recipe first?\n' +
        '- The budget stands, only the order changes\n' +
        '- Tasting at 3pm, attendance voluntary',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      contactUrl: '',
      social1Label: '',
      social1Url: '',
      social2Label: '',
      social2Url: '',
      background: 'lime',
    },
  },
];

/** Index of the poll slide within {@link SLIDE_SPECS}. */
const POLL_INDEX = SLIDE_SPECS.findIndex((s) => s.type === 'poll-slide');

/**
 * Build the deck in both languages, with ids shared between the versions.
 *
 * @returns {{
 *   dominant: 'nl',
 *   titles: {nl: string, 'en-GB': string},
 *   versions: {nl: Array<object>, 'en-GB': Array<object>},
 *   slideIds: {all: string[], title: string, followInvite: string, funnel: string,
 *     timeline: string, poll: string},
 * }}
 */
export function marketingDeckVersions() {
  const ids = SLIDE_SPECS.map(() => randomUUID());
  // One poll id for both versions: the two language slides are the same poll.
  const pollId = randomUUID();

  const version = (lang) =>
    SLIDE_SPECS.map((spec, i) => {
      const content = { ...spec[lang] };
      if (spec.type === 'poll-slide') content.pollId = pollId;
      return {
        id: ids[i],
        type: spec.type,
        content,
        notes: spec.notes?.[lang] || '',
        visibility: {},
      };
    });

  const indexOfType = (type) => SLIDE_SPECS.findIndex((s) => s.type === type);

  return {
    dominant: 'nl',
    titles: { nl: MARKETING_DECK_TITLE, 'en-GB': MARKETING_DECK_TITLE_EN },
    versions: { nl: version('nl'), 'en-GB': version('en-GB') },
    slideIds: {
      all: ids,
      title: ids[indexOfType('title-slide')],
      followInvite: ids[indexOfType('follow-invite-slide')],
      funnel: ids[indexOfType('funnel-slide')],
      timeline: ids[indexOfType('timeline-slide')],
      poll: ids[POLL_INDEX],
    },
  };
}

/**
 * Remove any previously seeded marketing deck, in **either** language.
 *
 * Deleting only the Dutch title would leave every English run's deck behind:
 * the single-language English deck is titled "Sunnyside Lemonade Stand", which
 * the Dutch prefix never matches.
 *
 * @param {import('../lib/api.js').ApiClient} api
 * @returns {Promise<void>}
 */
export async function clearMarketingDecks(api) {
  await deleteDecksByPrefix(api, MARKETING_DECK_TITLE);
  await deleteDecksByPrefix(api, MARKETING_DECK_TITLE_EN);
}

/**
 * Seed the bilingual sample deck, idempotently, with the UI locale set for the
 * shot's language.
 *
 * The deck keeps its natural dominant language (`nl`) unless a shot needs
 * otherwise. Two do: the follow-invite copy and the fill-from-translation
 * direction both follow the *dominant* language rather than the viewed one, so
 * their English halves seed a deck whose dominant is `en-GB`.
 *
 * @param {import('../lib/api.js').ApiClient} api
 * @param {'nl'|'en'} lang
 * @param {{dominant?: 'nl'|'en-GB'}} [opts]
 * @returns {Promise<{deckId: string, deck: ReturnType<typeof marketingDeckVersions>}>}
 */
export async function seedMarketingDeck(api, lang, { dominant } = {}) {
  await clearMarketingDecks(api);
  await setUiLocale(api, MARKETING_LANGS[lang].uiLocale);
  await setDisplayName(api, CAPTURE_ACCOUNT_NAME);
  const deck = marketingDeckVersions();
  const deckId = await seedBilingualDeck(api, {
    title: MARKETING_DECK_TITLE,
    theme: MARKETING_THEME,
    dominant: dominant || deck.dominant,
    titles: deck.titles,
    versions: deck.versions,
  });
  return { deckId, deck };
}

/**
 * The two comment threads the `comments` shot photographs: one already
 * resolved, one still open, both on the funnel slide.
 *
 * Fictional colleagues on a reserved example domain (RFC 2606), so no address
 * in the shot can reach anyone. The names never appear as e-mail in the panel —
 * the renderer shows `authorName` and only falls back to the address for a
 * nameless comment — but they are what "is this mine?" is decided on, and
 * being someone else is what keeps the owner-only controls off the cards.
 *
 * @type {Record<'nl'|'en', import('../lib/comments-seed.js').SeedThread[]>}
 */
export const MARKETING_COMMENT_THREADS = {
  nl: [
    {
      author: { name: 'Ruben Willems', email: 'ruben@example.org' },
      body: 'De aantallen kloppen met de streepjeslijst, ik heb ze nageteld.',
      resolved: true,
      replies: [
        {
          author: { name: 'Sanne Bakker', email: 'sanne@example.org' },
          body: 'Top, dan laten we deze zo staan.',
        },
      ],
    },
    {
      author: { name: 'Sanne Bakker', email: 'sanne@example.org' },
      body: 'Kunnen we bij de stap van kopen naar opdrinken zeggen waarom het verschil zo groot is?',
      replies: [
        {
          author: { name: 'Ruben Willems', email: 'ruben@example.org' },
          body: 'Ik zet er een regel onder de trechter bij.',
        },
      ],
    },
  ],
  en: [
    {
      author: { name: 'Ruben Willems', email: 'ruben@example.org' },
      body: 'The counts match the tally sheet, I checked them again.',
      resolved: true,
      replies: [
        {
          author: { name: 'Sanne Bakker', email: 'sanne@example.org' },
          body: 'Good, then this one can stay as it is.',
        },
      ],
    },
    {
      author: { name: 'Sanne Bakker', email: 'sanne@example.org' },
      body: 'Can we say why the gap between buying and finishing is this big?',
      replies: [
        {
          author: { name: 'Ruben Willems', email: 'ruben@example.org' },
          body: 'I will add a line underneath the funnel.',
        },
      ],
    },
  ],
};

/**
 * The share link the `share-link-rules` shot lists, per language.
 *
 * The expiry is thirty days plus an hour, not thirty days flat: the dialog
 * renders `Math.floor(remaining / one day)`, so an exact thirty days is a few
 * milliseconds short by the time the page reads it and shows "29d". The extra
 * hour makes every run read "30d".
 */
export const MARKETING_SHARE_LINK = {
  nl: {
    label: 'Voor de klantreview',
    password: 'limonade2026',
    expiresAt: () => expiresInDays(30),
  },
  en: {
    label: 'For the client review',
    password: 'lemonade2026',
    expiresAt: () => expiresInDays(30),
  },
};

/**
 * ISO timestamp `days` days out, with an hour of slack so the dialog's
 * floor-to-whole-days arithmetic reports the round number.
 * @param {number} days
 * @returns {string}
 */
function expiresInDays(days) {
  const ms = days * 24 * 60 * 60 * 1000 + 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

/**
 * The vote distribution seeded for the poll shot: 47 votes, clearly uneven,
 * with the "work on the recipe first" option winning. A poll where every bar
 * is the same height proves as little as a poll with no votes at all.
 * Index matches option1..option4.
 * @type {number[]}
 */
export const MARKETING_POLL_VOTES = [6, 4, 31, 6];
