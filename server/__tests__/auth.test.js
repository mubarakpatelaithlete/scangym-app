// Mock the db module before requiring auth
jest.mock('../middleware/db', () => ({
  query: jest.fn(),
}));

const pool = require('../middleware/db');
const { authenticateUser, optionalAuth, requireAdmin } = require('../middleware/auth');

function mockReq(overrides = {}) {
  return {
    session: null,
    user: null,
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('auth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_USER_IDS;
  });

  describe('authenticateUser', () => {
    it('returns 401 when no session exists', async () => {
      const req = mockReq({ session: null });
      const res = mockRes();
      const next = jest.fn();

      await authenticateUser(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Not authenticated' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when session has no userId', async () => {
      const req = mockReq({ session: {} });
      const res = mockRes();
      const next = jest.fn();

      await authenticateUser(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next and sets req.user when user is found', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'user-123',
          phone_number: '+447000000000',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@example.com',
        }],
      });

      const req = mockReq({ session: { userId: 'user-123' } });
      const res = mockRes();
      const next = jest.fn();

      await authenticateUser(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual({
        id: 'user-123',
        phone: '+447000000000',
        phone_number: '+447000000000',
        name: 'John Doe',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
      });
    });

    it('normalizes name when only first_name exists', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'user-456',
          phone_number: '+1234567890',
          first_name: 'Jane',
          last_name: null,
          email: null,
        }],
      });

      const req = mockReq({ session: { userId: 'user-456' } });
      const res = mockRes();
      const next = jest.fn();

      await authenticateUser(req, res, next);

      expect(req.user.name).toBe('Jane');
    });

    it('sets name to null when both first and last name are null', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'user-789',
          phone_number: '+1234567890',
          first_name: null,
          last_name: null,
          email: null,
        }],
      });

      const req = mockReq({ session: { userId: 'user-789' } });
      const res = mockRes();
      const next = jest.fn();

      await authenticateUser(req, res, next);

      expect(req.user.name).toBeNull();
    });

    it('destroys stale session when user not found in DB', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const destroy = jest.fn();
      const req = mockReq({ session: { userId: 'deleted-user', destroy } });
      const res = mockRes();
      const next = jest.fn();

      await authenticateUser(req, res, next);

      expect(destroy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 500 on database error', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      const req = mockReq({ session: { userId: 'user-123' } });
      const res = mockRes();
      const next = jest.fn();

      await authenticateUser(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Auth check failed' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuth', () => {
    it('calls next even when no session exists', async () => {
      const req = mockReq({ session: null });
      const res = mockRes();
      const next = jest.fn();

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeNull();
    });

    it('sets req.user when session is valid', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'user-opt-1',
          phone_number: '+447111111111',
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@test.com',
        }],
      });

      const req = mockReq({ session: { userId: 'user-opt-1' } });
      const res = mockRes();
      const next = jest.fn();

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('user-opt-1');
    });

    it('calls next without error on DB failure', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB down'));

      const req = mockReq({ session: { userId: 'user-123' } });
      const res = mockRes();
      const next = jest.fn();

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireAdmin', () => {
    it('returns 401 when req.user is not set', () => {
      const req = mockReq({ user: null });
      const res = mockRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows access when user email matches ADMIN_EMAILS', () => {
      process.env.ADMIN_EMAILS = 'admin@gym.com,boss@gym.com';
      const req = mockReq({ user: { id: 'u1', email: 'admin@gym.com' } });
      const res = mockRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('is case-insensitive for email matching', () => {
      process.env.ADMIN_EMAILS = 'Admin@Gym.com';
      const req = mockReq({ user: { id: 'u1', email: 'admin@gym.com' } });
      const res = mockRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('allows access when user ID matches ADMIN_USER_IDS', () => {
      process.env.ADMIN_USER_IDS = 'u1,u2,u3';
      const req = mockReq({ user: { id: 'u2', email: 'nobody@test.com' } });
      const res = mockRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('denies access when user is not an admin', () => {
      process.env.ADMIN_EMAILS = 'admin@gym.com';
      process.env.ADMIN_USER_IDS = 'admin-1';
      const req = mockReq({ user: { id: 'regular-user', email: 'user@test.com' } });
      const res = mockRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('denies everyone when no admin env vars are set (secure by default)', () => {
      const req = mockReq({ user: { id: 'u1', email: 'someone@test.com' } });
      const res = mockRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('trims whitespace from ADMIN_EMAILS entries', () => {
      process.env.ADMIN_EMAILS = ' admin@gym.com , boss@gym.com ';
      const req = mockReq({ user: { id: 'u1', email: 'boss@gym.com' } });
      const res = mockRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
