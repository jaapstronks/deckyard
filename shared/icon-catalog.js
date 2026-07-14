/**
 * Curated icon catalog (Lucide), grouped into presentation-relevant
 * categories. Drives the visual icon picker and the vendoring step.
 *
 * Every name here is validated to exist in the installed Lucide set. To add
 * icons: add the Lucide name to a category, then run `npm run vendor:lucide`
 * (or `npm install`) to copy the SVG into client/vendor/lucide-icons/.
 *
 * @typedef {{ key: string, label: string, icons: string[] }} IconCategory
 */

/** @type {IconCategory[]} */
export const ICON_CATEGORIES = [
  {
    key: 'ideas',
    label: 'Ideas & highlights',
    icons: [
      'lightbulb', 'sparkles', 'star', 'rocket', 'target', 'flag',
      'award', 'trophy', 'gem', 'crown', 'zap', 'flame',
      'heart', 'bookmark', 'thumbs-up', 'thumbs-down', 'badge-check', 'medal',
      'wand-sparkles', 'party-popper', 'goal', 'telescope',
    ],
  },
  {
    key: 'people',
    label: 'People & teams',
    icons: [
      'user', 'users', 'users-round', 'user-round', 'user-plus', 'user-check',
      'user-cog', 'user-x', 'contact', 'handshake', 'baby', 'accessibility',
      'smile', 'frown', 'meh', 'graduation-cap', 'person-standing', 'heart-handshake',
      'speech', 'hand-heart', 'book-heart',
    ],
  },
  {
    key: 'learning',
    label: 'Learning & growth',
    icons: [
      'user-round-check', 'user-round-plus', 'user-search', 'brain-circuit', 'brain-cog', 'book-open-check',
      'book-user', 'id-card', 'contact-round', 'briefcase-business', 'puzzle', 'scaling',
      'chart-no-axes-combined', 'waypoints', 'blocks', 'layers', 'shapes', 'origami',
      'drafting-compass', 'pencil-ruler', 'infinity',
    ],
  },
  {
    key: 'communication',
    label: 'Communication',
    icons: [
      'mail', 'mail-open', 'message-circle', 'message-square', 'messages-square', 'send',
      'phone', 'phone-call', 'megaphone', 'bell', 'bell-ring', 'at-sign',
      'inbox', 'rss', 'share-2', 'reply', 'forward', 'voicemail',
      'mailbox', 'speech', 'message-square-more', 'mic-vocal', 'audio-lines',
    ],
  },
  {
    key: 'civic',
    label: 'Civic & society',
    icons: [
      'vote', 'landmark', 'university', 'gavel', 'scale', 'scale-3d',
      'flag', 'flag-triangle-right', 'signpost', 'signpost-big', 'handshake', 'heart-handshake',
      'accessibility', 'blend', 'users-round', 'hand-coins', 'scroll-text', 'drama',
      'venetian-mask', 'globe',
    ],
  },
  {
    key: 'business',
    label: 'Business & finance',
    icons: [
      'chart-line', 'chart-column', 'chart-bar', 'chart-pie', 'chart-area', 'chart-no-axes-column',
      'trending-up', 'trending-down', 'briefcase', 'building', 'building-2', 'presentation',
      'dollar-sign', 'euro', 'coins', 'banknote', 'credit-card', 'wallet',
      'receipt', 'percent', 'calculator', 'scale', 'landmark', 'piggy-bank',
      'shopping-cart', 'shopping-bag', 'store', 'factory', 'gauge', 'activity',
      'radar', 'crosshair', 'chart-scatter', 'chart-spline', 'sigma',
      'gavel', 'vote', 'scroll-text',
    ],
  },
  {
    key: 'technology',
    label: 'Technology',
    icons: [
      'cpu', 'code', 'code-xml', 'terminal', 'database', 'server',
      'cloud', 'wifi', 'bluetooth', 'smartphone', 'laptop', 'monitor',
      'hard-drive', 'bug', 'git-branch', 'github', 'binary', 'network',
      'plug', 'qr-code', 'scan', 'bot', 'brain', 'circuit-board',
      'mouse-pointer-click', 'keyboard', 'memory-stick', 'router', 'webhook',
      'glasses', 'scan-eye', 'scan-face', 'view', 'focus', 'cuboid',
      'orbit', 'rotate-3d', 'webcam',
    ],
  },
  {
    key: 'files',
    label: 'Files & documents',
    icons: [
      'file', 'file-text', 'files', 'folder', 'folder-open', 'clipboard',
      'clipboard-list', 'clipboard-check', 'book', 'book-open', 'notebook', 'newspaper',
      'archive', 'paperclip', 'printer', 'save', 'copy', 'scissors',
      'pen', 'pencil', 'square-pen', 'sticky-note', 'library', 'file-check',
      'file-search', 'folder-tree', 'list', 'list-checks',
    ],
  },
  {
    key: 'arrows',
    label: 'Arrows & flow',
    icons: [
      'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-up-right', 'arrow-down-right',
      'chevron-right', 'chevrons-right', 'move', 'refresh-cw', 'repeat', 'rotate-cw',
      'undo', 'redo', 'corner-down-right', 'shuffle', 'milestone', 'route',
      'navigation', 'compass', 'git-merge', 'split', 'merge', 'workflow',
      'spline', 'signpost', 'git-fork', 'list-todo',
    ],
  },
  {
    key: 'media',
    label: 'Media',
    icons: [
      'image', 'images', 'camera', 'video', 'film', 'clapperboard',
      'music', 'headphones', 'mic', 'play', 'pause', 'volume-2',
      'speaker', 'radio', 'podcast', 'disc', 'aperture', 'circle-play',
      'square-play', 'gallery-vertical-end', 'projector',
    ],
  },
  {
    key: 'nature',
    label: 'Nature & weather',
    icons: [
      'leaf', 'tree-pine', 'trees', 'flower', 'sun', 'moon',
      'cloud-rain', 'cloud-sun', 'snowflake', 'droplet', 'droplets', 'wind',
      'sprout', 'mountain', 'waves', 'globe', 'earth', 'recycle',
      'bird', 'fish', 'sun-medium', 'thermometer', 'umbrella', 'tornado',
    ],
  },
  {
    key: 'time',
    label: 'Time',
    icons: [
      'clock', 'calendar', 'calendar-days', 'calendar-check', 'calendar-clock', 'timer',
      'hourglass', 'alarm-clock', 'watch', 'history', 'clock-alert', 'calendar-range',
    ],
  },
  {
    key: 'status',
    label: 'Status & security',
    icons: [
      'circle-check', 'circle-alert', 'circle-x', 'info', 'circle-help', 'triangle-alert',
      'ban', 'shield', 'shield-check', 'shield-alert', 'lock', 'lock-open',
      'key', 'eye', 'eye-off', 'bell-off', 'octagon-alert', 'loader',
      'check', 'x', 'plus', 'minus', 'circle-dot', 'fingerprint',
      'key-round', 'shield-question',
    ],
  },
  {
    key: 'places',
    label: 'Places & travel',
    icons: [
      'map', 'map-pin', 'plane', 'car', 'truck', 'bus',
      'train-front', 'bike', 'ship', 'anchor', 'house', 'hospital',
      'school', 'hotel', 'tent', 'fuel', 'traffic-cone', 'warehouse',
      'castle', 'church', 'tent-tree', 'university', 'mountain-snow', 'caravan',
      'sailboat',
    ],
  },
  {
    key: 'tools',
    label: 'Tools & objects',
    icons: [
      'settings', 'sliders-horizontal', 'wrench', 'hammer', 'paintbrush', 'palette',
      'ruler', 'magnet', 'flashlight', 'battery', 'package', 'box',
      'gift', 'tag', 'tags', 'ticket', 'trash-2', 'filter',
      'search', 'link', 'pin', 'cog', 'pickaxe', 'drill',
      'shovel', 'plug-zap',
    ],
  },
  {
    key: 'health',
    label: 'Health & science',
    icons: [
      'heart-pulse', 'stethoscope', 'syringe', 'pill', 'bandage', 'dna',
      'atom', 'flask-conical', 'microscope', 'test-tube', 'cross', 'dumbbell',
      'apple', 'biceps-flexed', 'beaker', 'flask-round', 'test-tube-diagonal',
    ],
  },
  {
    key: 'sports',
    label: 'Sports & body',
    icons: [
      'dumbbell', 'biceps-flexed', 'footprints', 'person-standing', 'activity', 'heart-pulse',
      'bike', 'volleyball', 'dribbble', 'goal', 'trophy', 'medal',
      'bone', 'brain', 'ear', 'eye', 'hand', 'scan-face',
      'scan-heart', 'baby', 'accessibility',
    ],
  },
  {
    key: 'food',
    label: 'Food & lifestyle',
    icons: [
      'coffee', 'cup-soda', 'utensils', 'utensils-crossed', 'pizza', 'carrot',
      'beer', 'wine', 'cake', 'cookie', 'sandwich', 'ice-cream-cone',
      'soup', 'salad', 'croissant',
    ],
  },
];

/**
 * Flat, de-duplicated list of all catalog icon names (category order).
 * @type {string[]}
 */
export const CATALOG_ICON_NAMES = [
  ...new Set(ICON_CATEGORIES.flatMap((c) => c.icons)),
];

/**
 * Extra search keywords per icon, merged into the vendored `tags.json` at
 * vendor time (see scripts/vendor-lucide.js). Lucide's own tags don't map
 * concept words (e.g. "democracy", "ethics", "talk") to the icons we'd pick
 * for them, so authors couldn't find them by intent. These aliases close that
 * gap without changing any runtime picker code.
 * @type {Record<string, string[]>}
 */
export const ICON_SEARCH_ALIASES = {
  // Civic & society
  vote: ['democracy', 'election', 'ballot', 'politics', 'referendum'],
  landmark: ['democracy', 'government', 'institution', 'parliament', 'civic', 'city'],
  university: ['city', 'education', 'institution', 'academic', 'civic'],
  gavel: ['ethics', 'ethical', 'justice', 'law', 'decision', 'ruling', 'court'],
  scale: ['ethics', 'ethical', 'justice', 'balance', 'fairness', 'law'],
  'scale-3d': ['ethics', 'ethical', 'balance', 'fairness'],
  blend: ['inclusivity', 'inclusion', 'diversity', 'mix', 'belonging'],
  accessibility: ['inclusivity', 'inclusion', 'disability', 'access'],
  'heart-handshake': ['inclusivity', 'inclusion', 'ethics', 'solidarity', 'care'],
  'users-round': ['inclusivity', 'community', 'society', 'people'],
  drama: ['ethics', 'theatre', 'roleplay', 'culture', 'perspective'],
  'venetian-mask': ['ethics', 'identity', 'anonymity', 'roleplay', 'culture'],
  'hand-coins': ['ethics', 'fairness', 'funding', 'donation'],
  // Decision
  signpost: ['decision', 'choice', 'direction', 'crossroads'],
  'signpost-big': ['decision', 'choice', 'direction', 'crossroads'],
  'git-fork': ['decision', 'branch', 'choice', 'split'],
  split: ['decision', 'choice', 'branch'],
  'list-todo': ['decision', 'options', 'checklist', 'choose'],
  // Talk / communication
  speech: ['talk', 'talking', 'conversation', 'speak', 'discuss', 'dialogue'],
  'message-circle': ['talk', 'chat', 'conversation'],
  'messages-square': ['talk', 'discussion', 'conversation'],
  'mic-vocal': ['talk', 'speech', 'speak', 'presentation'],
  'audio-lines': ['talk', 'voice', 'sound', 'speak'],
  // Village / city
  'tent-tree': ['village', 'camp', 'community', 'settlement', 'nature'],
  house: ['village', 'home', 'settlement'],
  'building-2': ['city', 'urban', 'town'],
  building: ['city', 'urban', 'town', 'office'],
  // Sport / exercise / body
  dumbbell: ['sport', 'exercise', 'fitness', 'gym', 'workout'],
  'biceps-flexed': ['exercise', 'body', 'strength', 'muscle', 'fitness'],
  footprints: ['exercise', 'walk', 'run', 'body', 'steps'],
  'person-standing': ['body', 'human', 'person'],
  volleyball: ['sport', 'ball', 'game'],
  dribbble: ['sport', 'basketball', 'ball'],
  goal: ['sport', 'football', 'soccer', 'target'],
  activity: ['exercise', 'health', 'movement', 'pulse'],
  'heart-pulse': ['exercise', 'health', 'body', 'fitness'],
  bone: ['body', 'skeleton', 'anatomy'],
  brain: ['body', 'mind', 'think', 'cognition'],
  ear: ['body', 'listen', 'hear'],
  eye: ['body', 'see', 'vision'],
  // Problem / solution
  'shield-question': ['problem', 'uncertainty', 'question'],
  puzzle: ['problem', 'solution', 'piece'],
  lightbulb: ['solution', 'idea', 'insight'],
  key: ['solution', 'answer', 'access'],
  'circle-help': ['problem', 'question', 'help'],
  'triangle-alert': ['problem', 'warning', 'issue'],
};
