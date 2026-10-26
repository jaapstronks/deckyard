import { postMail } from './http.js';

/** Scaleway TEM API mapping; region has already been validated. */
export function sendScaleway(config, message) {
  return postMail(
    `https://api.scaleway.com/transactional-email/v1alpha1/regions/${config.region}/emails`,
    {
      headers: {
        'X-Auth-Token': config.key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        project_id: config.project,
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
      }),
    },
  );
}
