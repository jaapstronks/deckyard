#!/usr/bin/env node
/**
 * Load test script to simulate concurrent voting from multiple clients.
 * Tests whether SSE messages get corrupted when many clients vote at once.
 *
 * Usage:
 *   1. Start the server locally (npm start or similar)
 *   2. Open a presentation with a poll/likert slide in your browser
 *   3. Copy the presentation ID from the URL (e.g., "my-deck" from /present/my-deck)
 *   4. Run: node scripts/test-concurrent-votes.js <presentationId> [numClients]
 *
 * Example:
 *   node scripts/test-concurrent-votes.js my-presentation 15
 */

import http from 'http';
import https from 'https';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4177';
const PRESENTATION_ID = process.argv[2];
const NUM_CLIENTS = parseInt(process.argv[3], 10) || 15;
const VOTE_ROUNDS = parseInt(process.argv[4], 10) || 3;

if (!PRESENTATION_ID) {
  console.error('Usage: node scripts/test-concurrent-votes.js <presentationId> [numClients] [voteRounds]');
  console.error('');
  console.error('Make sure you have:');
  console.error('  1. The server running locally');
  console.error('  2. A presentation open in presenter mode');
  console.error('  3. Navigated to a poll or likert slide');
  process.exit(1);
}

const isHttps = BASE_URL.startsWith('https');
const httpModule = isHttps ? https : http;

// Stats tracking
const stats = {
  votesSent: 0,
  votesSucceeded: 0,
  votesFailed: 0,
  sseMessagesReceived: 0,
  sseParseErrors: 0,
  sseCorruptedData: [],
  sseConnected: false,
  lastTotals: null,
  lastTotalsFromVote: null,
};

// Helper to make HTTP requests
function request(method, path, body = null, cookies = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (cookies) {
      options.headers['Cookie'] = cookies;
    }
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = httpModule.request(options, (res) => {
      let data = '';
      const setCookie = res.headers['set-cookie'];
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: data ? JSON.parse(data) : null,
            cookies: setCookie,
          });
        } catch (e) {
          resolve({ status: res.statusCode, data, cookies: setCookie, parseError: e });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Extract device cookie from Set-Cookie header
function extractDeviceCookie(setCookieHeaders) {
  if (!setCookieHeaders) return null;
  for (const cookie of setCookieHeaders) {
    const match = cookie.match(/sb_int=([^;]+)/);
    if (match) return `sb_int=${match[1]}`;
  }
  return null;
}

// Create a simulated client
async function createClient(clientId) {
  // First request to get device cookie
  const res = await request('GET', `/api/follow/${encodeURIComponent(PRESENTATION_ID)}/interactions/current?lang=en`);
  const cookie = extractDeviceCookie(res.cookies);

  if (!cookie) {
    console.error(`Client ${clientId}: Failed to get device cookie`);
    return null;
  }

  return {
    id: clientId,
    cookie,
    slideId: res.data?.slideId,
    optionCount: res.data?.interactionState?.optionCount || res.data?.interaction?.optionCount || 4,
    status: res.data?.status,
    slideType: res.data?.slideType,
  };
}

// Have a client cast a vote
async function castVote(client, optionIndex) {
  if (!client?.slideId) {
    return { ok: false, error: 'no slideId' };
  }

  stats.votesSent++;
  const res = await request(
    'POST',
    `/api/follow/${encodeURIComponent(PRESENTATION_ID)}/interactions/${encodeURIComponent(client.slideId)}/vote`,
    JSON.stringify({ optionIndex }),
    client.cookie
  );

  if (res.data?.ok) {
    stats.votesSucceeded++;
    const totals = res.data?.interactionState?.totals;
    if (totals) stats.lastTotalsFromVote = totals;
    return { ok: true, totals };
  } else {
    stats.votesFailed++;
    return { ok: false, error: res.data?.error || res.status };
  }
}

// Connect to presenter SSE and monitor for corrupted messages
function monitorPresenterSSE(sessionId) {
  return new Promise((resolve) => {
    const url = new URL(`/api/present-sessions/${sessionId}/events`, BASE_URL);
    console.log(`      SSE URL: ${url.href}`);

    const req = httpModule.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      headers: { 'Accept': 'text/event-stream' },
    }, (res) => {
      console.log(`      SSE response status: ${res.statusCode}`);
      if (res.statusCode === 200) {
        stats.sseConnected = true;
      } else if (res.statusCode === 401) {
        console.log('      (SSE requires auth - skipping SSE monitoring)');
      }
      let buffer = '';

      res.on('data', (chunk) => {
        const chunkStr = chunk.toString();
        if (process.env.DEBUG) console.log(`      [SSE chunk] ${chunkStr.slice(0, 100).replace(/\n/g, '\\n')}...`);
        buffer += chunkStr;

        // Parse SSE messages from buffer
        const messages = buffer.split('\n\n');
        buffer = messages.pop(); // Keep incomplete message in buffer

        for (const msg of messages) {
          if (!msg.trim()) continue;

          const lines = msg.split('\n');
          let event = null;
          let data = null;

          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
          }

          if (process.env.DEBUG && event) {
            console.log(`      [SSE event] ${event}`);
          }
          if (event === 'interactionState' && data) {
            stats.sseMessagesReceived++;
            try {
              const parsed = JSON.parse(data);
              stats.lastTotals = parsed.totals;
            } catch (e) {
              stats.sseParseErrors++;
              stats.sseCorruptedData.push({
                error: e.message,
                rawData: data.slice(0, 300),
              });
              console.error(`\n[SSE PARSE ERROR] ${e.message}`);
              console.error(`  Raw data: ${data.slice(0, 200)}...`);
            }
          }
        }
      });

      resolve({ close: () => req.destroy() });
    });

    req.on('error', (e) => {
      console.error('SSE connection error:', e.message);
      resolve({ close: () => {} });
    });

    req.end();
  });
}

// Get current session ID from the follow endpoint
async function getSessionId() {
  const res = await request('GET', `/api/follow/${encodeURIComponent(PRESENTATION_ID)}/interactions/current?lang=en`);
  return res.data?.sessionId;
}

// Main test runner
async function runTest() {
  console.log('='.repeat(60));
  console.log('Concurrent Vote Load Test');
  console.log('='.repeat(60));
  console.log(`Server:        ${BASE_URL}`);
  console.log(`Presentation:  ${PRESENTATION_ID}`);
  console.log(`Clients:       ${NUM_CLIENTS}`);
  console.log(`Vote rounds:   ${VOTE_ROUNDS}`);
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Get session ID and verify presentation is live
  console.log('[1/5] Checking presentation status...');
  const sessionId = await getSessionId();

  if (!sessionId) {
    console.error('ERROR: Could not get session ID.');
    console.error('Make sure you have the presentation open in presenter mode.');
    process.exit(1);
  }
  console.log(`      Session ID: ${sessionId}`);

  // Step 2: Connect to presenter SSE
  console.log('[2/5] Connecting to presenter SSE stream...');
  const sse = await monitorPresenterSSE(sessionId);

  // Give SSE time to connect
  await new Promise(r => setTimeout(r, 500));

  // Step 3: Create simulated clients
  console.log(`[3/5] Creating ${NUM_CLIENTS} simulated clients...`);
  const clients = [];
  for (let i = 0; i < NUM_CLIENTS; i++) {
    const client = await createClient(i + 1);
    if (client) {
      clients.push(client);
      process.stdout.write('.');
    } else {
      process.stdout.write('x');
    }
  }
  console.log('');

  if (clients.length === 0) {
    console.error('ERROR: No clients could be created.');
    console.error('Make sure the presentation is on a poll or likert slide.');
    sse.close();
    process.exit(1);
  }

  const sampleClient = clients[0];
  console.log(`      Created ${clients.length} clients`);
  console.log(`      Slide ID: ${sampleClient.slideId}`);
  console.log(`      Slide type: ${sampleClient.slideType}`);
  console.log(`      Option count: ${sampleClient.optionCount}`);

  if (!['poll-slide', 'likert-slide', 'likert-slider-slide'].includes(sampleClient.slideType)) {
    console.error('');
    console.error('ERROR: Current slide is not interactive.');
    console.error(`       Found: ${sampleClient.slideType || 'none'}`);
    console.error('       Navigate to a poll or likert slide and try again.');
    sse.close();
    process.exit(1);
  }

  // Step 4: Fire concurrent votes
  console.log(`[4/5] Firing ${VOTE_ROUNDS} rounds of concurrent votes...`);

  for (let round = 1; round <= VOTE_ROUNDS; round++) {
    console.log(`      Round ${round}/${VOTE_ROUNDS}: ${clients.length} votes simultaneously...`);

    // All clients vote at the same time
    const votePromises = clients.map((client, idx) => {
      const optionIndex = idx % sampleClient.optionCount;
      return castVote(client, optionIndex);
    });

    await Promise.all(votePromises);

    // Small delay between rounds to let SSE catch up
    await new Promise(r => setTimeout(r, 200));
  }

  // Step 5: Wait for SSE to process all messages
  console.log('[5/5] Waiting for SSE messages to settle...');
  await new Promise(r => setTimeout(r, 1000));

  sse.close();

  // Print results
  console.log('');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Votes sent:            ${stats.votesSent}`);
  console.log(`Votes succeeded:       ${stats.votesSucceeded}`);
  console.log(`Votes failed:          ${stats.votesFailed}`);
  console.log('');

  // Show totals from vote responses
  const totals = stats.lastTotalsFromVote || stats.lastTotals;
  if (totals) {
    const totalVotes = totals.reduce((a, b) => a + b, 0);
    console.log(`Final vote totals:     [${totals.join(', ')}] = ${totalVotes} total`);
  }

  // SSE monitoring results (if connected)
  if (stats.sseConnected) {
    console.log('');
    console.log(`SSE messages received: ${stats.sseMessagesReceived}`);
    console.log(`SSE parse errors:      ${stats.sseParseErrors}`);
  }

  console.log('');

  // Determine test outcome
  if (stats.sseParseErrors > 0) {
    console.log('!!! TEST FAILED !!!');
    console.log(`Found ${stats.sseParseErrors} corrupted SSE messages.`);
    console.log('');
    console.log('Corrupted message samples:');
    for (const err of stats.sseCorruptedData.slice(0, 3)) {
      console.log(`  Error: ${err.error}`);
      console.log(`  Data:  ${err.rawData}`);
      console.log('');
    }
    process.exit(1);
  } else if (stats.votesSucceeded === 0) {
    console.log('!!! TEST FAILED !!!');
    console.log('No votes succeeded.');
    process.exit(1);
  } else if (stats.votesFailed > 0) {
    console.log('!!! WARNING !!!');
    console.log(`${stats.votesFailed} votes failed.`);
    process.exit(1);
  } else {
    console.log('*** TEST PASSED ***');
    console.log(`All ${stats.votesSucceeded} votes succeeded.`);
    if (!stats.sseConnected) {
      console.log('(SSE monitoring skipped - requires presenter authentication)');
    } else if (stats.sseMessagesReceived > 0) {
      console.log('All SSE messages parsed successfully.');
    }
    process.exit(0);
  }
}

runTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
