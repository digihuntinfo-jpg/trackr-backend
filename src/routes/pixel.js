var router = require('express').Router();
var supabase = require('../supabase');
var { requireAuth } = require('../middleware/auth');

// Helper: resolve PX_ text ID to UUID
function resolvePixelId(pixelIdText, callback) {
  supabase.from('pixels').select('id').eq('pixel_id', pixelIdText).single()
    .then(function(result) {
      if (result.error || !result.data) {
        callback(null);
      } else {
        callback(result.data.id);
      }
    })
    .catch(function() {
      callback(null);
    });
}

// POST /click - track pageview/click from pixel.js (open, no auth)
router.post('/click', function(req, res) {
  var body = req.body;
  if (!body.pixel_id) return res.status(400).json({ error: 'Missing pixel_id' });

  resolvePixelId(body.pixel_id, function(uuid) {
    if (!uuid) return res.status(404).json({ error: 'Pixel not found' });

    var row = {
      pixel_id: uuid,
      click_id: body.click_id || body.visitor_id || null,
      platform: body.platform || null,
      landing_url: body.page_url || body.landing_url || null,
      ip: req.ip,
      user_agent: req.headers['user-agent'] || null
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
});

// POST /lead - capture lead from pixel.js (open, no auth)
router.post('/lead', function(req, res) {
  var body = req.body;
  if (!body.pixel_id) return res.status(400).json({ error: 'Missing pixel_id' });

  resolvePixelId(body.pixel_id, function(uuid) {
    if (!uuid) return res.status(404).json({ error: 'Pixel not found' });

    var row = {
      pixel_id: uuid,
      click_id: body.click_id || body.visitor_id || null,
      email: body.email || null,
      phone: body.phone || null,
      name: body.name || null,
      source_url: body.page_url || body.source_url || null,
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
});

// GET / - list pixels for workspace (auth required)
router.get('/', requireAuth, function(req, res) {
  var wsId = req.query.workspace_id;

  var query = supabase.from('pixels').select('*');
  if (wsId) query = query.eq('workspace_id', wsId);

  query.order('created_at', { ascending: false })
    .then(function(result) {
      if (result.error) return res.status(500).json({ error: result.error.message });

      var pixels = result.data || [];
      var pixelIds = pixels.map(function(p) { return p.id; });
      if (pixelIds.length === 0) return res.json({ pixels: [] });

      Promise.all([
        supabase.from('clicks').select('pixel_id', { count: 'exact', head: false }).in('pixel_id', pixelIds),
        supabase.from('leads').select('pixel_id', { count: 'exact', head: false }).in('pixel_id', pixelIds)
      ]).then(function(results) {
        var clickCounts = {};
        var leadCounts = {};
        (results[0].data || []).forEach(function(r) { clickCounts[r.pixel_id] = (clickCounts[r.pixel_id] || 0) + 1; });
        (results[1].data || []).forEach(function(r) { leadCounts[r.pixel_id] = (leadCounts[r.pixel_id] || 0) + 1; });
        pixels.forEach(function(p) {
          p.click_count = clickCounts[p.id] || 0;
          p.lead_count = leadCounts[p.id] || 0;
        });
        res.json({ pixels: pixels });
      }).catch(function() {
        res.json({ pixels: pixels });
      });
    })
    .catch(function(e) {
      res.status(500).json({ error: e.message });
    });
});

// POST / - create a new pixel (auth required)
router.post('/', requireAuth, function(req, res) {
  var body = req.body;
  if (!body.name) return res.status(400).json({ error: 'Pixel name required' });

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
    user_id: req.user.id
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

// DELETE /:id - delete a pixel (auth required)
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

// GET /lead - list leads for dashboard (auth required)
router.get('/lead', requireAuth, function(req, res) {
  var wsId = req.query.workspace_id;
  var limit = parseInt(req.query.limit) || 500;

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
