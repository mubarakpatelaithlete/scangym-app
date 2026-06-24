// Mock the db module to prevent actual DB connections
jest.mock('../middleware/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

// The analytics module runs an IIFE on import that creates tables.
// We need to require it after mocking db.
const pool = require('../middleware/db');

// We need to extract classifyFunnelStep — it's not exported directly.
// Let's test the middleware behavior and the funnel classification via it.
// Since classifyFunnelStep is internal, we test it through the middleware.

describe('analytics middleware', () => {
  let analyticsMiddleware;

  beforeAll(async () => {
    // Give the IIFE time to run its setup queries
    analyticsMiddleware = require('../middleware/analytics');
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-mock so insert queries resolve
    pool.query.mockResolvedValue({ rows: [] });
  });

  function mockReq(path, method = 'GET', extras = {}) {
    return {
      path,
      method,
      user: null,
      headers: {
        cookie: 'session_id=abc123',
        'user-agent': 'Mozilla/5.0 Test',
        'x-forwarded-for': '1.2.3.4',
        referer: 'https://google.com',
      },
      ip: '1.2.3.4',
      query: {},
      ...extras,
    };
  }

  function mockRes() {
    const res = {};
    res.statusCode = 200;
    res.end = jest.fn();
    return res;
  }

  it('skips health check endpoint', () => {
    const req = mockReq('/api/v2/health');
    const res = mockRes();
    const originalEnd = res.end;
    const next = jest.fn();

    analyticsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    // end should not be monkey-patched for skipped paths
    expect(res.end).toBe(originalEnd);
  });

  it('skips static assets', () => {
    const req = mockReq('/bundle.js');
    const res = mockRes();
    const originalEnd = res.end;
    const next = jest.fn();

    analyticsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.end).toBe(originalEnd);
  });

  it('skips CSS files', () => {
    const req = mockReq('/styles.css');
    const res = mockRes();
    const originalEnd = res.end;
    const next = jest.fn();

    analyticsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.end).toBe(originalEnd);
  });

  it('skips image files', () => {
    const req = mockReq('/logo.png');
    const res = mockRes();
    const originalEnd = res.end;
    const next = jest.fn();

    analyticsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.end).toBe(originalEnd);
  });

  it('patches res.end for tracked paths', () => {
    const req = mockReq('/api/guest/gyms');
    const res = mockRes();
    const originalEnd = res.end;
    const next = jest.fn();

    analyticsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.end).not.toBe(originalEnd);
  });

  it('inserts analytics event when res.end is called', async () => {
    const req = mockReq('/');
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    // Simulate response end
    res.end();

    // Give the fire-and-forget insert time to execute
    await new Promise(resolve => setTimeout(resolve, 50));

    // The query mock should have been called with an INSERT
    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  it('classifies homepage as visitor funnel step', async () => {
    const req = mockReq('/');
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    res.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    expect(insertCalls.length).toBeGreaterThan(0);
    // The funnel_step parameter ($2) should be 'visitor'
    const params = insertCalls[0][1];
    expect(params[1]).toBe('visitor');
  });

  it('classifies gym search as search funnel step', async () => {
    const req = mockReq('/api/guest/gyms');
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    res.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    const params = insertCalls[0][1];
    expect(params[1]).toBe('search');
  });

  it('classifies gym profile view', async () => {
    const req = mockReq('/api/gym-profile/123');
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    res.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    const params = insertCalls[0][1];
    expect(params[1]).toBe('profile_view');
  });

  it('classifies POST booking as checkout', async () => {
    const req = mockReq('/api/booking', 'POST');
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    res.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    const params = insertCalls[0][1];
    expect(params[1]).toBe('checkout');
  });

  it('classifies QR generation as booking_confirmed', async () => {
    const req = mockReq('/api/qr/generate', 'POST');
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    res.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    const params = insertCalls[0][1];
    expect(params[1]).toBe('booking_confirmed');
  });

  it('classifies creator landing page', async () => {
    const req = mockReq('/creators/r/johndoe');
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    res.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    const params = insertCalls[0][1];
    expect(params[1]).toBe('creator_landing');
  });

  it('returns null funnel step for unclassified paths', async () => {
    const req = mockReq('/api/random/endpoint');
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    res.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    const params = insertCalls[0][1];
    expect(params[1]).toBeNull();
  });

  it('classifies event_type as api_call for /api/ paths', async () => {
    const req = mockReq('/api/guest/gyms');
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    res.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    const params = insertCalls[0][1];
    expect(params[0]).toBe('api_call');
  });

  it('classifies event_type as page_view for non-api paths', async () => {
    const req = mockReq('/about');
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    res.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    const params = insertCalls[0][1];
    expect(params[0]).toBe('page_view');
  });

  it('includes user_id when user is authenticated', async () => {
    const req = mockReq('/api/booking', 'POST', { user: { id: 'user-42' } });
    const res = mockRes();
    const next = jest.fn();

    analyticsMiddleware(req, res, next);
    res.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const insertCalls = pool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO analytics_events')
    );
    const params = insertCalls[0][1];
    expect(params[4]).toBe('user-42');
  });
});
