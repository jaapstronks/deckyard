import { bgClass, esc, BACKGROUND_FIELD } from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';

export default {
  label: 'End / Contact',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'body',
      label: 'Body (Markdown)',
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
    const hasSocial = (social1Label && social1Url) || (social2Label && social2Url);

    const contactLines = [];
    if (name) contactLines.push(`<div class="end-contact-name" data-inline-field="contactName" dir="auto">${esc(name)}</div>`);
    if (email) contactLines.push(`<div class="end-contact-item" data-inline-field="contactEmail"><a href="mailto:${esc(email)}">${esc(email)}</a></div>`);
    if (phone) contactLines.push(`<div class="end-contact-item" data-inline-field="contactPhone"><a href="tel:${esc(phone)}">${esc(phone)}</a></div>`);
    if (url) contactLines.push(`<div class="end-contact-item"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, ''))}</a></div>`);

    const socialLinks = [];
    if (social1Label && social1Url) socialLinks.push(`<a class="end-social-link" href="${esc(social1Url)}" target="_blank" rel="noopener">${esc(social1Label)}</a>`);
    if (social2Label && social2Url) socialLinks.push(`<a class="end-social-link" href="${esc(social2Url)}" target="_blank" rel="noopener">${esc(social2Label)}</a>`);

    return `
      <div class="slide slide-end ${bg}">
        <div class="slide-inner">
          <h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h2>
          ${body ? `<div class="body" data-inline-field="body" dir="auto">${markdownToSafeHtml(body)}</div>` : ''}
          ${hasContact ? `<div class="end-contact">${contactLines.join('\n')}</div>` : ''}
          ${hasSocial ? `<div class="end-social">${socialLinks.join('\n')}</div>` : ''}
        </div>
      </div>
    `;
  },
};
