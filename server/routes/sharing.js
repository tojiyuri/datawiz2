/**
 * Sharing routes
 *
 *   GET    /api/share/with-me               List sheets/dashboards shared with me
 *   POST   /api/share/sheet/:id             Share sheet with another user by email
 *   POST   /api/share/dashboard/:id         Share dashboard
 *   GET    /api/share/sheet/:id/users       List users sheet is shared with
 *   GET    /api/share/dashboard/:id/users   List users dashboard is shared with
 *   DELETE /api/share/sheet/:id/users/:userId   Revoke a user's access
 *   DELETE /api/share/dashboard/:id/users/:userId
 *   POST   /api/share/sheet/:id/link        Create a public share link
 *   POST   /api/share/dashboard/:id/link    Create a public share link
 *   GET    /api/share/sheet/:id/links       List active share links
 *   DELETE /api/share/links/:linkId         Revoke a share link
 *   GET    /api/share/public/:token         Resolve a public token to a resource (no auth)
 */

const express = require('express');
const router = express.Router();

const sharing = require('../utils/sharing');
const authStore = require('../utils/authStore');
const audit = require('../utils/audit');
const email = require('../utils/email');
const { requireAuth, optionalAuth } = require('../middleware/auth');

router.get('/with-me', requireAuth, (req, res) => {
  res.json(sharing.listSharedWithMe(req.user.id));
});

// ─── User-to-user sharing ────────────────────────────────────────────────────

async function shareWithUser(resourceType, req, res) {
  try {
    const { id } = req.params;
    const { email: targetEmail, role = 'view', notify = true } = req.body || {};
    if (!targetEmail) return res.status(400).json({ error: 'Email required' });
    if (!['view', 'edit'].includes(role)) return res.status(400).json({ error: 'role must be view or edit' });

    const target = authStore.getUserByEmail(targetEmail);
    if (!target) return res.status(404).json({ error: 'No user with that email' });

    sharing.grantPermission({
      resourceType, resourceId: id, userId: target.id, role,
      grantedBy: req.user.id,
    });

    audit.logFromReq(req, `${resourceType}.share`, {
      resourceId: id, resourceType,
      metadata: { targetUserId: target.id, role },
    });

    // Send notification email (best-effort)
    if (notify) {
      try {
        const link = `${process.env.CLIENT_URL || 'http://localhost:5173'}/${resourceType === 'sheet' ? 'sheet' : 'composer'}/${id}`;
        const msg = email.shareNotificationMessage({
          ownerName: req.user.name,
          ownerEmail: req.user.email,
          resourceName: id,
          resourceType,
          link,
        });
        await email.send({ to: target.email, ...msg });
      } catch (_) { /* don't block on email */ }
    }

    res.json({ ok: true, sharedWith: { id: target.id, email: target.email, role } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.post('/sheet/:id', requireAuth, (req, res) => shareWithUser('sheet', req, res));
router.post('/dashboard/:id', requireAuth, (req, res) => shareWithUser('dashboard', req, res));

router.get('/sheet/:id/users', requireAuth, (req, res) => {
  const access = sharing.canAccess({ resourceType: 'sheet', resourceId: req.params.id, userId: req.user.id });
  if (access !== 'owner') return res.status(403).json({ error: 'Owner only' });
  res.json({ users: sharing.listPermissions({ resourceType: 'sheet', resourceId: req.params.id }) });
});

router.get('/dashboard/:id/users', requireAuth, (req, res) => {
  const access = sharing.canAccess({ resourceType: 'dashboard', resourceId: req.params.id, userId: req.user.id });
  if (access !== 'owner') return res.status(403).json({ error: 'Owner only' });
  res.json({ users: sharing.listPermissions({ resourceType: 'dashboard', resourceId: req.params.id }) });
});

router.delete('/sheet/:id/users/:userId', requireAuth, (req, res) => {
  try {
    const ok = sharing.revokePermission({
      resourceType: 'sheet', resourceId: req.params.id, userId: req.params.userId,
      revokedBy: req.user.id,
    });
    audit.logFromReq(req, 'sheet.unshare', {
      resourceId: req.params.id, metadata: { userId: req.params.userId },
    });
    res.json({ ok });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

router.delete('/dashboard/:id/users/:userId', requireAuth, (req, res) => {
  try {
    const ok = sharing.revokePermission({
      resourceType: 'dashboard', resourceId: req.params.id, userId: req.params.userId,
      revokedBy: req.user.id,
    });
    audit.logFromReq(req, 'dashboard.unshare', {
      resourceId: req.params.id, metadata: { userId: req.params.userId },
    });
    res.json({ ok });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// ─── Public share links ──────────────────────────────────────────────────────

router.post('/sheet/:id/link', requireAuth, (req, res) => {
  try {
    const { expiresAt = null } = req.body || {};
    const result = sharing.createShareLink({
      resourceType: 'sheet', resourceId: req.params.id,
      createdBy: req.user.id, expiresAt,
    });
    audit.logFromReq(req, 'sheet.share_link.create', { resourceId: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

router.post('/dashboard/:id/link', requireAuth, (req, res) => {
  try {
    const { expiresAt = null } = req.body || {};
    const result = sharing.createShareLink({
      resourceType: 'dashboard', resourceId: req.params.id,
      createdBy: req.user.id, expiresAt,
    });
    audit.logFromReq(req, 'dashboard.share_link.create', { resourceId: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

router.get('/sheet/:id/links', requireAuth, (req, res) => {
  res.json({ links: sharing.listShareLinks({ resourceType: 'sheet', resourceId: req.params.id }) });
});

router.get('/dashboard/:id/links', requireAuth, (req, res) => {
  res.json({ links: sharing.listShareLinks({ resourceType: 'dashboard', resourceId: req.params.id }) });
});

router.delete('/links/:linkId', requireAuth, (req, res) => {
  const ok = sharing.revokeShareLink(req.params.linkId, req.user.id);
  res.json({ ok });
});

// Public resolution: anyone with the token can fetch the resource id
// (the actual data is fetched separately, with the link acting as a "view-only" auth)
router.get('/public/:token', (req, res) => {
  const link = sharing.findShareLink(req.params.token);
  if (!link) return res.status(404).json({ error: 'Invalid or expired link' });
  res.json({
    resourceType: link.resource_type,
    resourceId: link.resource_id,
    expiresAt: link.expires_at,
  });
});

module.exports = router;
