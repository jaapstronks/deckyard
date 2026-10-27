// Static network imports for P9: evaluated only through the fixture worker.
import net from 'node:net';
import dgram from 'node:dgram';
import http from 'node:http';

/** Each attempt reports its error code; the harness treats any success as a
 * failed boundary. */
export async function probe() {
  const tcp = await new Promise((resolve) => {
    const s = net.connect(48471, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      resolve('CONNECTED');
    });
    s.once('error', (e) => resolve(e.code));
  });
  const udp = await new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.once('error', (e) => resolve(e.code));
    s.send('guest', 48471, '127.0.0.1', (e) => {
      s.close();
      resolve(e?.code || 'SENT');
    });
  });
  const request = await new Promise((resolve) => {
    const r = http.get('http://127.0.0.1:48471/', () => resolve('ALLOWED'));
    r.once('error', (e) => resolve(e.code));
  });
  return { tcp, udp, http: request };
}
