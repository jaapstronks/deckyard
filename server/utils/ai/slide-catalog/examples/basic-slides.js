/**
 * Basic Slide Type Examples
 * Content, list, quote, and image-text slides
 */

export const BASIC_SLIDE_EXAMPLES = {
  'content-slide': [{
    title: 'Key Findings',
    body: '- First important point with details\\n- Second point explaining the context\\n- Third point with specific examples\\n- Fourth point summarizing implications',
    layout: 'one-column',
    background: 'lime',
  }],

  'list-slide': [
    {
      _variation: 'one-column layout (2-4 items)',
      title: 'Four Key Principles',
      subheading: 'Guiding our approach',
      variant: 'bullets',
      layout: 'one-column',
      items: [
        { title: 'Transparency', text: 'Open communication at all levels' },
        { title: 'Collaboration', text: 'Working together across teams' },
        { title: 'Innovation', text: 'Embracing new ideas and methods' },
        { title: 'Accountability', text: 'Taking ownership of outcomes' },
      ],
      background: 'lime',
    },
    {
      _variation: 'two-column layout (5-8 items) - USE THIS FOR 5+ ITEMS',
      title: 'Project Success Factors',
      subheading: 'What we need to get right',
      variant: 'bullets',
      layout: 'two-column',
      items: [
        { title: 'Clear Goals', text: 'Well-defined objectives and KPIs' },
        { title: 'Team Alignment', text: 'Everyone understands their role' },
        { title: 'Resources', text: 'Adequate budget and tools' },
        { title: 'Timeline', text: 'Realistic deadlines with buffers' },
        { title: 'Communication', text: 'Regular updates and check-ins' },
        { title: 'Risk Management', text: 'Identifying issues early' },
      ],
      background: 'lime',
    },
    {
      _variation: 'numbered list (for ordered steps)',
      title: 'Implementation Steps',
      subheading: 'Follow in order',
      variant: 'numbers',
      layout: 'one-column',
      items: [
        { title: 'Assessment', text: 'Evaluate current state' },
        { title: 'Planning', text: 'Define the roadmap' },
        { title: 'Execution', text: 'Implement changes' },
        { title: 'Review', text: 'Measure and adjust' },
      ],
      background: 'lime',
    },
  ],

  'quote-slide': [{
    quote: 'Innovation distinguishes between a leader and a follower.',
    authorName: 'Steve Jobs',
    authorTitle: 'Co-founder, Apple Inc.',
  }],

  'image-text-slide': [{
    title: 'Our Approach',
    body: '- User-centered design process\\n- Iterative development cycles\\n- Continuous feedback integration',
    image: '',
    imageSide: 'right',
    background: 'lime',
  }],

  'gallery-slide': [{
    title: 'Product Screenshots',
    subheading: 'The dashboard at a glance',
    layout: 'masonry',
    images: [
      { src: '', caption: 'Overview dashboard', alt: 'Dashboard overview screen' },
      { src: '', caption: 'Report builder', alt: 'Report builder screen' },
      { src: '', caption: 'Team settings', alt: 'Team settings screen' },
    ],
    background: 'mist',
  }],

  'timeline-slide': [{
    title: 'Project Roadmap',
    subheading: '2024-2025 Development Phases',
    items: [
      { date: 'Q1 2024', title: 'Foundation', text: 'Research and planning phase' },
      { date: 'Q2 2024', title: 'Development', text: 'Building core features' },
      { date: 'Q3 2024', title: 'Testing', text: 'Quality assurance and refinement' },
      { date: 'Q4 2024', title: 'Launch', text: 'Public release and marketing' },
    ],
    background: 'mist',
  }],
};