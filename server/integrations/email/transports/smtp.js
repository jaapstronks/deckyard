import net from 'node:net';
import nodemailer from 'nodemailer';

/** SMTP with mandatory verified TLS and an overall deadline that destroys the socket.
 * The optional CA/deadline are local test seams, never environment configuration.
 */
export async function sendSmtp(config, message, { ca, deadline = 10000 } = {}) {
  let socket;
  let timeout;
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.tls === 'tls',
    requireTLS: true,
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      ...(ca ? { ca } : {}),
    },
    ...(config.user
      ? { auth: { user: config.user, pass: config.password } }
      : {}),
    connectionTimeout: deadline,
    greetingTimeout: deadline,
    socketTimeout: deadline,
    disableFileAccess: true,
    disableUrlAccess: true,
    // Keep the underlying socket so an overall timeout also ends a slow drip
    // SMTP conversation, including the TLS wrapper managed by Nodemailer.
    getSocket(options, callback) {
      socket = net.createConnection({ host: options.host, port: options.port });
      const onError = (error) => callback(error);
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.removeListener('error', onError);
        callback(null, { connection: socket });
      });
    },
  });
  try {
    const send = transport.sendMail({
      from: { address: message.from.email, name: message.from.name },
      to: { address: message.to.email, name: message.to.name },
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    await Promise.race([
      send,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          socket?.destroy();
          reject(new Error('deadline'));
        }, deadline);
      }),
    ]);
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: 'upstream',
      error: 'SMTP delivery failed or timed out',
    };
  } finally {
    clearTimeout(timeout);
    socket?.destroy();
    transport.close();
  }
}
