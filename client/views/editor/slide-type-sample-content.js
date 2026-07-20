/**
 * Sample content for each slide type to display in the slide type picker thumbnails.
 * This provides rich, visually appealing example content that helps users understand
 * what each slide type looks like when rendered.
 */

// Placeholder image URLs (using picsum for random images)
const SAMPLE_IMAGE = 'https://picsum.photos/seed/slide-picker/800/600';
const SAMPLE_IMAGE_2 = 'https://picsum.photos/seed/slide-picker-2/800/600';
const SAMPLE_IMAGE_3 = 'https://picsum.photos/seed/slide-picker-3/800/600';
const SAMPLE_IMAGE_4 = 'https://picsum.photos/seed/slide-picker-4/800/600';

export const SLIDE_TYPE_SAMPLE_CONTENT = {
  'title-slide': {
    title: 'Presentation Title',
    subheading: 'Your subheading or tagline here',
    byline: 'Presented by Your Name',
    background: 'lime',
    logoCorner: 'right',
  },

  // Note: Custom slide types (from custom/slide-types/) should define their own
  // sampleContent in the slide type definition. See getSampleContent().

  'chapter-title-slide': {
    title: 'Chapter One',
  },

  'content-slide': {
    title: 'Key Insights',
    layout: 'one-column',
    body: '- First important point with details\n- Second point that matters\n- Third supporting argument\n- Final conclusion to remember',
    background: 'lime',
  },

  'quote-slide': {
    quote: 'The best way to predict the future is to create it.',
    authorName: 'Peter Drucker',
    authorTitle: 'Management Consultant',
  },

  'lijstje-slide': {
    title: 'Our Process',
    subheading: 'How we approach every project',
    variant: 'numbers',
    layout: 'one-column',
    items: [
      { title: 'Discovery', text: 'Understanding your needs and goals' },
      { title: 'Strategy', text: 'Planning the optimal approach' },
      { title: 'Execution', text: 'Delivering exceptional results' },
      { title: 'Review', text: 'Continuous improvement' },
    ],
    background: 'lime',
  },

  'image-text-slide': {
    image: SAMPLE_IMAGE,
    caption: '',
    alt: 'Sample image',
    imageRole: 'content',
    imageSide: 'left',
    title: 'Visual Storytelling',
    body: '- Engage your audience\n- Communicate complex ideas\n- Leave a lasting impression',
    background: 'lime',
  },

  'image-slide': {
    title: 'Full Image',
    subheading: 'Beautiful visuals matter',
    image: SAMPLE_IMAGE_2,
    alt: 'Sample image',
    imageRole: 'content',
    caption: 'Caption for context',
  },

  'video-slide': {
    title: 'Video Content',
    source: '',
    background: 'mist',
    autoplay: 'off',
  },

  'poll-slide': {
    pollId: 'sample-poll',
    question: 'What do you think?',
    option1: 'Strongly agree',
    option2: 'Somewhat agree',
    option3: 'Neutral',
    option4: 'Disagree',
    background: 'lime',
  },

  'likert-slide': {
    statement: 'Rate your experience',
    labels: ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'],
    background: 'lime',
  },

  'likert-slider-slide': {
    statement: 'How satisfied are you?',
    labelLow: 'Not at all',
    labelHigh: 'Completely',
    background: 'lime',
  },

  'feedback-slide': {
    question: 'What would you improve?',
    placeholder: 'Share your thoughts...',
    background: 'lime',
  },

  // card-stack-slide: DEPRECATED — removed from picker.
  // Existing slides still render; new slides use icon-card-grid-slide.

  'icon-card-grid-slide': {
    title: 'Our Approach',
    subheading: 'What makes us different',
    items: [
      { icon: 'lightbulb', title: 'Insight', body: 'Deep understanding' },
      { icon: 'target', title: 'Focus', body: 'Clear objectives' },
      { icon: 'users', title: 'Collaboration', body: 'Working together' },
      { icon: 'trend-up', title: 'Growth', body: 'Continuous progress' },
    ],
  },

  'content-columns-slide': {
    title: 'Our Services',
    subheading: 'What we offer',
    columnCount: '2',
    // Column 1
    col1Title: 'Strategy',
    col1Text: '',
    col1Image: 'https://picsum.photos/seed/col1/400/300',
    col1ImageFit: 'cover',
    col1Alt: 'Strategy illustration',
    col1BlockCount: '2',
    col1Block1Title: 'Planning',
    col1Block1Body: 'Define goals and roadmap',
    col1Block2Title: 'Analysis',
    col1Block2Body: 'Market research insights',
    // Column 2
    col2Title: 'Design',
    col2Text: '',
    col2Image: 'https://picsum.photos/seed/col2/400/300',
    col2ImageFit: 'cover',
    col2Alt: 'Design illustration',
    col2BlockCount: '2',
    col2Block1Title: 'Creative',
    col2Block1Body: 'Visual identity and UX',
    col2Block2Title: 'Prototyping',
    col2Block2Body: 'Rapid iteration cycles',
    // Column 3
    col3Title: 'Development',
    col3Text: '',
    col3Image: 'https://picsum.photos/seed/col3/400/300',
    col3ImageFit: 'cover',
    col3Alt: 'Development illustration',
    col3BlockCount: '2',
    col3Block1Title: 'Engineering',
    col3Block1Body: 'Robust implementation',
    col3Block2Title: 'Testing',
    col3Block2Body: 'Quality assurance',
  },

  'team-cards-slide': {
    title: 'Meet the Team',
    subheading: '',
    members: [
      { image: SAMPLE_IMAGE, name: 'Jane Doe', byline: 'CEO & Founder' },
      { image: SAMPLE_IMAGE_3, name: 'John Smith', byline: 'Head of Design' },
      { image: SAMPLE_IMAGE_4, name: 'Alex Johnson', byline: 'Lead Developer' },
    ],
  },

  'logo-wall-slide': {
    title: 'Our Partners',
    subheading: 'Trusted by industry leaders',
    logos: [
      { image: 'https://picsum.photos/seed/logo1/200/80', name: 'Acme Corp', alt: 'Acme Corp logo' },
      { image: 'https://picsum.photos/seed/logo2/200/80', name: 'TechFlow', alt: 'TechFlow logo' },
      { image: 'https://picsum.photos/seed/logo3/200/80', name: 'Innovate Inc', alt: 'Innovate Inc logo' },
      { image: 'https://picsum.photos/seed/logo4/200/80', name: 'GlobalNet', alt: 'GlobalNet logo' },
      { image: 'https://picsum.photos/seed/logo5/200/80', name: 'Summit Co', alt: 'Summit Co logo' },
      { image: 'https://picsum.photos/seed/logo6/200/80', name: 'Bright Labs', alt: 'Bright Labs logo' },
    ],
  },

  'payoff-slide': {
    title: 'Thank You',
    subheading: 'Questions?',
    cta: 'Get in touch',
  },

  'freeform-slide': {
    elements: [
      {
        id: 'sample-h1',
        type: 'heading',
        x: 10,
        y: 15,
        width: 80,
        height: 15,
        zIndex: 1,
        content: 'Freeform Layout',
        fontSize: 'xl',
      },
      {
        id: 'sample-t1',
        type: 'text',
        x: 10,
        y: 35,
        width: 35,
        height: 45,
        zIndex: 0,
        content: 'Position elements freely anywhere on the canvas.',
        fontSize: 'md',
      },
      {
        id: 'sample-t2',
        type: 'text',
        x: 55,
        y: 35,
        width: 35,
        height: 45,
        zIndex: 0,
        content: 'Perfect for creative layouts that don\'t fit templates.',
        fontSize: 'md',
      },
    ],
    background: 'lime',
    snapToGrid: 'on',
  },

  'split-partner-title-slide': {
    title: 'Partnership',
    subheading: 'Working together',
    partnerLogo: '',
    background: 'lime',
  },

  'table-slide': {
    title: 'Quarterly Results',
    caption: 'All figures in thousands',
    headerRow: 'on',
    colCount: '4',
    rows: [
      { c1: 'Metric', c2: 'Q1', c3: 'Q2', c4: 'Q3' },
      { c1: 'Revenue', c2: '$120K', c3: '$185K', c4: '$240K' },
      { c1: 'Users', c2: '2,400', c3: '3,800', c4: '5,200' },
      { c1: 'Growth', c2: '+18%', c3: '+42%', c4: '+67%' },
    ],
    background: 'lime',
  },

  'chart-slide': (() => {
    const chartTypes = ['bar', 'line', 'pie'];
    const chartType = chartTypes[Math.floor(Math.random() * chartTypes.length)];
    const chartData = {
      bar: 'Quarter,Revenue\nQ1,45\nQ2,72\nQ3,89\nQ4,120',
      line: 'Month,Sales,Target\nJan,30,25\nFeb,45,40\nMar,55,50\nApr,70,60\nMay,85,75',
      pie: 'Category,Share\nProduct A,35\nProduct B,28\nProduct C,22\nProduct D,15',
    };
    return {
      title: 'Growth Metrics',
      chartType,
      data: chartData[chartType],
      showValues: 'yes',
      showLegend: 'yes',
      background: 'lime',
    };
  })(),


  'kpi-metrics-slide': {
    title: 'Key Metrics',
    metric1Value: '98%',
    metric1Label: 'Customer Satisfaction',
    metric2Value: '500+',
    metric2Label: 'Projects Completed',
    metric3Value: '24/7',
    metric3Label: 'Support Available',
    background: 'lime',
  },

  'text-blocks-slide': {
    title: 'Our Process',
    subheading: 'From concept to delivery',
    rows: [
      {
        title: '',
        color: 'yellow',
        arrow: 'down',
        blocks: [
          { title: 'Research', body: 'Understanding the challenge' },
          { title: 'Design', body: 'Creating the solution' },
          { title: 'Build', body: 'Making it real' },
        ],
      },
      {
        title: 'The Result',
        color: 'black',
        arrow: 'none',
        blocks: [
          { title: 'Launch', body: 'Going live' },
          { title: 'Measure', body: 'Tracking success' },
          { title: 'Iterate', body: 'Continuous improvement' },
        ],
      },
    ],
  },

  'follow-invite-slide': {
    enabled: true,
    title: 'Join the presentation',
    subheading: 'Scan the QR code',
  },

  'countdown-slide': {
    title: 'Break',
    durationMinutes: 5,
    durationSeconds: 0,
    background: 'dark',
  },

  'funnel-slide': {
    title: 'Sales Funnel',
    subheading: 'From awareness to conversion',
    items: [
      { label: 'Awareness', value: '10,000', text: 'Website visitors' },
      { label: 'Interest', value: '3,000', text: '30% engagement' },
      { label: 'Consideration', value: '800', text: 'Qualified leads' },
      { label: 'Conversion', value: '200', text: 'New customers' },
    ],
    background: 'mist',
  },

  'pyramid-slide': {
    title: 'Priority Pyramid',
    subheading: 'Our focus areas',
    levels: [
      { label: 'Vision', text: 'Long-term goals' },
      { label: 'Strategy', text: 'How we get there' },
      { label: 'Tactics', text: 'Day-to-day actions' },
      { label: 'Operations', text: 'Foundation' },
    ],
    background: 'mist',
  },

  'cycle-slide': {
    title: 'Feedback Loop',
    subheading: 'Continuous improvement',
    centerLabel: 'Quality',
    items: [
      { label: 'Plan', text: 'Set objectives' },
      { label: 'Do', text: 'Implement changes' },
      { label: 'Check', text: 'Measure results' },
      { label: 'Act', text: 'Standardise' },
    ],
    background: 'mist',
  },

  'gallery-slide': {
    title: 'Project Highlights',
    subheading: 'Recent work',
    layout: 'grid',
    images: [
      { src: 'https://picsum.photos/seed/gallery1/800/600', caption: 'Project Alpha', alt: '' },
      { src: 'https://picsum.photos/seed/gallery2/800/600', caption: 'Project Beta', alt: '' },
      { src: 'https://picsum.photos/seed/gallery3/800/600', caption: 'Project Gamma', alt: '' },
      { src: 'https://picsum.photos/seed/gallery4/800/600', caption: 'Project Delta', alt: '' },
    ],
    background: 'mist',
  },
};

/**
 * Get sample content for a slide type, merging with defaults if needed.
 * Checks the slide type definition for sampleContent first, then falls back to
 * the hardcoded samples in this file.
 * @param {string} type - The slide type
 * @param {object} SLIDE_TYPES - The slide type definitions
 * @param {object} [theme] - Optional theme object for theme-specific sample content
 * @returns {object} Sample content
 */
export function getSampleContent(type, SLIDE_TYPES, theme) {
  const def = SLIDE_TYPES?.[type];
  const defaults = def?.defaults || def?.defaultsByLang?.['en-GB'] || {};

  // Check for sampleContent in the slide type definition first (for custom slide types)
  // Then fall back to hardcoded samples in this file (for core slide types)
  const sample = def?.sampleContent || SLIDE_TYPE_SAMPLE_CONTENT[type];

  // Merge defaults with sample content (sample takes precedence)
  const content = {
    ...defaults,
    ...(sample || {}),
  };

  // For embed-slide, use theme's sampleEmbedUrl if provided. The field is
  // `embedUrl` (the earlier `url` key never matched, so the override was dead).
  // The picker now renders embed as a static mockup, so this only matters if a
  // non-picker caller renders the sample.
  if (type === 'embed-slide' && theme?.sampleEmbedUrl) {
    content.embedUrl = theme.sampleEmbedUrl;
  }

  return content;
}