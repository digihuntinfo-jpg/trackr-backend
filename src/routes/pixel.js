var router = require('express').Router();
var supabase = require('../supabase');
var { requireAuth } = require('../middleware/auth');

// ─── OPEN ENDPOINTS (called from client sites, no auth) ───

// POST /click — track pageview/click from pixel.js
router.post('/click', function(req, res) {
  var body = req.body;
  if (!body.pixel_id) return res.status(400).json({ error: 'Missing pixel_id' });

  var row = {
    pixel_id: body.pixel_id,
    click_id: body.click_id || null,
    visitor_id: body.visitor_id || null,
    session_id: body.session_id || null,
    platform: body.platform || null,
    landing_url: body.page_url || body.landing_url || null,
    referrer: body.referrer || null,
    utm_source: body.utm_source || null,
    utm_medium: body.utm_medium || null,
    utm_campaign: body.utm_campaign || null,
    utm_content: body.utm_content || null,
    utm_term: body.utm_term || null,
    fbclid: body.fbclid || null,
    gclid: body.gclid || null,
    ip: req.ip,
    user_agent: req.headers['user-agent'] || null,
    event_type: body.event_type || 'pageview'
  };

  supabase.from('clicks').insert(row)
    .then(function(result) {
      if (result.error) {
        console.error('[pixel/click]', result.error.message);
        return res.status(500).json({ error: result.error.message });
      }
      res.json({ ok: true });
    })
    .catch(function(e) {
      console.error('[pixel/click]', e.message);
      res.status(500).json({ error: e.message });
    });
});

// POST /lead — capture lead from pixel.js
router.post('/lead', function(req, res) {
  var body = req.body;
  if (!body.pixel_id) return res.status(400).json({ error: 'Missing pixel_id' });

  var row = {
    pixel_id: body.pixel_id,
    click_id: body.click_id || null,
    visitor_id: body.visitor_id || null,
    email: body.email || null,
    phone: body.phone || null,
    name: body.name || null,
    source_url: body.page_url || body.source_url || null,
    utm_source: body.utm_source || null,
    utm_medium: body.utm_medium || null,
    utm_campaign: body.utm_campaign || null,
    fbclid: body.fbclid || null,
    gclid: body.gclid || null,
    referrer: body.referrer || null,
    meta: body.meta || {}
  };

  supabase.from('leads').insert(row).select().single()
    .then(function(result) {
      if (result.error) {
        console.error('[pixel/lead]', result.error.message);
        return res.status(500).json({ error: result.error.message });
      }
      res.json({ ok: true, lead_id: result.data.id });
    })
    .catch(function(e) {
      console.error('[pixel/lead]', e.message);
      res.status(500).json({ error: e.message });
    });
});

// ─── AUTHENTICATED ENDPOINTS (called from dashboard) ───

// GET / — list pixels for workspace
router.get('/', requireAuth, function(req, res) {
  var wsId = req.query.workspace_id;

  var query = supabase.from('pixels').select('*');
  if (wsId) query = query.eq('workspace_id', wsId);

  query.order('created_at', { ascending: false })
    .then(function(result) {
      if (result.error) return res.status(500).json({ error: result.error.message });

      var pixels = result.data || [];

      // Get click and lead counts per pixel
      var pixelIds = pixels.map(function(p) { return p.id; });
      if (pixelIds.length === 0) return res.json({ pixels: [] });

      // Fetch counts in parallel
      Promise.all([
        supabase.from('clicks').select('pixel_id', { count: 'exact', head: false })
          .in('pixel_id', pixelIds),
        supabase.from('leads').select('pixel_id', { count: 'exact', head: false })
          .in('pixel_id', pixelIds)
      ]).then(function(results) {
        var clickRows = (results[0].data || []);
        var leadRows = (results[1].data || []);

        // Count per pixel
        var clickCounts = {};
        var leadCounts = {};
        clickRows.forEach(function(r) { clickCounts[r.pixel_id] = (clickCounts[r.pixel_id] || 0) + 1; });
        leadRows.forEach(function(r) { leadCounts[r.pixel_id] = (leadCounts[r.pixel_id] || 0) + 1; });

        pixels.forEach(function(p) {
          p.click_count = clickCounts[p.id] || 0;
          p.lead_count = leadCounts[p.id] || 0;
        });

        res.json({ pixels: pixels });
      }).catch(function() {
        // Return pixels without counts if count query fails
        res.json({ pixels: pixels });
      });
    })
    .catch(function(e) {
      res.status(500).json({ error: e.message });
    });
});

// POST / — create a new pixel
router.post('/', requireAuth, function(req, res) {
  var body = req.body;
  if (!body.name) return res.status(400).json({ error: 'Pixel name required' });

  // Generate a pixel ID like PX_xxxxxxxxxxxx
  var chars = 'abcdef0123456789';
  var pixelId = 'PX_';
  for (var i = 0; i < 12; i++) {
    pixelId += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  var row = {
    pixel_id: pixelId,
    name: body.name,
    domain: body.domain || null,
    workspace_id: body.workspace_id || null,
    user_id: req.user.id,
    active: true
  };

  supabase.from('pixels').insert(row).select().single()
    .then(function(result) {
      if (result.error) return res.status(500).json({ error: result.error.message });
      res.json({ pixel: result.data });
    })
    .catch(function(e) {
      res.status(500).json({ error: e.message });
    });
});

// DELETE /:id — delete a pixel
router.delete('/:id', requireAuth, function(req, res) {
  supabase.from('pixels').delete().eq('id', req.params.id)
    .then(function(result) {
      if (result.error) return res.status(500).json({ error: result.error.message });
      res.json({ ok: true });
    })
    .catch(function(e) {
      res.status(500).json({ error: e.message });
    });
});

// GET /lead — list leads (for dashboard Leads tab)
router.get('/lead', requireAuth, function(req, res) {
  var wsId = req.query.workspace_id;
  var limit = parseInt(req.query.limit) || 500;

  // First get pixel IDs for this workspace
  var pxQuery = supabase.from('pixels').select('id');
  if (wsId) pxQuery = pxQuery.eq('workspace_id', wsId);

  pxQuery.then(function(pxResult) {
    var pixelIds = (pxResult.data || []).map(function(p) { return p.id; });

    if (pixelIds.length === 0) return res.json({ leads: [] });

    supabase.from('leads').select('*')
      .in('pixel_id', pixelIds)
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(function(result) {
        if (result.error) return res.status(500).json({ error: result.error.message });
        res.json({ leads: result.data || [] });
      })
      .catch(function(e) {
        res.status(500).json({ error: e.message });
      });
  }).catch(function(e) {
    res.status(500).json({ error: e.message });
  });
});

module.exports = router;
