/**
 * Diagram Slide Type Examples
 * Matrix, pyramid, funnel, cycle, process, and timeline slides
 */

export const DIAGRAM_SLIDE_EXAMPLES = {
  'comparison-slide': [
    {
      _variation: 'Pros and cons comparison',
      title: 'Build vs Buy Decision',
      leftTitle: 'Build In-House',
      leftBody: '- Full customization possible\\n- Complete ownership of IP\\n- Higher upfront investment\\n- Longer time to market\\n- Requires dedicated team',
      rightTitle: 'Buy Solution',
      rightBody: '- Faster deployment\\n- Lower initial cost\\n- Proven reliability\\n- Vendor dependency\\n- Limited customization',
      verdict: 'Recommended: Buy for MVP, build later',
      background: 'lime',
    },
    {
      _variation: 'Before and after transformation',
      title: 'Digital Transformation Impact',
      leftTitle: 'Before',
      leftBody: '- Manual data entry\\n- Paper-based workflows\\n- Siloed departments\\n- 2-week processing time\\n- High error rate (15%)',
      rightTitle: 'After',
      rightBody: '- Automated pipelines\\n- Digital-first processes\\n- Connected systems\\n- Same-day processing\\n- Near-zero errors (<1%)',
      background: 'mist',
    },
  ],

  'matrix-slide': [
    {
      _variation: 'SWOT analysis',
      title: 'SWOT Analysis',
      cells: [
        { title: 'Strengths', body: '- Strong brand recognition\\n- Experienced team\\n- Proprietary technology', tone: 'positive' },
        { title: 'Weaknesses', body: '- Limited market presence\\n- High operating costs\\n- Legacy systems', tone: 'negative' },
        { title: 'Opportunities', body: '- Emerging markets\\n- New partnerships\\n- Digital expansion', tone: 'positive' },
        { title: 'Threats', body: '- Increasing competition\\n- Regulatory changes\\n- Economic uncertainty', tone: 'negative' },
      ],
      background: 'lime',
    },
    {
      _variation: 'Eisenhower priority matrix',
      title: 'Priority Matrix',
      cells: [
        { title: 'Urgent + Important', body: '- Crisis management\\n- Deadline-driven projects\\n- Critical issues', tone: 'negative' },
        { title: 'Not Urgent + Important', body: '- Strategic planning\\n- Relationship building\\n- Personal development', tone: 'positive' },
        { title: 'Urgent + Not Important', body: '- Most interruptions\\n- Some meetings\\n- Some emails', tone: 'neutral' },
        { title: 'Not Urgent + Not Important', body: '- Time wasters\\n- Busy work\\n- Escapism activities', tone: 'default' },
      ],
      background: 'mist',
    },
  ],

  'pyramid-slide': [
    {
      _variation: 'Maslow hierarchy style',
      title: 'Customer Needs Hierarchy',
      levels: [
        { label: 'Delight', text: 'Unexpected positive experiences' },
        { label: 'Satisfaction', text: 'Meeting all expectations' },
        { label: 'Functionality', text: 'Product works as intended' },
        { label: 'Reliability', text: 'Consistent performance' },
        { label: 'Basic Needs', text: 'Core requirements met' },
      ],
      background: 'lime',
    },
    {
      _variation: 'Priority levels',
      title: 'Issue Priority Levels',
      levels: [
        { label: 'Critical', text: 'System down, immediate action' },
        { label: 'High', text: 'Major impact, urgent response' },
        { label: 'Medium', text: 'Moderate impact, planned fix' },
        { label: 'Low', text: 'Minor issue, backlog' },
      ],
      background: 'mist',
    },
  ],

  'funnel-slide': [
    {
      _variation: 'Sales funnel with metrics',
      title: 'Sales Pipeline',
      items: [
        { label: 'Awareness', value: '10,000', text: 'Website visitors' },
        { label: 'Interest', value: '2,500', text: 'Newsletter signups' },
        { label: 'Consideration', value: '800', text: 'Demo requests' },
        { label: 'Intent', value: '200', text: 'Proposals sent' },
        { label: 'Purchase', value: '50', text: 'Closed deals' },
      ],
      background: 'lime',
    },
    {
      _variation: 'Recruitment funnel',
      title: 'Hiring Pipeline',
      items: [
        { label: 'Applications', value: '500', text: 'Total received' },
        { label: 'Screened', value: '150', text: 'Met basic criteria' },
        { label: 'Interviewed', value: '40', text: 'Phone + onsite' },
        { label: 'Offers', value: '8', text: 'Extended offers' },
        { label: 'Hired', value: '5', text: 'Accepted and started' },
      ],
      background: 'mist',
    },
  ],

  'cycle-slide': [
    {
      _variation: 'PDCA improvement cycle',
      title: 'Continuous Improvement Cycle',
      centerLabel: 'PDCA',
      items: [
        { label: 'Plan', text: 'Identify and analyze' },
        { label: 'Do', text: 'Implement solution' },
        { label: 'Check', text: 'Evaluate results' },
        { label: 'Act', text: 'Standardize or adjust' },
      ],
      background: 'lime',
    },
    {
      _variation: 'Agile sprint cycle',
      title: 'Sprint Workflow',
      centerLabel: '2 Weeks',
      items: [
        { label: 'Planning', text: 'Define sprint goals' },
        { label: 'Development', text: 'Build features' },
        { label: 'Review', text: 'Demo to stakeholders' },
        { label: 'Retrospective', text: 'Improve process' },
      ],
      background: 'mist',
    },
    {
      _variation: 'Customer feedback loop',
      title: 'Customer Feedback Loop',
      centerLabel: 'Listen',
      items: [
        { label: 'Collect', text: 'Gather feedback' },
        { label: 'Analyze', text: 'Identify patterns' },
        { label: 'Prioritize', text: 'Rank improvements' },
        { label: 'Implement', text: 'Make changes' },
        { label: 'Communicate', text: 'Share updates' },
      ],
      background: 'lime',
    },
  ],

  'process-slide': [
    {
      _variation: 'Horizontal onboarding process',
      title: 'New Employee Onboarding',
      direction: 'horizontal',
      items: [
        { title: 'Pre-boarding', text: 'Paperwork and setup before day one' },
        { title: 'Orientation', text: 'Company intro and team meetings' },
        { title: 'Training', text: 'Role-specific skills and tools' },
        { title: 'Shadowing', text: 'Learn from experienced colleagues' },
        { title: 'Independence', text: 'Start contributing solo' },
      ],
      background: 'lime',
    },
    {
      _variation: 'Vertical project phases',
      title: 'Project Delivery Process',
      direction: 'vertical',
      items: [
        { title: 'Discovery', text: 'Understand requirements and constraints' },
        { title: 'Design', text: 'Create solution architecture' },
        { title: 'Development', text: 'Build and test components' },
        { title: 'Deployment', text: 'Release to production' },
        { title: 'Support', text: 'Monitor and maintain' },
      ],
      background: 'mist',
    },
  ],

  'timeline-slide': [
    {
      _variation: 'Company history',
      title: 'Our Journey',
      items: [
        { date: '2015', title: 'Founded', text: 'Started in a small garage' },
        { date: '2017', title: 'Series A', text: 'Raised €5M funding' },
        { date: '2019', title: 'Global Launch', text: 'Expanded to 20 countries' },
        { date: '2021', title: 'IPO', text: 'Listed on stock exchange' },
        { date: '2023', title: 'Acquisition', text: 'Merged with industry leader' },
      ],
      background: 'lime',
    },
    {
      _variation: 'Project milestones',
      title: 'Project Milestones',
      items: [
        { date: 'Jan 2024', title: 'Kickoff', text: 'Project initiated' },
        { date: 'Mar 2024', title: 'Alpha Release', text: 'Internal testing began' },
        { date: 'Jun 2024', title: 'Beta Launch', text: 'Public beta with 100 users' },
        { date: 'Sep 2024', title: 'v1.0 Release', text: 'General availability' },
      ],
      background: 'mist',
    },
    {
      // Shows the key rule: only dated events are items; the source text's
      // closing summary ("42 partners across 5 consortia") is undated, so it
      // goes in bottomSubheading — NOT as an extra dateless timeline item. Note
      // the concise slide title, too.
      _variation: 'Programme process with a summary line',
      title: 'ADRIE activities — round 1',
      items: [
        { date: 'Q1 2025', title: 'Final scheme drafted', text: 'Prepared for the open call.' },
        { date: 'Apr 2025', title: 'Call opens', text: 'Submission window starts.' },
        { date: '23 May 2025', title: 'Call closes', text: '36 proposals; 26 assessed.' },
        { date: 'Jul–Oct 2025', title: 'Research phase', text: '5 proposals funded.' },
        { date: 'Nov–Dec 2025', title: 'Phase 2 selected', text: 'Grant decisions issued.' },
        { date: 'Jan 2026', title: 'Phase 2 starts', text: 'Two-year programmes begin.' },
      ],
      bottomSubheading: '42 partners involved across the 5 consortia.',
      background: 'lime',
    },
  ],
};