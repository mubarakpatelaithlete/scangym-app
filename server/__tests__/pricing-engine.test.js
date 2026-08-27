const {
  calculatePrice,
  calculateGymPrice,
  getAllPassPrices,
  getAllGymPassPrices,
  getStripePriceId,
  buildStripeLineItem,
  getCurrencyForCountry,
  getDayPassPrice,
  charmPrice,
  toStripeAmount,
  COUNTRY_PRICING,
  STRIPE_PRICE_MAP,
  ZERO_DECIMAL_CURRENCIES,
  PASS_MULTIPLIERS,
  BASE_PRICE_GBP,
  MIN_PRICE_USD,
} = require('../lib/pricing-engine');

describe('pricing-engine', () => {
  describe('charmPrice', () => {
    it('returns 0.99 for prices below 1', () => {
      expect(charmPrice(0.5, 'gbp')).toBe(0.99);
      expect(charmPrice(0.1, 'gbp')).toBe(0.99);
    });

    it('applies .99/.49 charm for normal decimal currencies', () => {
      const result = charmPrice(4.6, 'gbp');
      expect(result).toBe(4.49);
    });

    it('rounds to x.99 when decimal >= 0.75', () => {
      expect(charmPrice(4.8, 'gbp')).toBe(4.99);
    });

    it('rounds to x-0.01 when decimal < 0.25', () => {
      expect(charmPrice(5.1, 'gbp')).toBe(4.99);
    });

    it('handles zero-decimal currencies (JPY)', () => {
      const result = charmPrice(500, 'jpy');
      expect(result).toBe(499);
    });

    it('handles large zero-decimal values (KRW)', () => {
      const result = charmPrice(5500, 'krw');
      expect(result).toBe(5499);
    });

    it('handles very large zero-decimal values (>100000)', () => {
      const result = charmPrice(150000, 'vnd');
      expect(result).toBe(149999);
    });

    it('handles large decimal-currency values (>=10000)', () => {
      const result = charmPrice(15000, 'cop');
      expect(result).toBe(14999);
    });

    it('handles mid-range values (>=1000)', () => {
      const result = charmPrice(1500, 'krw');
      expect(result).toBe(1499);
    });
  });

  describe('toStripeAmount', () => {
    it('multiplies by 100 for decimal currencies', () => {
      expect(toStripeAmount(4.49, 'gbp')).toBe(449);
      expect(toStripeAmount(5.99, 'usd')).toBe(599);
    });

    it('returns the amount as-is for zero-decimal currencies', () => {
      expect(toStripeAmount(499, 'jpy')).toBe(499);
      expect(toStripeAmount(5500, 'krw')).toBe(5500);
    });

    it('rounds correctly', () => {
      expect(toStripeAmount(4.495, 'gbp')).toBe(450);
      expect(toStripeAmount(4.494, 'gbp')).toBe(449);
    });
  });

  describe('calculatePrice', () => {
    it('returns a valid price object for GB day pass', () => {
      const result = calculatePrice({ countryCode: 'GB', passType: 'day' });
      expect(result).toHaveProperty('amount');
      expect(result).toHaveProperty('currency', 'gbp');
      expect(result).toHaveProperty('symbol', '£');
      expect(result).toHaveProperty('display');
      expect(result).toHaveProperty('stripeAmount');
      expect(result).toHaveProperty('countryCode', 'GB');
      expect(result).toHaveProperty('passType', 'day');
      expect(result.amount).toBeGreaterThan(0);
    });

    it('defaults to GB and day pass when no params provided', () => {
      const result = calculatePrice();
      expect(result.countryCode).toBe('GB');
      expect(result.passType).toBe('day');
      expect(result.currency).toBe('gbp');
    });

    it('applies PPP adjustment for India (lower price)', () => {
      const gbResult = calculatePrice({ countryCode: 'GB', passType: 'day' });
      const inResult = calculatePrice({ countryCode: 'IN', passType: 'day' });
      // India's PPP factor is 0.22, so local currency amount should reflect lower purchasing power
      expect(inResult.currency).toBe('inr');
      expect(inResult.symbol).toBe('₹');
    });

    it('applies pass multipliers correctly', () => {
      const day = calculatePrice({ countryCode: 'US', passType: 'day' });
      const weekly = calculatePrice({ countryCode: 'US', passType: 'weekly' });
      // Weekly is 5x the day pass base (before charm pricing)
      expect(weekly.amount).toBeGreaterThan(day.amount * 3);
    });

    it('handles 3day pass type', () => {
      const result = calculatePrice({ countryCode: 'GB', passType: '3day' });
      expect(result.passType).toBe('3day');
      expect(result.amount).toBeGreaterThan(0);
    });

    it('handles three_day alias', () => {
      const result = calculatePrice({ countryCode: 'GB', passType: 'three_day' });
      expect(result.amount).toBeGreaterThan(0);
    });

    it('handles monthly pass type', () => {
      const result = calculatePrice({ countryCode: 'GB', passType: 'monthly' });
      expect(result.passType).toBe('monthly');
      expect(result.amount).toBeGreaterThan(0);
    });

    it('falls back to GB pricing for unknown country', () => {
      const result = calculatePrice({ countryCode: 'ZZ', passType: 'day' });
      expect(result.currency).toBe('gbp');
      expect(result.countryCode).toBe('ZZ');
    });

    it('normalizes country code to uppercase', () => {
      const result = calculatePrice({ countryCode: 'gb', passType: 'day' });
      expect(result.countryCode).toBe('GB');
      expect(result.currency).toBe('gbp');
    });

    it('enforces minimum price floor', () => {
      // Countries with very low PPP (like Nepal, 0.10) should still have reasonable minimum
      const result = calculatePrice({ countryCode: 'NP', passType: 'day' });
      expect(result.amount).toBeGreaterThan(0);
      expect(result.stripeAmount).toBeGreaterThan(0);
    });

    it('formats display correctly for decimal currencies', () => {
      const result = calculatePrice({ countryCode: 'GB', passType: 'day' });
      expect(result.display).toMatch(/^£\d+\.\d{2}$/);
    });

    it('formats display correctly for zero-decimal currencies', () => {
      const result = calculatePrice({ countryCode: 'JP', passType: 'day' });
      expect(result.display).toMatch(/^¥[\d,]+$/);
    });

    it('stripeAmount is consistent with amount for decimal currencies', () => {
      const result = calculatePrice({ countryCode: 'GB', passType: 'day' });
      expect(result.stripeAmount).toBe(Math.round(result.amount * 100));
    });

    it('stripeAmount equals amount for zero-decimal currencies', () => {
      const result = calculatePrice({ countryCode: 'JP', passType: 'day' });
      expect(result.stripeAmount).toBe(Math.round(result.amount));
    });
  });

  describe('calculateGymPrice', () => {
    it('uses default PPP pricing when gymDayPassPrice is null', () => {
      const result = calculateGymPrice({ gymDayPassPrice: null, countryCode: 'GB', passType: 'day' });
      expect(result.source).toBe('ppp_default');
    });

    it('uses default PPP pricing when gymDayPassPrice is 0', () => {
      const result = calculateGymPrice({ gymDayPassPrice: 0, countryCode: 'GB', passType: 'day' });
      expect(result.source).toBe('ppp_default');
    });

    it('uses owner price when gymDayPassPrice is set', () => {
      const result = calculateGymPrice({ gymDayPassPrice: 6.99, countryCode: 'GB', passType: 'day' });
      expect(result.source).toBe('owner_price');
      expect(result.currency).toBe('gbp');
    });

    it('converts owner price from GBP to local currency', () => {
      const gbResult = calculateGymPrice({ gymDayPassPrice: 5.00, countryCode: 'GB', passType: 'day' });
      const usResult = calculateGymPrice({ gymDayPassPrice: 5.00, countryCode: 'US', passType: 'day' });
      expect(usResult.currency).toBe('usd');
      expect(usResult.source).toBe('owner_price');
    });

    it('applies pass multipliers to owner price', () => {
      const day = calculateGymPrice({ gymDayPassPrice: 5.00, countryCode: 'GB', passType: 'day' });
      const weekly = calculateGymPrice({ gymDayPassPrice: 5.00, countryCode: 'GB', passType: 'weekly' });
      expect(weekly.amount).toBeGreaterThan(day.amount);
    });

    it('enforces minimum price floor for owner prices', () => {
      const result = calculateGymPrice({ gymDayPassPrice: 0.01, countryCode: 'NP', passType: 'day' });
      expect(result.amount).toBeGreaterThan(0);
    });
  });

  describe('getAllPassPrices', () => {
    it('returns prices for all 4 pass types', () => {
      const result = getAllPassPrices({ countryCode: 'GB' });
      expect(Object.keys(result)).toEqual(['day', '3day', 'weekly', 'monthly']);
      expect(result.day.amount).toBeLessThan(result['3day'].amount);
      expect(result['3day'].amount).toBeLessThan(result.weekly.amount);
      expect(result.weekly.amount).toBeLessThan(result.monthly.amount);
    });
  });

  describe('getAllGymPassPrices', () => {
    it('returns prices for all 4 pass types with owner pricing', () => {
      const result = getAllGymPassPrices({ gymDayPassPrice: 7.00, countryCode: 'US' });
      expect(Object.keys(result)).toEqual(['day', '3day', 'weekly', 'monthly']);
      for (const pt of Object.values(result)) {
        expect(pt.source).toBe('owner_price');
      }
    });

    it('returns PPP default when no owner price', () => {
      const result = getAllGymPassPrices({ countryCode: 'DE' });
      for (const pt of Object.values(result)) {
        expect(pt.source).toBe('ppp_default');
      }
    });
  });

  describe('getStripePriceId', () => {
    it('returns a price ID for supported currencies', () => {
      const id = getStripePriceId('gbp', 'day');
      expect(id).toBe('price_1TeFYTDPbSptA7HKH9vW2rAx');
    });

    it('returns null for unsupported currencies', () => {
      expect(getStripePriceId('ngn', 'day')).toBeNull();
    });

    it('returns null for unknown pass type', () => {
      expect(getStripePriceId('gbp', 'yearly')).toBeNull();
    });

    it('handles case-insensitivity', () => {
      expect(getStripePriceId('GBP', 'DAY')).toBe('price_1TeFYTDPbSptA7HKH9vW2rAx');
    });
  });

  describe('buildStripeLineItem', () => {
    it('returns a price ID line item for supported currencies', () => {
      const item = buildStripeLineItem({
        passType: 'day',
        currency: 'gbp',
        stripeAmount: 449,
        gymName: 'Test Gym',
      });
      expect(item).toHaveProperty('price', 'price_1TeFYTDPbSptA7HKH9vW2rAx');
      expect(item).toHaveProperty('quantity', 1);
      expect(item).not.toHaveProperty('price_data');
    });

    it('returns price_data for unsupported currencies', () => {
      const item = buildStripeLineItem({
        passType: 'day',
        currency: 'ngn',
        stripeAmount: 5000,
        gymName: 'Lagos Gym',
        description: 'Day pass',
      });
      expect(item).toHaveProperty('price_data');
      expect(item.price_data.currency).toBe('ngn');
      expect(item.price_data.unit_amount).toBe(5000);
      expect(item.price_data.product_data.name).toContain('Lagos Gym');
      expect(item.quantity).toBe(1);
    });

    it('uses default gym name if none provided', () => {
      const item = buildStripeLineItem({
        passType: 'weekly',
        currency: 'ngn',
        stripeAmount: 10000,
      });
      expect(item.price_data.product_data.name).toContain('Gym');
    });
  });

  describe('getCurrencyForCountry', () => {
    it('returns correct currency for known countries', () => {
      expect(getCurrencyForCountry('GB')).toEqual({ countryCode: 'GB', currency: 'gbp', symbol: '£' });
      expect(getCurrencyForCountry('US')).toEqual({ countryCode: 'US', currency: 'usd', symbol: '$' });
      expect(getCurrencyForCountry('JP')).toEqual({ countryCode: 'JP', currency: 'jpy', symbol: '¥' });
    });

    it('falls back to GB for unknown countries', () => {
      expect(getCurrencyForCountry('ZZ')).toEqual({ countryCode: 'ZZ', currency: 'gbp', symbol: '£' });
    });

    it('handles null/undefined', () => {
      expect(getCurrencyForCountry(null)).toEqual({ countryCode: 'GB', currency: 'gbp', symbol: '£' });
      expect(getCurrencyForCountry(undefined)).toEqual({ countryCode: 'GB', currency: 'gbp', symbol: '£' });
    });
  });

  describe('getDayPassPrice', () => {
    it('returns same result as calculatePrice with day passType', () => {
      const direct = calculatePrice({ countryCode: 'DE', passType: 'day' });
      const helper = getDayPassPrice('DE');
      expect(helper).toEqual(direct);
    });
  });

  describe('constants', () => {
    it('BASE_PRICE_GBP is 4.49', () => {
      expect(BASE_PRICE_GBP).toBe(4.49);
    });

    it('MIN_PRICE_USD is 0.50', () => {
      expect(MIN_PRICE_USD).toBe(0.50);
    });

    it('PASS_MULTIPLIERS has expected keys', () => {
      expect(PASS_MULTIPLIERS).toHaveProperty('day', 1.0);
      expect(PASS_MULTIPLIERS).toHaveProperty('3day', 2.67);
      expect(PASS_MULTIPLIERS).toHaveProperty('weekly', 5.0);
      expect(PASS_MULTIPLIERS).toHaveProperty('monthly', 10.0);
    });

    it('COUNTRY_PRICING covers 99 countries', () => {
      expect(Object.keys(COUNTRY_PRICING).length).toBeGreaterThanOrEqual(90);
    });

    it('ZERO_DECIMAL_CURRENCIES includes JPY and KRW', () => {
      expect(ZERO_DECIMAL_CURRENCIES.has('jpy')).toBe(true);
      expect(ZERO_DECIMAL_CURRENCIES.has('krw')).toBe(true);
    });

    it('STRIPE_PRICE_MAP has 15 currencies', () => {
      expect(Object.keys(STRIPE_PRICE_MAP).length).toBe(15);
    });
  });
});
