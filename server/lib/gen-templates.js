/**
 * One-tap starters for the Create sheet.
 *
 * A blank prompt box is a test of prompt-writing, and most ScanSquad creators
 * did not sign up to take one. The sheet already had one or two chips per mode,
 * written for the flow rather than for the job a creator is actually doing, and
 * they carried a prompt only — so a creator tapped "Gym tour", got the default
 * 8s at 1080p on whatever model was first, and paid for settings nobody chose.
 *
 * So a starter carries the whole recipe: prompt, the settings that suit it, and
 * a model that suits it. The cheap-and-fast model is the default on every video
 * starter, because a creator's first clip should cost us pennies and arrive in
 * a minute, not $3.78 in four.
 *
 * They live server-side, not in the client bundle, for the same reason the
 * model catalogue does: we learn which openers work from what creators post,
 * and changing a sentence should not need a frontend deploy. The sheet merges
 * whatever this returns; an unknown model id falls through to the catalogue
 * default rather than failing (routes/squad-*.js resolveAvailable).
 *
 * House rules for the copy, mirroring lib/squad-tools.js: any partner gym, one
 * price, no membership, free cancellation up to 2 hours before. Never a price
 * or a gym name we do not sell — the prompts say £5/day because that is the
 * live day-pass price, and pricing-engine.js is the authority if it moves.
 */

const TEMPLATES = {
  text: [
    { label: '📣 £5 promo', prompt: 'Punchy Instagram caption for a ScanGym day pass: any partner gym, £5 a day, no membership, free cancellation', settings: { tone: 'Punchy', length: 'Short' } },
    { label: '🆚 Gym vs membership', prompt: 'Caption comparing a £40/month gym membership with £5 a day, no contract — confident, no gym names', settings: { tone: 'Punchy', length: 'Short' } },
    { label: '🏆 Member win', prompt: 'Celebrate a member hitting 10 gym visits this month, warm and motivating, two short lines', settings: { tone: 'Friendly', length: 'Short' } },
    { label: '🧳 Travel day', prompt: 'Caption about training in a new city without joining a gym — one pass, any partner gym', settings: { tone: 'Friendly', length: 'Medium' } },
    { label: '🎯 Beginner nerves', prompt: 'Reassuring caption for someone scared of their first gym session: no membership, no lock-in, try one day', settings: { tone: 'Friendly', length: 'Medium' } },
    { label: '📍 New gym alert', prompt: 'Short announcement caption: a new partner gym has joined ScanGym in Leicester, day passes from £5', settings: { tone: 'Punchy', length: 'Short' } },
    { label: '💬 Reply to a doubter', prompt: 'Confident caption answering "is it really no membership?" — one price, cancel free up to 2 hours before', settings: { tone: 'Professional', length: 'Medium' } },
    { label: '🔗 Link in bio', prompt: 'Caption ending in a clear call to action to tap the link in bio and book a day pass', settings: { tone: 'Punchy', length: 'Short' } },
  ],
  image: [
    { label: '🏋️ Gym shot', prompt: 'Bright modern gym interior, squat racks, natural light, clean and energetic, vertical', settings: { aspectRatio: '9:16', style: 'Photo' }, model: 'nano-banana-2' },
    { label: '⚡ £5 poster', prompt: 'Bold poster: "Any gym. £5/day." orange accents on a dark background, high contrast, vertical', settings: { aspectRatio: '9:16', style: 'Bold' }, model: 'nano-banana-2' },
    { label: '🆚 Price compare', prompt: 'Split image: "£40/month membership" versus "£5 for today", clean typography, orange and dark, vertical', settings: { aspectRatio: '9:16', style: 'Bold' }, model: 'nano-banana-2' },
    { label: '📱 Story background', prompt: 'Minimal dark story background with subtle gym equipment silhouettes, space for text at the top, vertical', settings: { aspectRatio: '9:16', style: 'Minimal' }, model: 'nano-banana-2' },
    { label: '🤳 Selfie mirror', prompt: 'Candid gym mirror selfie mood: phone in hand, weights behind, warm morning light, vertical', settings: { aspectRatio: '9:16', style: 'Photo' }, model: 'nano-banana-2' },
    { label: '☀️ Morning session', prompt: 'Sunrise through gym windows, empty treadmills, calm and inviting, vertical', settings: { aspectRatio: '9:16', style: 'Photo' }, model: 'nano-banana-2' },
    { label: '🎟️ Day pass card', prompt: 'Product shot of a phone showing a gym day pass QR code, dark UI with orange accent, vertical', settings: { aspectRatio: '9:16', style: 'Bold' }, model: 'nano-banana-2' },
    { label: '🧑‍🤝‍🧑 Train together', prompt: 'Two friends finishing a workout, laughing, towels and water bottles, natural light, vertical', settings: { aspectRatio: '9:16', style: 'Photo' }, model: 'nano-banana-2' },
  ],
  video: [
    { label: '🏋️ Gym tour', prompt: 'Smooth walkthrough of a modern gym: squat racks, cardio zone, bright clean lighting, people training, upbeat, vertical 9:16', settings: { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', generateAudio: true }, model: 'grok-imagine-video' },
    { label: '⚡ £5/day promo', prompt: 'High-energy promo: text "Any gym. £5/day. No membership." over fast cuts of people training, bold orange accents, vertical 9:16', settings: { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', generateAudio: true }, model: 'grok-imagine-video' },
    { label: '🔥 Transformation', prompt: 'Motivational montage: early morning workouts, sweat, determination, sunrise through gym windows, inspiring, vertical 9:16', settings: { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', generateAudio: true }, model: 'grok-imagine-video' },
    { label: '🚪 Scan and in', prompt: 'Close-up: phone scanned at a gym entry barrier, gate opens, person walks in confidently, vertical 9:16', settings: { aspectRatio: '9:16', durationSeconds: 6, resolution: '720p', generateAudio: true }, model: 'grok-imagine-video' },
    { label: '🌙 Late session', prompt: 'Night gym, neon and low light, one person on the bench press, focused and cinematic, vertical 9:16', settings: { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', generateAudio: true }, model: 'grok-imagine-video' },
    { label: '🧳 New city', prompt: 'Traveller drops a bag in a hotel room then trains in an unfamiliar gym the same evening, warm tones, vertical 9:16', settings: { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', generateAudio: true }, model: 'grok-imagine-video' },
    { label: '🎬 Cinematic hero', prompt: 'Slow push-in on a dumbbell rack, shallow depth of field, dust in a beam of light, premium advert feel, vertical 9:16', settings: { aspectRatio: '9:16', durationSeconds: 8, resolution: '1080p', generateAudio: true } },
    { label: '🗣️ Piece to camera', prompt: 'Person speaking straight to camera in a gym doorway, natural handheld feel, gym noise behind, vertical 9:16', settings: { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', generateAudio: true } },
  ],
  audio: [
    { label: '🎧 Promo read', prompt: 'Upbeat 15-second voiceover: any gym, five pounds a day, no membership, book in the ScanGym app', settings: { voice: 'Hype', length: '15s' } },
    { label: '🧘 Calm intro', prompt: 'Calm 15-second welcome for a gym tour video: no membership, no pressure, just train today', settings: { voice: 'Calm', length: '15s' } },
    { label: '📣 Coach hype', prompt: 'Coach-style 15 seconds: get in, get it done, five pounds, any gym, no excuses', settings: { voice: 'Coach', length: '15s' } },
    { label: '🆚 Comparison read', prompt: 'Thirty-second read comparing a monthly membership with a five pound day pass, matter of fact and clear', settings: { voice: 'Coach', length: '30s' } },
    { label: '🧳 Travel read', prompt: 'Fifteen seconds about training anywhere you land, one pass, any partner gym', settings: { voice: 'Calm', length: '15s' } },
    { label: '📍 Local shout', prompt: 'Fifteen-second shout-out that Leicester gyms are on ScanGym from five pounds a day', settings: { voice: 'Hype', length: '15s' } },
    { label: '❓ FAQ answer', prompt: 'Thirty seconds answering: can I cancel? Yes, free up to two hours before your session', settings: { voice: 'Coach', length: '30s' } },
    { label: '🔗 Call to action', prompt: 'Fifteen seconds ending in: tap the link, pick a gym, train today', settings: { voice: 'Hype', length: '15s' } },
  ],
  music: [
    { label: '🔥 Hype loop', prompt: 'High-energy gym workout loop, driving drums, confident, 30 seconds', settings: { genre: 'Hype', length: '30s' } },
    { label: '🎬 Cinematic build', prompt: 'Cinematic build for a gym transformation reel, strings and deep drums, rising, 30 seconds', settings: { genre: 'Epic', length: '30s' } },
    { label: '🧘 Cool down', prompt: 'Calm ambient cool-down bed, soft pads, no drums, 30 seconds', settings: { genre: 'Chill', length: '30s' } },
    { label: '🏃 Cardio pace', prompt: 'Steady 160bpm running track, bright synths, motivating, 30 seconds', settings: { genre: 'Hype', length: '30s' } },
    { label: '📱 Story sting', prompt: 'Fifteen-second punchy sting for an Instagram story, one hook, ends clean', settings: { genre: 'Hype', length: '15s' } },
    { label: '🌙 Night session', prompt: 'Dark moody late-night gym beat, sub bass, sparse, 30 seconds', settings: { genre: 'Chill', length: '30s' } },
    { label: '🎉 Win moment', prompt: 'Celebratory lift-off moment for a personal best, bright and triumphant, 15 seconds', settings: { genre: 'Epic', length: '15s' } },
    { label: '🎙️ Under a voiceover', prompt: 'Neutral background bed that sits under a voiceover, no melody in the vocal range, 30 seconds', settings: { genre: 'Chill', length: '30s' } },
  ],
};

function forMode(kind) {
  return TEMPLATES[kind] || [];
}

function all() {
  return TEMPLATES;
}

module.exports = { forMode, all, TEMPLATES };
