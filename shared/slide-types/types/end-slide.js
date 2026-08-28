import { bgClass, escapeHtml, BACKGROUND_FIELD } from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';

export default {
  structure: 'singleton',
  runtime: 'static',
  label: 'End / Contact',
  // `.slide-end .slide-inner` centres everything (11-end-slide.css). Declared
  // so the style panel reports the alignment that is actually in force, and so
  // picking "Left" emits a class that can beat that slide rule instead of
  // silently storing nothing. See docs/reference/text-alignment.md.
  defaultAlign: 'center',
  fields: [
    {
      key: 'title',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'body',
      label: 'Body (Markdown)',
      labelKey: 'editor.slideField.body.label',
      type: 'markdown',
      required: false,
      maxLength: 500,
    },
    {
      key: 'contactName',
      label: 'Contact name',
      type: 'string',
      required: false,
      maxLength: 80,
    },
    {
      key: 'contactEmail',
      label: 'Email',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'contactPhone',
      label: 'Phone',
      type: 'string',
      required: false,
      maxLength: 40,
    },
    {
      key: 'contactUrl',
      label: 'Website',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'social1Label',
      label: 'Social link 1 label',
      type: 'string',
      required: false,
      maxLength: 40,
      placeholder: 'e.g. LinkedIn, Mastodon, Bluesky',
    },
    {
      key: 'social1Url',
      label: 'Social link 1 URL',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'social2Label',
      label: 'Social link 2 label',
      type: 'string',
      required: false,
      maxLength: 40,
      placeholder: 'e.g. LinkedIn, Mastodon, Bluesky',
    },
    {
      key: 'social2Url',
      label: 'Social link 2 URL',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: 'Bedankt!',
      body: '',
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
      title: 'Thank you!',
      body: '',
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
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    title: 'Thank you!',
    body: '',
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
  renderHtml: (content) => {
    const bg = bgClass(content?.background);
    const body = String(content?.body || '').trim();
    const name = String(content?.contactName || '').trim();
    const email = String(content?.contactEmail || '').trim();
    const phone = String(content?.contactPhone || '').trim();
    const url = String(content?.contactUrl || '').trim();

    // Generic social links (label + url pairs)
    const social1Label = String(content?.social1Label || '').trim();
    const social1Url = String(content?.social1Url || '').trim();
    const social2Label = String(content?.social2Label || '').trim();
    const social2Url = String(content?.social2Url || '').trim();

    const hasContact = name || email || phone || url;
    const hasSocial =
      (social1Label && social1Url) || (social2Label && social2Url);

    const contactLines = [];
    if (name)
      contactLines.push(
        `<div class="end-contact-name" data-inline-field="contactName" dir="auto">${escapeHtml(name)}</div>`,
      );
    if (email)
      contactLines.push(
        `<div class="end-contact-item" data-inline-field="contactEmail"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></div>`,
      );
    if (phone)
      contactLines.push(
        `<div class="end-contact-item" data-inline-field="contactPhone"><a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></div>`,
      );
    if (url)
      contactLines.push(
        `<div class="end-contact-item"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url.replace(/^https?:\/\//, ''))}</a></div>`,
      );

    const socialLinks = [];
    if (social1Label && social1Url)
      socialLinks.push(
        `<a class="end-social-link" href="${escapeHtml(social1Url)}" target="_blank" rel="noopener">${escapeHtml(social1Label)}</a>`,
      );
    if (social2Label && social2Url)
      socialLinks.push(
        `<a class="end-social-link" href="${escapeHtml(social2Url)}" target="_blank" rel="noopener">${escapeHtml(social2Label)}</a>`,
      );

    return `
      <div class="slide slide-end ${bg}">
        <div class="slide-inner">
          <h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(content?.title)}</h2>
          ${body ? `<div class="body" data-inline-field="body" dir="auto">${markdownToSafeHtml(body)}</div>` : ''}
          ${hasContact ? `<div class="end-contact">${contactLines.join('\n')}</div>` : ''}
          ${hasSocial ? `<div class="end-social">${socialLinks.join('\n')}</div>` : ''}
        </div>
      </div>
    `;
  },
};
