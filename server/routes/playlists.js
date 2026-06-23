/**
 * Music Playlists API — Server-side playlist storage
 * 
 * Endpoints:
 *   POST   /api/playlists/save          — Save/unsave a track to user's playlist
 *   GET    /api/playlists               — Get user's playlists with track counts
 *   GET    /api/playlists/:id           — Get a single playlist with tracks
 *   DELETE /api/playlists/:id/tracks/:trackId — Remove a specific track
 *   GET    /api/playlists/share/:id     — Public shareable playlist (adds affiliate link)
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════
// DB Migration — creates playlist tables on startup
// ═══════════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_playlists (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        title VARCHAR(200) NOT NULL DEFAULT 'My Playlist',
        description TEXT DEFAULT '',
        is_public BOOLEAN DEFAULT false,
        share_token VARCHAR(100) UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        id SERIAL PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
        track_name VARCHAR(300) NOT NULL,
        artist VARCHAR(300) DEFAULT '',
        source_playlist VARCHAR(200) DEFAULT '',
        source_index INTEGER DEFAULT 0,
        saved_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(playlist_id, track_name, artist)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_playlists_user ON user_playlists(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pid ON playlist_tracks(playlist_id)`);
    console.log('[Playlists] Tables ready');
  } catch (e) {
    console.warn('[Playlists] Migration skipped:', e.message);
  }
})();

// Helper: generate share token
function generateShareToken() {
  return 'sg_pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─────────────────────────────────────────────────────────────────
//  POST /api/playlists/save
//  Save or unsave a track. Auto-creates playlist if needed.
// ─────────────────────────────────────────────────────────────────
router.post('/save', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { trackName, artist, playlistTitle, sourcePlaylist, sourceIndex } = req.body;
    if (!trackName) return res.status(400).json({ error: 'trackName required' });

    const plTitle = playlistTitle || sourcePlaylist || 'My Playlist';

    // Find or create playlist
    let playlist = await pool.query(
      'SELECT * FROM user_playlists WHERE user_id = $1 AND title = $2 LIMIT 1',
      [userId, plTitle]
    );
    if (playlist.rows.length === 0) {
      playlist = await pool.query(
        `INSERT INTO user_playlists (user_id, title, share_token) VALUES ($1, $2, $3) RETURNING *`,
        [userId, plTitle, generateShareToken()]
      );
    }
    const playlistId = playlist.rows[0].id;

    // Check if track already saved
    const existing = await pool.query(
      'SELECT id FROM playlist_tracks WHERE playlist_id = $1 AND track_name = $2 AND artist = $3',
      [playlistId, trackName, artist || '']
    );

    if (existing.rows.length > 0) {
      // Unsave — remove track
      await pool.query('DELETE FROM playlist_tracks WHERE id = $1', [existing.rows[0].id]);
      await pool.query('UPDATE user_playlists SET updated_at = NOW() WHERE id = $1', [playlistId]);
      return res.json({ success: true, saved: false, message: 'Track removed from playlist' });
    }

    // Save track
    await pool.query(
      `INSERT INTO playlist_tracks (playlist_id, track_name, artist, source_playlist, source_index)
       VALUES ($1, $2, $3, $4, $5)`,
      [playlistId, trackName, artist || '', sourcePlaylist || '', sourceIndex || 0]
    );
    await pool.query('UPDATE user_playlists SET updated_at = NOW() WHERE id = $1', [playlistId]);

    res.json({
      success: true,
      saved: true,
      playlistId,
      shareToken: playlist.rows[0].share_token,
      message: `Saved to "${plTitle}"`,
    });
  } catch (err) {
    console.error('[Playlists] Save error:', err.message);
    res.status(500).json({ error: 'Failed to save track' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/playlists
//  Get all playlists for the logged-in user
// ─────────────────────────────────────────────────────────────────
router.get('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const playlists = await pool.query(
      `SELECT p.*, COUNT(pt.id) as track_count
       FROM user_playlists p
       LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
       WHERE p.user_id = $1
       GROUP BY p.id
       ORDER BY p.updated_at DESC`,
      [userId]
    );
    res.json({ success: true, playlists: playlists.rows });
  } catch (err) {
    console.error('[Playlists] List error:', err.message);
    res.status(500).json({ error: 'Failed to load playlists' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/playlists/:id
//  Get a single playlist with all tracks
// ─────────────────────────────────────────────────────────────────
router.get('/:id', authenticateUser, async (req, res) => {
  try {
    const playlist = await pool.query(
      'SELECT * FROM user_playlists WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (playlist.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });

    const tracks = await pool.query(
      'SELECT * FROM playlist_tracks WHERE playlist_id = $1 ORDER BY saved_at DESC',
      [req.params.id]
    );
    res.json({ success: true, playlist: playlist.rows[0], tracks: tracks.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load playlist' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  DELETE /api/playlists/:playlistId/tracks/:trackId
//  Remove a specific track
// ─────────────────────────────────────────────────────────────────
router.delete('/:playlistId/tracks/:trackId', authenticateUser, async (req, res) => {
  try {
    // Verify ownership
    const pl = await pool.query(
      'SELECT id FROM user_playlists WHERE id = $1 AND user_id = $2',
      [req.params.playlistId, req.user.id]
    );
    if (pl.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });

    await pool.query('DELETE FROM playlist_tracks WHERE id = $1 AND playlist_id = $2', [req.params.trackId, req.params.playlistId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove track' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/playlists/share/:token
//  Public shareable playlist — no auth needed
//  Appends affiliate link if ?ref= param is present
// ─────────────────────────────────────────────────────────────────
router.get('/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { ref } = req.query; // affiliate ref code

    const playlist = await pool.query(
      'SELECT * FROM user_playlists WHERE share_token = $1',
      [token]
    );
    if (playlist.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });

    const tracks = await pool.query(
      'SELECT track_name, artist, source_playlist, saved_at FROM playlist_tracks WHERE playlist_id = $1 ORDER BY saved_at DESC',
      [playlist.rows[0].id]
    );

    // Build share URL with affiliate link
    let affiliateUrl = null;
    if (ref) {
      affiliateUrl = `https://scangym.com/r/${encodeURIComponent(ref)}`;

      // Track the share view as a referral click
      try {
        await pool.query(
          `INSERT INTO creator_referrals (creator_handle, visitor_session, status)
           VALUES ($1, $2, 'clicked')`,
          [ref, req.headers['x-forwarded-for'] || req.ip || 'unknown']
        );
      } catch (e) {} // Table might not exist
    }

    res.json({
      success: true,
      playlist: {
        title: playlist.rows[0].title,
        trackCount: tracks.rows.length,
        createdAt: playlist.rows[0].created_at,
      },
      tracks: tracks.rows,
      affiliateUrl,
      bookGymUrl: ref
        ? `https://scangym.com/?ref=${encodeURIComponent(ref)}`
        : 'https://scangym.com',
    });
  } catch (err) {
    console.error('[Playlists] Share error:', err.message);
    res.status(500).json({ error: 'Failed to load shared playlist' });
  }
});

module.exports = router;
