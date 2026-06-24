const {
  recordBooking,
  getDemandFactor,
  getSurgeDisplay,
  getTopSurging,
  getRegionalSurge,
  startCleanup,
  stopCleanup,
  SURGE_CONFIG,
  SURGE_TIERS,
} = require('../lib/surge-pricing');

// Stop the auto-started cleanup interval to prevent open handles in tests
afterAll(() => {
  stopCleanup();
});

describe('surge-pricing', () => {
  describe('SURGE_CONFIG', () => {
    it('has expected default values', () => {
      expect(SURGE_CONFIG.windowMs).toBe(30 * 60 * 1000);
      expect(SURGE_CONFIG.decayMs).toBe(15 * 60 * 1000);
      expect(SURGE_CONFIG.maxSurge).toBe(2.0);
      expect(SURGE_CONFIG.minSurge).toBe(1.0);
      expect(SURGE_CONFIG.baselineBookingsPerWindow).toBe(3);
      expect(SURGE_CONFIG.maxTrackedGyms).toBe(10000);
    });
  });

  describe('SURGE_TIERS', () => {
    it('is sorted by threshold descending', () => {
      for (let i = 0; i < SURGE_TIERS.length - 1; i++) {
        expect(SURGE_TIERS[i].threshold).toBeGreaterThan(SURGE_TIERS[i + 1].threshold);
      }
    });

    it('has multipliers between 1.0 and 2.0', () => {
      for (const tier of SURGE_TIERS) {
        expect(tier.multiplier).toBeGreaterThanOrEqual(1.0);
        expect(tier.multiplier).toBeLessThanOrEqual(2.0);
      }
    });
  });

  describe('getDemandFactor', () => {
    it('returns 1.0 for unknown gym (no bookings)', () => {
      const factor = getDemandFactor('unknown-gym-999');
      expect(factor).toBe(1.0);
    });
  });

  describe('recordBooking + getDemandFactor', () => {
    it('increases demand factor after multiple bookings', () => {
      const gymId = 'test-gym-surge-1';
      // Record 5 bookings quickly
      for (let i = 0; i < 5; i++) {
        recordBooking(gymId, 'GB');
      }
      const factor = getDemandFactor(gymId);
      expect(factor).toBeGreaterThan(1.0);
    });

    it('reaches higher surge with more bookings', () => {
      const gymId = 'test-gym-surge-2';
      // Record 12 bookings
      for (let i = 0; i < 12; i++) {
        recordBooking(gymId, 'GB');
      }
      const factor = getDemandFactor(gymId);
      expect(factor).toBeGreaterThan(1.2);
    });

    it('caps at maxSurge (2.0)', () => {
      const gymId = 'test-gym-surge-3';
      // Record 30 bookings (way above max threshold)
      for (let i = 0; i < 30; i++) {
        recordBooking(gymId, 'GB');
      }
      const factor = getDemandFactor(gymId);
      expect(factor).toBeLessThanOrEqual(SURGE_CONFIG.maxSurge);
    });

    it('never goes below minSurge (1.0)', () => {
      const gymId = 'test-gym-surge-4';
      recordBooking(gymId, 'GB');
      const factor = getDemandFactor(gymId);
      expect(factor).toBeGreaterThanOrEqual(SURGE_CONFIG.minSurge);
    });
  });

  describe('getSurgeDisplay', () => {
    it('returns Normal for factor 1.0', () => {
      const display = getSurgeDisplay(1.0);
      expect(display.label).toBe('Normal');
      expect(display.factor).toBe(1.0);
    });

    it('returns Moderate for factor 1.1', () => {
      const display = getSurgeDisplay(1.10);
      expect(display.label).toBe('Moderate');
    });

    it('returns Busy for factor 1.25', () => {
      const display = getSurgeDisplay(1.25);
      expect(display.label).toBe('Busy');
    });

    it('returns High Demand for factor 1.5', () => {
      const display = getSurgeDisplay(1.50);
      expect(display.label).toBe('High Demand');
    });

    it('returns Peak Demand for factor 1.75', () => {
      const display = getSurgeDisplay(1.75);
      expect(display.label).toBe('Peak Demand');
    });

    it('returns Peak Demand for factor 2.0', () => {
      const display = getSurgeDisplay(2.0);
      expect(display.label).toBe('Peak Demand');
    });

    it('includes color and icon', () => {
      const display = getSurgeDisplay(1.5);
      expect(display).toHaveProperty('color');
      expect(display).toHaveProperty('icon');
      expect(display.color).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  describe('getTopSurging', () => {
    it('returns an array sorted by factor descending', () => {
      // Record some bookings for different gyms
      for (let i = 0; i < 10; i++) recordBooking('top-surge-a', 'GB');
      for (let i = 0; i < 20; i++) recordBooking('top-surge-b', 'US');

      const results = getTopSurging(5);
      expect(Array.isArray(results)).toBe(true);
      if (results.length >= 2) {
        expect(results[0].factor).toBeGreaterThanOrEqual(results[1].factor);
      }
    });

    it('respects limit parameter', () => {
      const results = getTopSurging(2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('only includes gyms with factor > 1.0', () => {
      const results = getTopSurging(100);
      for (const entry of results) {
        expect(entry.factor).toBeGreaterThan(1.0);
      }
    });
  });

  describe('getRegionalSurge', () => {
    it('returns 1.0 for country with no tracked gyms', () => {
      const factor = getRegionalSurge('XX');
      expect(factor).toBe(1.0);
    });

    it('returns > 1.0 for country with surging gyms', () => {
      const gymId = 'regional-test-gym';
      for (let i = 0; i < 10; i++) recordBooking(gymId, 'FR');
      const factor = getRegionalSurge('FR');
      expect(factor).toBeGreaterThan(1.0);
    });

    it('handles null/empty country', () => {
      expect(getRegionalSurge('')).toBe(1.0);
      expect(getRegionalSurge(null)).toBe(1.0);
    });
  });

  describe('startCleanup / stopCleanup', () => {
    it('can start and stop without errors', () => {
      expect(() => stopCleanup()).not.toThrow();
      expect(() => startCleanup()).not.toThrow();
      expect(() => stopCleanup()).not.toThrow();
    });
  });
});
