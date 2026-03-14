const router = require('express').Router();
const supabase = require('../supabase');
const { requireAuth } = require('../middleware/auth');

// GET /api/auth/me - returns current user + their workspaces
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data: profile } = await supabase
      .from('users')
      .select('*, workspaces(*)')
      .eq('id', req.user.id)
      .single();
    if (!profile || !profile.workspaces || !profile.workspaces.length) {
      const { data: ws } = await supabase.from('workspaces').select('*').eq('owner_id', req.user.id);
      if (profile) profile.workspaces = ws || [];
    }
    res.json({ user: profile });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/meta-token', requireAuth, async (req, res) => {
  try {
    const { workspace_id, account_id, account_name, currency, access_token } = req.body;
    if (!workspace_id || !account_id || !access_token) return res.status(400).json({ error: 'Missing fields' });
    const { data: ws } = await supabase.from('workspaces').select('id').eq('id', workspace_id).eq('owner_id', req.user.id).single();
    if (!ws) return res.status(403).json({ error: 'Not your workspace' });
    const { data, error } = await supabase.from('connections').upsert({ workspace_id, platform:'meta', account_id, account_name, currency:currency||'USD', access_token }, { onConflict: 'workspace_id,platform,account_id' }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ connection: { ...data, access_token:'[stored]' } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
