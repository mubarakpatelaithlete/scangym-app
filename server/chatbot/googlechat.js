/**
 * Google Chat Adapter for ScanGym
 *
 * Google Chat is the odd one out among our channels: it does not hand us a bot
 * token to push messages with. It POSTs an event to this endpoint and takes the
 * body of our HTTP response as the bot's reply. So there is no credential to
 * store — what makes this channel live is the endpoint plus proof that the
 * caller really is Google.
 *
 * That proof is the Bearer JWT Google signs and sends in the Authorization
 * header. We check it is issued by chat@system.gserviceaccount.com and that its
 * audience is our own app. If GOOGLE_CHAT_AUDIENCE is set we fail closed on a
 * bad token: anyone on the internet can find this URL, and without the check
 * they could drive the assistant and read back gym data as if they were Google.
 *
 * Endpoint: POST /api/chatbot/googlechat/events
 * Configure that URL in Google Cloud Console → Chat API → Configuration.
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

const AUDIENCE = process.env.GOOGLE_CHAT_AUDIENCE || process.env.GOOGLE_CHAT_PROJECT_NUMBER;
const BASE_URL = process.env.BASE_URL || 'https://scangym.com';
const GOOGLE_CHAT_ISSUER = 'chat@system.gserviceaccount.com';
const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo?id_token=';

// Google Chat retries an event it thinks failed, which would answer twice.
const processedEvents = new Map();
const EVENT_TTL = 300000;

// Verified tokens, so a burst of messages is not a burst of tokeninfo calls.
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 300000;

// ─── Verify the request really came from Google Chat ─────────
async function verifyGoogleRequest(req) {
  if (!AUDIENCE) return true; // not configured yet — nothing to verify against

  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return false;

  const cached = tokenCache.get(token);
  if (cached && Date.now() < cached.expiresAt) return cached.ok;

  try {
    const resp = await fetch(TOKENINFO + encodeURIComponent(token));
    if (!resp.ok) return false;
    const info = await resp.json();
    const ok = info.email === GOOGLE_CHAT_ISSUER &&
               info.email_verified !== 'false' &&
               String(info.aud) === String(AUDIENCE);
    if (!ok) {
      // Log the claims we actually got, so a mismatch is diagnosable instead of
      // silently turning into "ScanGym not responding" in the Chat client.
      console.error(`[GoogleChat] Token claims mismatch: email=${info.email} aud=${info.aud} expected_aud=${AUDIENCE}`);
    }
    tokenCache.set(token, { ok, expiresAt: Date.now() + TOKEN_CACHE_TTL });
    if (tokenCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of tokenCache) if (now > v.expiresAt) tokenCache.delete(k);
    }
    return ok;
  } catch (e) {
    console.error('[GoogleChat] Token verification error:', e.message);
    return false; // could not prove it was Google — do not answer
  }
}

// ─── Events endpoint ─────────────────────────────────────────
router.post('/events', express.json(), async (req, res) => {
  try {
    if (!(await verifyGoogleRequest(req))) {
      console.error('[GoogleChat] Rejected unverified request');
      return res.status(401).json({ text: 'Unauthorized' });
    }

    const event = req.body || {};

    if (event.type === 'ADDED_TO_SPACE') {
      return res.json({ text: welcomeText(event.user?.displayName) });
    }
    if (event.type === 'REMOVED_FROM_SPACE') {
      return res.status(200).send('');
    }
    if (event.type === 'CARD_CLICKED') {
      return res.json({ text: '📅 Opening that gym on ScanGym…' });
    }
    if (event.type !== 'MESSAGE') {
      return res.json({ text: welcomeText(event.user?.displayName) });
    }

    const eventId = event.eventTime || event.message?.name;
    if (eventId) {
      if (processedEvents.has(eventId)) return res.status(200).send('');
      processedEvents.set(eventId, Date.now());
      if (processedEvents.size > 500) {
        const now = Date.now();
        for (const [k, v] of processedEvents) if (now - v > EVENT_TTL) processedEvents.delete(k);
      }
    }

    // In a space the bot is @mentioned, so strip the mention like Slack does.
    const raw = event.message?.argumentText || event.message?.text || '';
    const text = raw.replace(/@ScanGym/gi, '').trim();
    if (!text) return res.json({ text: welcomeText(event.user?.displayName) });

    const googleUserId = event.user?.name || event.message?.sender?.name || 'unknown';
    const userName = event.user?.displayName || 'there';
    const spaceId = event.space?.name;

    console.log(`[GoogleChat] From ${userName}: ${text.substring(0, 100)}`);

    const response = await handleMessage(`googlechat:${googleUserId}`, text, {
      userName,
      platform: 'googlechat',
      channelId: spaceId,
    });

    const gyms = response.data?.gyms;
    if (gyms && gyms.length > 0) {
      return res.json({
        text: response.text,
        cardsV2: buildGymCards(gyms),
      });
    }
    return res.json({ text: response.text });

  } catch (err) {
    console.error('[GoogleChat] Event error:', err);
    // Always answer the customer with something, never a stack trace.
    return res.json({ text: 'Sorry — something went wrong on my end. Try again in a moment?' });
  }
});

// ─── Status endpoint ─────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    active: !!AUDIENCE,
    verifiesRequests: !!AUDIENCE,
    endpoint: `${BASE_URL}/api/chatbot/googlechat/events`,
    processedEvents: processedEvents.size,
  });
});

// ─── Presentation ────────────────────────────────────────────
function welcomeText(name) {
  return `👋 Hey${name ? ' ' + name : ''}, I'm ScanGym.\n\n` +
    `Tell me where you are and I'll find you a gym you can book today — try *"Find gyms in Manchester"*.`;
}

function buildGymCards(gyms) {
  const showing = gyms.slice(0, 5);
  return [{
    cardId: 'scangym-results',
    card: {
      header: {
        title: `🏋️ ${gyms.length} gym${gyms.length === 1 ? '' : 's'} found`,
        subtitle: showing.length < gyms.length ? `Showing the first ${showing.length}` : 'Tap Book to reserve',
      },
      sections: showing.map((g, i) => {
        const price = `${g.currencySymbol || '£'}${g.dayPassPrice}`;
        const bits = [`💰 ${price}/day`];
        if (g.rating) bits.push(`⭐ ${g.rating}/5`);
        if (g.openNow === true) bits.push('✅ Open now');
        else if (g.openNow === false) bits.push('🔴 Closed');
        return {
          header: `${i + 1}. ${g.name || 'Gym'}`,
          widgets: [
            { decoratedText: { text: bits.join(' · '), bottomLabel: g.address || 'Address unavailable', wrapText: true } },
            {
              buttonList: {
                buttons: [{
                  text: '📅 Book',
                  onClick: { openLink: { url: `${BASE_URL}/book?gym=${encodeURIComponent(g.name || '')}` } },
                }],
              },
            },
          ],
        };
      }),
    },
  }];
}

module.exports = router;
