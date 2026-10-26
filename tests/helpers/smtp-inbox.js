/** Local SMTP protocol fixture, never used by production. Captures MIME in memory. */
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Create a private ephemeral certificate; trust is passed only to the test adapter. */
export function smtpCertificate() {
  const dir = mkdtempSync(path.join(tmpdir(), 'deckyard-smtp-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        `${dir}/key.pem`,
        '-out',
        `${dir}/cert.pem`,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    return {
      key: readFileSync(`${dir}/key.pem`),
      cert: readFileSync(`${dir}/cert.pem`),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Minimal test inbox supporting implicit TLS and STARTTLS. */
export async function smtpInbox({
  certificate,
  mode = 'tls',
  reject = false,
  stall = false,
  auth = false,
} = {}) {
  const messages = [];
  const commands = [];
  const sockets = new Set();
  function track(socket) {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  }
  function conversation(socket, greeting = true) {
    track(socket);
    if (greeting && !stall) socket.write('220 localhost test inbox\r\n');
    if (stall) return;
    let buffer = '';
    let data = false;
    let body = '';
    let authorized = !auth;
    function onData(chunk) {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === '.') {
            data = false;
            messages.push(body);
            socket.write(reject ? '550 rejected\r\n' : '250 accepted\r\n');
          } else body += `${line}\r\n`;
          continue;
        }
        commands.push(line.split(' ')[0]);
        if (/^EHLO|^HELO/.test(line)) {
          socket.write(
            mode === 'starttls' && !socket.encrypted
              ? '250-localhost\r\n250 STARTTLS\r\n'
              : auth
                ? '250-localhost\r\n250 AUTH PLAIN\r\n'
                : '250 localhost\r\n',
          );
        } else if (line === 'STARTTLS') {
          if (mode !== 'starttls') {
            socket.write('500 unsupported\r\n');
            continue;
          }
          socket.write('220 upgrade\r\n');
          socket.removeListener('data', onData);
          const secure = new tls.TLSSocket(socket, {
            isServer: true,
            secureContext: tls.createSecureContext(certificate),
          });
          conversation(secure, false);
          return;
        } else if (line.startsWith('AUTH PLAIN ')) {
          authorized =
            socket.encrypted &&
            Buffer.from(line.slice(11), 'base64').toString() ===
              '\0test-user\0test-password';
          socket.write(
            authorized
              ? '235 authenticated\r\n'
              : '535 invalid credentials\r\n',
          );
        } else if (line.startsWith('MAIL FROM:') && !authorized) {
          socket.write('530 authentication required\r\n');
        } else if (line === 'DATA') {
          data = true;
          socket.write('354 send data\r\n');
        } else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    }
    socket.on('data', onData);
  }
  const server =
    mode === 'tls'
      ? tls.createServer(certificate, conversation)
      : net.createServer(conversation);
  server.on('tlsClientError', () => {});
  // Also track sockets that fail before TLS negotiation completes.
  server.on('connection', track);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    messages,
    commands,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
