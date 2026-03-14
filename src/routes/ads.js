const router = require('express').Router();
const fetch = require('node-fetch');
const supabase = require('../supabase');
const { requireAuth } = require('../middleware/auth');
const FB_BASE = 'https://graph.facebook.com/v19.0';
async function getToken(wId, cId, uId) {
  const { data } = await supabase.from('connections').select('access_token, account_id, currency').eq('id', cId).eq('workspace_id', wId).single();
  if (!data) return null;
  const { data: ws } = await supabase.from('workspaces').select('id, owner_id').eq('id', wId).single();
  if (ws && ws.owner_id === uId) return data;
  const { data: member } = await supabase.from('workspace_members').select('role').eq('workspace_id', wId).eq('user_id', uId).eq('status', 'active').single();
  return member ? data : null;
}
async function metaProxy(path, params, token) {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  return (await fetch(`${FB_BASE}/${path}?${qs}`)).json();
}
requireAuth, async (req, res) => { router.get('/campaigns',
  try {
    const { workspace_id, connection_id, since, until } = req.query;
    const conn = await getToken(workspace_id, connection_id, req.user.id);
    if (!conn) return res.status(403).json({ error: 'Access denied' });
    const trStr = `{"since":"${since}","until":"${until}"}`;
    const fields = `name,status,objective,daily_budget,lifetime_budget,insights.time_range(${trStr}){spend,impressions,reach,clicks,ctr,cpm,cpc,actions,cost_per_action_type,frequency}`;
    const data = await metaProxy(`act_${conn.account_id}/campaigns`, { fields, limit: '100' }, conn.access_token);
    res.json({ ...data, currency: conn.currency });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/adsets', requireAuth, async (req, res) => {
  try {
    const { workspace_id, connection_id, campaign_id, since, until } = req.query;
    const conn = await getToken(workspace_id, connection_id, req.user.id);
    if (!conn) return res.status(403).json({ error: 'Access denied' });
    const trStr = `{"since":"${since}","until":"${until}"}`;
    const data = await metaProxy(`${campaign_id}/adsets`, { fields:`name,status,insights.time_range(${trStr}){spend,impressions,clicks,ctr,cpm,actions}`, limit:'25' }, conn.access_token);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/ads', requireAuth, async (req, res) => {
  try {
    const { workspace_id, connection_id, adset_id, since, until } = req.query;
    const conn = await getToken(workspace_id, connection_id, req.user.id);
    if (!conn) return res.status(403).json({ error: 'Access denied' });
    const trStr = `{"since":"${since}","until":"${until}"}`;
    const data = await metaProxy(`${adset_id}/ads`, { fields:`name,status,creative{title,body,image_url},insights.time_range(${trStr}){spend,impressions,clicks,ctr,cpm,actions}`, limit:'20' }, conn.access_token);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
