import { postMail } from './http.js';

// Quote and escape display names as mailbox syntax, never interpolate raw names.
const mailbox = ({ email, name }) =>
  name ? `"${name.replace(/["\\]/g, '\\$&')}" <${email}>` : email;

/** Mailgun multipart API mapping, with an explicit regional endpoint. */
export function sendMailgun(config, message) {
  const body = new FormData();
  for (const [field, value] of Object.entries({
    from: mailbox(message.from),
    to: mailbox(message.to),
    subject: message.subject,
    html: message.html,
    text: message.text,
  })) {
    if (value !== undefined) body.set(field, value);
  }
  return postMail(
    `https://api${config.region === 'eu' ? '.eu' : ''}.mailgun.net/v3/${config.domain}/messages`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${config.key}`).toString('base64')}`,
      },
      body,
    },
  );
}
