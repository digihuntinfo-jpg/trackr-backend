const router = require('express').Router();
const fetch = require('node-fetch');
const supabase = require('../supabase');
const { requireAuth } = require('../middleware/auth');

const FB_BASE = 'https://graph.facebook.com/v19.0';

async function getToken(wId, cId, uId) {
  const { data } = await supabase.from('connections').select('access_token, account_id, currency').eq('id', cId).eq('workspace_id', wId).single();
  if (!data) return null;
  const { data: ws } = await supabase.from('workspaces').select('id, owner_id').eq('id', wId).single();
  if (ws && ws.owner_id !== uId) return null;
  return data;
}

async function metaProxy(path, params, token) {
  const qs = new URLSearchParams(Object.assign({}, params, { access_token: token })).toString();
  const resp = await fetch(FB_BASE + '/' + path + '?' + qs);
  return resp.json();
}

router.get('/campaigns', requireAuth, async function(req, res) {
  try {
    const conn = await getToken(req.query.workspace_id, req.query.connection_id, req.user.id);
    if (!conn) return res.status(403).json({ error: 'Access denied' });
    const tr = '{"since":"' + req.query.since + '","until":"' + req.query.until + '"}';
    const fields = 'name,status,objective,daily_budget,lifetime_budget,insights.time_range(' + tr + '){spend,impressions,reach,clicks,ctr,cpm,cpc,actions,cost_per_action_type,frequency}';
    const data = await metaProxy('act_' + conn.account_id + '/campaigns', { fields: fields, limit: '100' }, conn.access_token);
    res.json(Object.assign({}, data, { currency: conn.currency }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/account-insights', requireAuth, async function(req, res) {
  try {
    const conn = await getToken(req.query.workspace_id, req.query.connection_id, req.user.id);
    if (!conn) return res.status(403).json({ error: 'Access denied' });
    const since = req.query.since;
    const until = req.query.until;
    const tr = JSON.stringify({ since: since, until: until });
    const days = Math.round((new Date(until) - new Date(since)) / 86400000) + 1;
    const pu = new Date(new Date(since).getTime() - 86400000);
    const ps = new Date(pu.getTime() - (days - 1) * 86400000);
    const prevTr = JSON.stringify({ since: ps.toISOString().split('T')[0], until: pu.toISOString().split('T')[0] });
    const results = await Promise.all([
      metaProxy('act_' + conn.account_id + '/insights', { fields: 'spend,impressions,reach,clicks,ctr,cpm,cpc,actions,frequency', time_range: tr }, conn.access_token),
      metaProxy('act_' + conn.account_id + '/insights', { fields: 'spend,impressions,clicks,ctr,cpm,actions', time_range: prevTr }, conn.access_token),
      metaProxy('act_' + conn.account_id + '/insights', { fields: 'spend,impressions,clicks,actions', time_range: tr, time_increment: '1', level: 'account' }, conn.access_token)
    ]);
    res.json({ current: results[0], prev: results[1], daily: results[2], currency: conn.currency });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/adsets', requireAuth, async function(req, res) {
  try {
    const conn = await getToken(req.query.workspace_id, req.query.connection_id, req.user.id);
    if (!conn) return res.status(403).json({ error: 'Access denied' });
    const tr = '{"since":"' + req.query.since + '","until":"' + req.query.until + '"}';
    const data = await metaProxy(req.query.campaign_id + '/adsets', { fields: 'name,status,insights.time_range(' + tr + '){spend,impressions,clicks,ctr,cpm,actions,frequency}', limit: '25' }, conn.access_token);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ads', requireAuth, async function(req, res) {
  try {
    const conn = await getToken(req.query.workspace_id, req.query.connection_id, req.user.id);
    if (!conn) return res.status(403).json({ error: 'Access denied' });
    const tr = '{"since":"' + req.query.since + '","until":"' + req.query.until + '"}';
    const data = await metaProxy(req.query.adset_id + '/ads', { fields: 'name,status,creative{title,body,image_url},insights.time_range(' + tr + '){spend,impressions,clicks,ctr,cpm,actions}', limit: '20' }, conn.access_token);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/accounts', requireAuth, async function(req, res) {
  try {
    const conn = await getToken(req.query.workspace_id, req.query.connection_id, req.user.id);
    if (!conn) return res.status(403).json({ error: 'Access denied' });
    const data = await metaProxy('me/adaccounts', { fields: 'name,account_id,account_status,currency', limit: '50' }, conn.access_token);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
