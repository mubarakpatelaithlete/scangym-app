/**
 * A customer who types "Bolton" must be told about gyms in Bolton.
 *
 * Google returns each gym's own suburb, so naming the search after the most
 * common one produced headlines like "Found 20 gyms in Farnworth" for a Bolton
 * search — visible on Telegram, Discord, Slack and the web chat alike.
 */
const test = require('node:test');
const assert = require('node:assert');

const { placeLabel, pickCityLabel } = require('../server/chatbot/message-handler');

const boltonResults = [
  { name: 'The Gym Group Bolton', city: 'Bolton' },
  { name: "King's Gym - Farnworth", city: 'Farnworth' },
  { name: 'Another Farnworth gym', city: 'Farnworth' },
  { name: 'Horwich Leisure', city: 'Horwich' },
];

test('echoes the place the customer typed, not the commonest suburb', () => {
  assert.strictEqual(placeLabel(boltonResults, 'Bolton'), 'Bolton');
});

test('capitalises a sloppily typed place', () => {
  assert.strictEqual(placeLabel(boltonResults, 'bolton'), 'Bolton');
  assert.strictEqual(placeLabel(boltonResults, 'manchester city centre'), 'Manchester City Centre');
});

test('falls back to the derived city when there is no usable query', () => {
  assert.strictEqual(placeLabel(boltonResults, ''), 'Farnworth');
  assert.strictEqual(placeLabel(boltonResults, 'near me'), 'Farnworth');
});

test('never puts a postcode or a street number in the headline', () => {
  assert.strictEqual(placeLabel(boltonResults, 'BL1 2SL'), 'Farnworth');
  assert.strictEqual(placeLabel(boltonResults, '116 Bark St'), 'Farnworth');
});

test('pickCityLabel still ignores street addresses', () => {
  assert.strictEqual(pickCityLabel([{ city: '116 Bark St' }, { city: 'Bolton' }]), 'Bolton');
});
