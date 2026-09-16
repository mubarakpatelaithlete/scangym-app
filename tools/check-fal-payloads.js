#!/usr/bin/env node
/**
 * Check every payload the Create routes build against fal's own OpenAPI
 * schema. Free: it reads schemas, generates nothing, bills nothing.
 *
 *   FAL_KEY=... node tools/check-fal-payloads.js
 *
 * Why this exists: fal **ignores unknown fields instead of rejecting them**,
 * and its models disagree about the basics — `duration` is a number on WAN
 * 3.0, the string '8' on Kling v3 and the string '8s' on Veo; the audio flag
 * is `audio`, `generate_audio`, or absent; Seedream and OpenAI have no
 * `aspect_ratio` at all and take `image_size`.
 *
 * So a wrong payload does not fail loudly. It either renders the wrong thing
 * (a 9:16 story delivered as a 2048x2048 square, silently, for however long
 * nobody checks) or fails at the *result* stage while submit returns 200 and
 * status says COMPLETED — which is how Create Video shipped returning no
 * video at all for every customer who pressed it.
 *
 * A unit test cannot catch that: it would only prove we send what we decided
 * to send. This compares what we send against what fal says it accepts, so
 * the check stays honest when a vendor changes an enum under us.
 *
 * Run it whenever a model row is added or a vendor bumps a version.
 */

const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const models = require(path.join(ROOT, 'server', 'lib', 'gen-models'));

const SETTINGS = {
  video: { durationSeconds: 8, aspectRatio: '9:16', resolution: '720p', generateAudio: true },
  image: { aspectRatio: '9:16', count: 1 },
};

const TYPE_OK = {
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number',
  boolean: (v) => typeof v === 'boolean',
  object: (v) => v && typeof v === 'object' && !Array.isArray(v),
  array: Array.isArray,
};

/** Build the payload each fal row would really be sent. */
function payloads() {
  const image = require(path.join(ROOT, 'server', 'routes', 'squad-image'))._internals;
  const video = require(path.join(ROOT, 'server', 'routes', 'squad-video'))._internals;
  const music = require(path.join(ROOT, 'server', 'routes', 'squad-music'))._internals;

  const out = [];
  for (const row of models.MODELS.filter((m) => m.provider === 'fal')) {
    if (row.kind === 'image') out.push([row, image.buildInput(row, 'a kettlebell', SETTINGS.image)]);
    if (row.kind === 'video') out.push([row, video.falInput('a gym reel', SETTINGS.video, row)]);
    if (row.kind === 'music') out.push([row, music.falMusicInput('a hype gym track', music.LENGTH_MS['30s'])]);
  }
  return out;
}

async function schemaFor(endpointId) {
  const r = await fetch(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${endpointId}`, {
    headers: { Authorization: `Key ${process.env.FAL_KEY}` },
  });
  if (!r.ok) throw new Error(`schema unavailable (${r.status})`);
  const spec = await r.json();
  const schemas = spec?.components?.schemas || {};
  const name = Object.keys(schemas).find((k) => k.endsWith('Input'));
  return schemas[name]?.properties || {};
}

/** Flatten `anyOf: [{enum: [...]}, {type: 'null'}]` into something checkable. */
function accepts(spec, value) {
  const variants = spec.anyOf || [spec];
  return variants.some((v) => {
    if (v.type === 'null') return value === null;
    if (v.enum) return v.enum.map(String).includes(String(value));
    if (v.$ref) return typeof value === 'object' || typeof value === 'string';
    if (v.type && TYPE_OK[v.type]) return TYPE_OK[v.type](value);
    return true;
  });
}

async function main() {
  if (!process.env.FAL_KEY) {
    console.error('FAL_KEY is required (this only reads schemas — nothing is generated).');
    process.exit(2);
  }

  let bad = 0;
  for (const [row, payload] of payloads()) {
    let props;
    try {
      props = await schemaFor(row.providerModel);
    } catch (e) {
      console.log(`?? ${row.id.padEnd(20)} ${row.providerModel} — ${e.message}`);
      bad++;
      continue;
    }

    const problems = [];
    for (const [field, value] of Object.entries(payload)) {
      const spec = props[field];
      if (!spec) {
        problems.push(`'${field}' is not a field on this model — fal will ignore it, so the setting does nothing`);
        continue;
      }
      if (!accepts(spec, value)) {
        const allowed = spec.enum || spec.anyOf?.flatMap((v) => v.enum || v.type || []) || spec.type;
        problems.push(`'${field}' = ${JSON.stringify(value)} is not accepted (allowed: ${JSON.stringify(allowed)})`);
      }
    }

    if (problems.length) {
      bad++;
      console.log(`FAIL ${row.id}  (${row.providerModel})`);
      for (const p of problems) console.log(`       ${p}`);
    } else {
      console.log(`OK   ${row.id}`);
    }
  }

  console.log(bad ? `\n${bad} model(s) would not do what the sheet promises.` : '\nEvery fal payload matches the vendor schema.');
  process.exit(bad ? 1 : 0);
}

main();
