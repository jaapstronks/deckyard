import { postMail } from './http.js';

/** Brevo transactional API mapping. */
export function sendBrevo(config, message) {
  return postMail('https://api.brevo.com/v3/smtp/email', {
    headers: {
      accept: 'application/json',
      'api-key': config.key,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: message.from,
      to: [message.to],
      subject: message.subject,
      htmlContent: message.html,
      ...(message.text ? { textContent: message.text } : {}),
    }),
  });
}
