/**
 * Slide Types Prompt Builder (V1 generation + append)
 *
 * Builds a prompt section describing all available slide types.
 * Delegates to the AI catalog (server/utils/ai/slide-catalog/) for the prose —
 * description, bestFor, notFor — of types that have a catalog entry; a type
 * without one still appears, described by its schema alone.
 *
 * The content schema is never taken from the catalog: it is derived from the
 * type definition's `fields[]` (deriveAgentSchema), so the prompt cannot drift
 * from what the editor validates and the renderer reads.
 *
 * This ensures that catalog improvements (bestFor, notFor, description)
 * automatically flow to both v1 (single-pass) and v2 (two-phase) generation.
 */

import { SLIDE_TYPES } from '../../../shared/slide-types.js';
import { SLIDE_TYPE_CATALOG } from '../ai/slide-type-catalog.js';
import { getSlideTypeExamples } from '../ai/slide-catalog/examples.js';
import { isAgentOptOut, deriveAgentSchema } from '../ai/slide-catalog/agent-catalog.js';

function stableSlideTypeEntries() {
  return Object.entries(SLIDE_TYPES || {});
}

function jsonExample(v) {
  return JSON.stringify(v, null, 2);
}

// ─── Manual JSON examples for types that need specific patterns ───
// These override both catalog examples AND defaults-based examples.
//
// Sparse on purpose: only types whose shape a catalog example gets wrong. It is
// still a hand-maintained per-type list, so it is exported for the companion
// matrix (tests/slide-type-companion-coverage.test.js), which fails if an
// override outlives the type it overrides.
export const MANUAL_EXAMPLES = {
  'team-cards-slide': (placeholder) => ({
    type: 'team-cards-slide',
    content: {
      title: 'Team',
      subheading: 'Names & roles',
      members: [
        { image: '', name: 'Alice Example', byline: 'Product manager' },
        { image: '', name: 'Bob Example', byline: 'CTO' },
        { image: '', name: 'Chloë Example', byline: 'Designer' },
        { image: '', name: 'Diego Example', byline: 'Partnerships' },
      ],
    },
  }),

  'logo-wall-slide': (placeholder) => ({
    type: 'logo-wall-slide',
    content: {
      title: 'Partners',
      subheading: '',
      logos: [
        { image: '', name: 'Partner A' },
        { image: '', name: 'Partner B' },
        { image: '', name: 'Partner C' },
        { image: '', name: 'Partner D' },
        { image: '', name: 'Partner E' },
        { image: '', name: 'Partner F' },
      ],
    },
  }),

  'table-slide': (placeholder) => ({
    type: 'table-slide',
    content: {
      title: 'Comparison',
      caption: 'Source: user prompt',
      headerRow: 'on',
      colCount: '3',
      rows: [
        { c1: 'Item', c2: 'Value', c3: 'Notes' },
        { c1: 'A', c2: '10', c3: '…' },
        { c1: 'B', c2: '25', c3: '…' },
      ],
      background: 'mist',
    },
  }),

  'image-text-slide': (placeholder) => ({
    type: 'image-text-slide',
    content: {
      title: 'Key message',
      body: '- Point one\n- Point two\n- TODO: replace image',
      image: placeholder,
      caption: '',
      imageSide: 'right',
      background: 'mist',
    },
  }),

  'poll-slide': (placeholder) => ({
    type: 'poll-slide',
    content: {
      question: 'Which option fits best?',
      option1: 'Option A',
      option2: 'Option B',
      option3: 'Option C',
      option4: '',
      background: 'lime',
    },
  }),

  'likert-slide': (placeholder) => ({
    type: 'likert-slide',
    content: {
      question: 'I found this session useful.',
      option1: 'Strongly disagree',
      option2: 'Disagree',
      option3: 'Neutral',
      option4: 'Agree',
      option5: 'Strongly agree',
      option6: '', option7: '', option8: '', option9: '', option10: '',
      background: 'lime',
    },
  }),

  'likert-slider-slide': (placeholder) => ({
    type: 'likert-slider-slide',
    content: {
      question: 'Rate your confidence (1-10).',
      minLabel: 'Not confident',
      maxLabel: 'Very confident',
      background: 'lime',
    },
  }),

  'feedback-slide': (placeholder) => ({
    type: 'feedback-slide',
    content: {
      question: 'What should we improve next?',
      placeholder: 'Type your feedback…',
      background: 'lime',
    },
  }),

  'chart-slide': (placeholder) => ({
    type: 'chart-slide',
    content: {
      title: 'Community engagement (index) and call traffic',
      subheading: 'Quarterly trend (indicative)',
      chartType: 'line',
      data: 'Quarter,CommunityIndex,CallTrafficK\n2026-Q1,32,18\n2026-Q2,38,24\n2026-Q3,41,20\n2026-Q4,46,28',
      xLabel: 'Quarter',
      yLabel: '',
      series1Label: 'Community index',
      series2Label: 'Call traffic (x1000)',
      showLegend: 'yes',
      showValues: 'no',
      pieLabelMode: '%',
      background: 'lime',
    },
  }),

  'funnel-slide': (placeholder) => ({
    type: 'funnel-slide',
    content: {
      title: 'Sales Funnel',
      subheading: 'Q4 conversion rates',
      stages: [
        { label: 'Awareness', value: '10,000', text: 'Website visitors' },
        { label: 'Interest', value: '3,000', text: '30% engagement rate' },
        { label: 'Consideration', value: '800', text: 'Qualified leads' },
        { label: 'Conversion', value: '200', text: 'New customers' },
      ],
      background: 'mist',
    },
  }),

  'pyramid-slide': (placeholder) => ({
    type: 'pyramid-slide',
    content: {
      title: 'Priority Pyramid',
      subheading: 'Strategic focus areas',
      levels: [
        { label: 'Vision', text: 'Long-term goals and mission' },
        { label: 'Strategy', text: 'How we achieve the vision' },
        { label: 'Tactics', text: 'Day-to-day actions and initiatives' },
        { label: 'Operations', text: 'Foundation and infrastructure' },
      ],
      background: 'mist',
    },
  }),

  'cycle-slide': (placeholder) => ({
    type: 'cycle-slide',
    content: {
      title: 'Continuous Improvement',
      subheading: 'PDCA methodology',
      centerLabel: 'Quality',
      stages: [
        { label: 'Plan', text: 'Set objectives and targets' },
        { label: 'Do', text: 'Implement the changes' },
        { label: 'Check', text: 'Measure and analyse results' },
        { label: 'Act', text: 'Standardise or adjust' },
      ],
      background: 'mist',
    },
  }),

  'gallery-slide': (placeholder) => ({
    type: 'gallery-slide',
    content: {
      title: 'Project Highlights',
      subheading: 'Recent work',
      layout: 'grid',
      images: [
        { src: placeholder, caption: 'Project Alpha', alt: '' },
        { src: placeholder, caption: 'Project Beta', alt: '' },
        { src: placeholder, caption: 'Project Gamma', alt: '' },
        { src: placeholder, caption: 'Project Delta', alt: '' },
      ],
      background: 'mist',
    },
  }),
};

/**
 * Build a prompt section for a type using its AI catalog entry.
 * Returns formatted lines with description, bestFor, and schema example.
 */
function buildCatalogTypePrompt(type, catalogEntry) {
  const lines = [];

  // Description (trimmed, from catalog)
  if (catalogEntry.description) {
    lines.push(catalogEntry.description.trim());
  }

  // Best for
  if (catalogEntry.bestFor?.length) {
    lines.push('BEST FOR:');
    for (const item of catalogEntry.bestFor) {
      lines.push(`  - ${item}`);
    }
  }

  // Not for
  if (catalogEntry.notFor?.length) {
    lines.push('NOT FOR:');
    for (const item of catalogEntry.notFor) {
      lines.push(`  - ${item}`);
    }
  }

  return lines;
}

/**
 * Render the derived agent schema as compact prompt lines.
 *
 * One renderer for every type: the shape always comes from deriveAgentSchema()
 * (the definition's `fields[]`), never from a hand-written copy in the catalog.
 * Before this, a documented type was rendered from the catalog's `schema` and an
 * undocumented one from its raw `fields[]` — two formats, and the raw one listed
 * legacy mirror fields the agent should never fill.
 *
 * @param {Object<string, object>} schema - Output of deriveAgentSchema().
 * @returns {string[]}
 */
function compactAgentSchema(schema) {
  const lines = [];
  for (const [key, fieldDef] of Object.entries(schema || {})) {
    if (fieldDef.type === 'array') {
      const itemFields = fieldDef.itemSchema
        ? Object.keys(fieldDef.itemSchema).join(', ')
        : '';
      lines.push(
        `- ${key}: array[${fieldDef.minItems || 1}-${fieldDef.maxItems || '?'}]` +
          `${itemFields ? ` of { ${itemFields} }` : ''}`
      );
    } else if (fieldDef.type === 'enum') {
      lines.push(`- ${key}: enum = ${(fieldDef.options || []).join('|')}`);
    } else {
      const req = fieldDef.required ? 'required' : 'optional';
      lines.push(`- ${key}: ${fieldDef.type || 'string'} (${req})`);
    }
  }
  return lines;
}

export function buildSlideTypesPrompt({
  preferredPlaceholderImage = '/assets/images/backgrounds/demo-aurora.jpg',
  disabledSlideTypes = [],
  customSlideTypes = [],
} = {}) {
  const lines = [];
  const disabled = new Set(Array.isArray(disabledSlideTypes) ? disabledSlideTypes : []);

  lines.push('SLIDE TYPE CATALOG (use exact "type" strings; content must match the schemas):');
  lines.push('');

  for (const [type, def] of stableSlideTypeEntries()) {
    // Types withheld from agents (deprecated, app-managed, an alias, a gated
    // escape hatch) declare that on the definition itself — see
    // isAgentOptOut(). This used to be a hand-maintained list here, which is
    // how it drifted from the MCP layer's view of the same question.
    if (isAgentOptOut(def)) continue;
    if (disabled.has(type)) continue;

    const label = typeof def?.label === 'string' ? def.label : '';
    lines.push(`=== ${type}${label ? ` - ${label}` : ''} ===`);

    // Check if this type has a catalog entry with rich description
    const catalogEntry = SLIDE_TYPE_CATALOG[type];

    if (catalogEntry) {
      // Use catalog's rich description, bestFor, notFor
      const catalogLines = buildCatalogTypePrompt(type, catalogEntry);
      lines.push(...catalogLines);
    }
    // No catalog entry: the type still appears, described by its field-derived
    // schema below. Undocumented beats invisible.

    // Schema: always derived from the definition. A catalog entry contributes
    // the prose above and nothing about the shape.
    const schemaLines = compactAgentSchema(deriveAgentSchema(def?.fields));
    if (schemaLines.length) {
      lines.push('Content schema:');
      lines.push(...schemaLines);
    } else {
      lines.push('Content schema: (no fields)');
    }

    // JSON example: manual override > catalog examples > defaults
    if (MANUAL_EXAMPLES[type]) {
      lines.push('JSON example:');
      lines.push(jsonExample(MANUAL_EXAMPLES[type](preferredPlaceholderImage)));
    } else {
      // Use catalog examples if available
      const examples = getSlideTypeExamples(type);
      if (examples?.length) {
        lines.push('JSON example:');
        const cleanExample = { ...examples[0] };
        delete cleanExample._variation;
        lines.push(jsonExample({ type, content: cleanExample }));
      } else {
        // Last resort: defaults
        lines.push('JSON example (based on defaults):');
        lines.push(jsonExample({
          type,
          content: def?.defaults && typeof def.defaults === 'object' ? def.defaults : {},
        }));
      }
    }

    lines.push('');
  }

  // Custom slide types (org-specific)
  if (Array.isArray(customSlideTypes) && customSlideTypes.length > 0) {
    lines.push('');
    lines.push('CUSTOM SLIDE TYPES (organization-specific):');
    lines.push('');
    for (const ct of customSlideTypes) {
      const typeKey = `custom-${ct.slug}`;
      if (disabled.has(typeKey)) continue;
      const ctLabel = ct.label || ct.slug || 'Custom type';
      lines.push(`=== ${typeKey} - ${ctLabel} ===`);
      lines.push('When to use:');
      lines.push(`- Use for content that matches the "${ctLabel}" template.`);
      if (ct.baseType) lines.push(`- Based on: ${ct.baseType}`);
      // Same derivation as core and as tier2Entry() in the MCP layer: a Tier-2
      // type is a different storage shape, not a different contract.
      const schemaLines = compactAgentSchema(deriveAgentSchema(ct.fields));
      if (schemaLines.length) {
        lines.push('Content schema:');
        lines.push(...schemaLines);
      }
      lines.push('JSON example (based on defaults):');
      lines.push(jsonExample({
        type: typeKey,
        content: ct.defaults && typeof ct.defaults === 'object' ? ct.defaults : {},
      }));
      lines.push('');
    }
  }

  lines.push('IMPORTANT: Do NOT output "follow-invite-slide"; the app manages that automatically.');

  return lines.join('\n');
}
