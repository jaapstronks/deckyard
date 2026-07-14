/**
 * Data Slide Type Examples
 * Tables, charts, and KPI metrics
 */

export const DATA_SLIDE_EXAMPLES = {
  'kpi-metrics-slide': [{
    title: 'Key Results',
    background: 'lime',
    metrics: [
      { value: '85', unit: '%', label: 'Customer Satisfaction', delta: '+12%' },
      { value: '2.5', unit: 'M', label: 'Users Reached', delta: '+500K' },
      { value: '40', unit: '%', label: 'Cost Reduction' },
    ],
  }],

  // TABLE-SLIDE: Critical - uses rows array with c1, c2, c3... keys, NOT TSV string!
  'table-slide': [
    {
      _variation: '4-column comparison table with header',
      title: 'Regional Performance Comparison',
      caption: 'Q4 2024 results across regions',
      colCount: '4',
      headerRow: 'on',
      rows: [
        { c1: 'Region', c2: 'Revenue', c3: 'Growth', c4: 'Status' },
        { c1: 'North', c2: '2.4M', c3: '+15%', c4: 'On target' },
        { c1: 'South', c2: '1.8M', c3: '+8%', c4: 'Growing' },
        { c1: 'East', c2: '1.2M', c3: '+22%', c4: 'Exceeding' },
        { c1: 'West', c2: '2.1M', c3: '+11%', c4: 'On target' },
      ],
      background: 'lime',
    },
    {
      _variation: '3-column feature matrix',
      title: 'Feature Comparison',
      caption: 'What each plan includes',
      colCount: '3',
      headerRow: 'on',
      rows: [
        { c1: 'Feature', c2: 'Basic', c3: 'Pro' },
        { c1: 'Users', c2: '5', c3: 'Unlimited' },
        { c1: 'Storage', c2: '10 GB', c3: '100 GB' },
        { c1: 'Support', c2: 'Email', c3: '24/7 Priority' },
        { c1: 'Analytics', c2: 'Basic', c3: 'Advanced' },
      ],
      background: 'lime',
    },
    {
      _variation: '5-column benchmark table',
      title: 'International Benchmark',
      caption: 'Comparing key metrics across countries',
      colCount: '5',
      headerRow: 'on',
      rows: [
        { c1: 'Country', c2: 'Companies', c3: 'Employees', c4: 'Revenue (B)', c5: 'Growth' },
        { c1: 'Germany', c2: '~600', c3: '12,000', c4: '4.2', c5: '+8%' },
        { c1: 'Netherlands', c2: '~280', c3: '5,500', c4: '1.8', c5: '+12%' },
        { c1: 'Belgium', c2: '~150', c3: '3,200', c4: '0.9', c5: '+6%' },
      ],
      background: 'lime',
    },
  ],

  // CHART-SLIDE: Uses TSV format for data (tabs between columns, newlines between rows)
  'chart-slide': [
    {
      _variation: 'Bar chart with categories',
      title: 'Revenue by Product Line',
      subheading: 'FY 2024 breakdown',
      chartType: 'bar',
      data: 'Product\tRevenue\nElectronics\t450000\nSoftware\t380000\nServices\t290000\nAccessories\t180000',
      xLabel: 'Product Line',
      yLabel: 'Revenue',
    },
    {
      _variation: 'Line chart showing trend over time',
      title: 'Monthly Active Users',
      subheading: 'Growth trajectory 2024',
      chartType: 'line',
      data: 'Month\tUsers (K)\nJan\t120\nFeb\t135\nMar\t148\nApr\t162\nMay\t185\nJun\t210',
      xLabel: 'Month',
      yLabel: 'Users (thousands)',
    },
    {
      _variation: 'Pie chart for distribution',
      title: 'Market Share Distribution',
      subheading: 'Current competitive landscape',
      chartType: 'pie',
      data: 'Segment\tShare\nOur Company\t35\nCompetitor A\t28\nCompetitor B\t22\nOthers\t15',
    },
    {
      _variation: 'Multi-series bar chart',
      title: 'Quarterly Comparison',
      subheading: 'Year-over-year performance',
      chartType: 'bar',
      data: 'Quarter\t2023\t2024\nQ1\t1200\t1450\nQ2\t1350\t1620\nQ3\t1480\t1890\nQ4\t1550\t2100',
      xLabel: 'Quarter',
      yLabel: 'Revenue (K)',
    },
  ],
};