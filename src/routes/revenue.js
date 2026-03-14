const router = require('express').Router();
const supabase = require('../supabase');
const { requireAuth } = require('../middleware/auth');

// POST /api/revenue/event - record revenue from CRM webhook
router.post('/event', async (req, res) => {
  try {
    let pixelId = req.body.pixel_id;
    if (!pixelId && req.headers['x-pixel-token']) {
      const { data: pixel } = await supabase.from('pixels').select('id').eq('pixel_token', req.headers['x-pixel-token']).single();
      if (pixel) pixelId = pixel.id;
    }
    if (!pixelId) return res.status(400).json({ error: 'Missing pixel_id or x-pixel-token header' });
    const { email, amount, currency, event_type, crm_deal_id, click_id } = req.body;
    if (!amount) return res.status(400).json({ error: 'Missing amount' });
    let leadId = null;
    let resolvedClickId = click_id || null;
    let attributed = {};
    if (email) {
      const { data: lead } = await supabase.from('leads').select('id, click_id').eq('pixel_id', pixelId).eq('email', email).order('created_at', { ascending: false }).limit(1).single();
      if (lead) { leadId = lead.id; if (!resolvedClickId) resolvedClickId = lead.click_id; }
    }
    if (resolvedClickId) {
      const { data: click } = await supabase.from('clicks').select('campaign_id, adset_id, ad_id, platform, utm_campaign').eq('click_id', resolvedClickId).single();
      if (click) attributed = { campaign_id: click.campaign_id, adset_id: click.adset_id, ad_id: click.ad_id, platform: click.platform, utm_campaign: click.utm_campaign };
    }
    const { data, error } = await supabase.from('revenue_events').insert({
      pixel_id: pixelId, lead_id: leadId, click_id: resolvedClickId,
      email, amount: parseFloat(amount), currency: currency || 'USD',
      event_type: event_type || 'sale', crm_deal_id: crm_deal_id || null,
      attributed_to: attributed
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, event_id: data.id, attributed_to: attributed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/revenue/roas - ROAS per campaign
router.get('/roas', requireAuth, async (req, res) => {
  try {
    const { workspace_id, since, until } = req.query;
    const { data: ws } = await supabase.from('workspaces').select('id').eq('id', workspace_id).eq('owner_id', req.user.id).single();
    if (!ws) return res.status(403).json({ error: 'Not your workspace' });
    const { data: pixels } = await supabase.from('pixels').select('id').eq('workspace_id', workspace_id);
    const pixelIds = (pixels || []).map(p => p.id);
    if (!pixelIds.length) return res.json({ roas: [] });
    let query = supabase.from('revenue_events').select('amount, currency, attributed_to, created_at').in('pixel_id', pixelIds).eq('event_type', 'sale');
    if (since) query = query.gte('created_at', since);
    if (until) query = query.lte('created_at', until + 'T23:59:59Z');
    const { data: events } = await query;
    const bycamp = {};
    (events || []).forEach(ev => {
      const cid = ev.attributed_to && ev.attributed_to.campaign_id ? ev.attributed_to.campaign_id : 'unattributed';
      if (!bycamp[cid]) bycamp[cid] = { campaign_id: cid, revenue: 0, events: 0 };
      bycamp[cid].revenue += parseFloat(ev.amount);
      bycamp[cid].events += 1;
    });
    res.json({ roas: Object.values(bycamp), total_revenue: Object.values(bycamp).reduce((s, c) => s + c.revenue, 0), total_events: Object.values(bycamp).reduce((s, c) => s + c.events, 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/revenue/leads - lead list with attribution
router.get('/leads', requireAuth, async (req, res) => {
  try {
    const { workspace_id, since, until, page = 1, limit = 50 } = req.query;
    const { data: ws } = await supabase.from('workspaces').select('id').eq('id', workspace_id).eq('owner_id', req.user.id).single();
    if (!ws) return res.status(403).json({ error: 'Not your workspace' });
    const { data: pixels } = await supabase.from('pixels').select('id').eq('workspace_id', workspace_id);
    const pixelIds = (pixels || []).map(p => p.id);
    if (!pixelIds.length) return res.json({ leads: [], total: 0 });
    let query = supabase.from('leads').select('*, clicks(campaign_id, adset_id, platform, utm_campaign), revenue_events(amount, currency, event_type)', { count: 'exact' }).in('pixel_id', pixelIds).order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1);
    if (since) query = query.gte('created_at', since);
    if (until) query = query.lte('created_at', until + 'T23:59:59Z');
    const { data, count } = await query;
    res.json({ leads: data || [], total: count || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
