var router = require('express').Router();
var { requireAuth } = require('../middleware/auth');
var fetch = require('node-fetch');

// Google Ads API config
var GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
var GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
var GOOGLE_DEVELOPER_TOKEN = process.env.GOOGLE_DEVELOPER_TOKEN || '';
var GOOGLE_REDIRECT_URI = 'https://trackr.ga4specialist.com/';

// Helper: safe JSON parse from fetch response
function safeFetch(url, opts) {
  return fetch(url, opts).then(function(r) {
    var ct = r.headers.get('content-type') || '';
    if (!r.ok) {
      if (ct.indexOf('application/json') > -1) {
        return r.json().then(function(d) {
          var msg = (d.error && d.error.message) || d.error_description || JSON.stringify(d.error) || 'API error ' + r.status;
          return Promise.reject(new Error(msg));
        });
      }
      return r.text().then(function(t) {
        return Promise.reject(new Error('HTTP ' + r.status + ': ' + t.substring(0, 200)));
      });
    }
    if (ct.indexOf('application/json') > -1) {
      return r.json();
    }
    return r.text().then(function(t) {
      try { return JSON.parse(t); } catch(e) {
        return Promise.reject(new Error('Non-JSON response: ' + t.substring(0, 200)));
      }
    });
  });
}

// ─── OAuth: Exchange auth code for tokens ────────────
router.post('/connect', requireAuth, function(req, res) {
  var code = req.body.code;
  if (!code) return res.status(400).json({ error: 'Missing auth code' });

  safeFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'code=' + encodeURIComponent(code)
      + '&client_id=' + encodeURIComponent(GOOGLE_CLIENT_ID)
      + '&client_secret=' + encodeURIComponent(GOOGLE_CLIENT_SECRET)
      + '&redirect_uri=' + encodeURIComponent(GOOGLE_REDIRECT_URI)
      + '&grant_type=authorization_code'
  })
  .then(function(tokens) {
    if (tokens.error) {
      return res.status(400).json({ error: tokens.error_description || tokens.error });
    }
    res.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in
    });
  })
  .catch(function(e) {
    console.error('[google/connect]', e.message);
    res.status(500).json({ error: e.message });
  });
});

// ─── Refresh Google token ────────────────────────────
router.post('/refresh', requireAuth, function(req, res) {
  var refreshToken = req.body.refresh_token;
  if (!refreshToken) return res.status(400).json({ error: 'Missing refresh_token' });

  safeFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'refresh_token=' + encodeURIComponent(refreshToken)
      + '&client_id=' + encodeURIComponent(GOOGLE_CLIENT_ID)
      + '&client_secret=' + encodeURIComponent(GOOGLE_CLIENT_SECRET)
      + '&grant_type=refresh_token'
  })
  .then(function(tokens) {
    res.json({
      access_token: tokens.access_token,
      expires_in: tokens.expires_in
    });
  })
  .catch(function(e) {
    console.error('[google/refresh]', e.message);
    res.status(500).json({ error: e.message });
  });
});

// ─── List accessible Google Ads accounts ─────────────
router.get('/accounts', requireAuth, function(req, res) {
  var token = req.query.access_token || req.headers['x-google-token'];
  if (!token) return res.status(400).json({ error: 'Missing Google access token' });

  console.log('[google/accounts] Fetching with dev token:', GOOGLE_DEVELOPER_TOKEN ? GOOGLE_DEVELOPER_TOKEN.substring(0, 6) + '...' : 'MISSING');

  safeFetch('https://googleads.googleapis.com/v17/customers:listAccessibleCustomers', {
    headers: {
      'Authorization': 'Bearer ' + token,
      'developer-token': GOOGLE_DEVELOPER_TOKEN
    }
  })
  .then(function(data) {
    var customerIds = (data.resourceNames || []).map(function(rn) {
      return rn.replace('customers/', '');
    });

    if (!customerIds.length) {
      return res.json({ accounts: [], hierarchy: [], managers: [] });
    }

    // Fetch details for each customer
    var promises = customerIds.map(function(custId) {
      return safeFetch('https://googleads.googleapis.com/v17/customers/' + custId, {
        headers: {
          'Authorization': 'Bearer ' + token,
          'developer-token': GOOGLE_DEVELOPER_TOKEN
        }
      })
      .then(function(cust) {
        return {
          customer_id: custId,
          name: cust.descriptiveName || custId,
          currency: cust.currencyCode || 'USD',
          timezone: cust.timeZone || '',
          is_manager: cust.manager || false,
          status: cust.status || 'UNKNOWN'
        };
      })
      .catch(function(e) {
        console.warn('[google/accounts] Failed to fetch customer ' + custId + ':', e.message);
        return null;
      });
    });

    return Promise.all(promises).then(function(accounts) {
      var valid = accounts.filter(function(a) { return a !== null; });
      var managers = valid.filter(function(a) { return a.is_manager; });
      var clients = valid.filter(function(a) { return !a.is_manager; });

      if (!managers.length) {
        return res.json({ accounts: clients, hierarchy: [], managers: [] });
      }

      // For each MCC, fetch its client accounts
      var mccPromises = managers.map(function(mcc) {
        var query = 'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.status = "ENABLED"';
        return safeFetch('https://googleads.googleapis.com/v17/customers/' + mcc.customer_id + '/googleAds:searchStream', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'developer-token': GOOGLE_DEVELOPER_TOKEN,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: query })
        })
        .then(function(result) {
          var clientAccts = [];
          (Array.isArray(result) ? result : [result]).forEach(function(batch) {
            (batch.results || []).forEach(function(row) {
              var cc = row.customerClient;
              if (cc && !cc.manager) {
                clientAccts.push({
                  customer_id: cc.id || '',
                  name: cc.descriptiveName || cc.id || '',
                  currency: cc.currencyCode || 'USD',
                  is_manager: false,
                  status: cc.status || 'ENABLED',
                  parent_mcc: mcc.customer_id,
                  parent_mcc_name: mcc.name
                });
              }
            });
          });
          return { mcc: mcc, clients: clientAccts };
        })
        .catch(function(e) {
          console.warn('[google/accounts] MCC fetch failed for ' + mcc.customer_id + ':', e.message);
          return { mcc: mcc, clients: [] };
        });
      });

      return Promise.all(mccPromises).then(function(hierarchy) {
        res.json({
          accounts: clients,
          hierarchy: hierarchy,
          managers: managers
        });
      });
    });
  })
  .catch(function(e) {
    console.error('[google/accounts]', e.message);
    res.status(500).json({ error: e.message });
  });
});

// ─── Fetch campaign data via GAQL ────────────────────
router.get('/campaigns', requireAuth, function(req, res) {
  var token = req.query.access_token || req.headers['x-google-token'];
  var customerId = req.query.customer_id;
  var since = req.query.since;
  var until = req.query.until;

  if (!token || !customerId) {
    return res.status(400).json({ error: 'Missing access_token or customer_id' });
  }

  if (!since) {
    var d = new Date();
    d.setDate(d.getDate() - 30);
    since = d.toISOString().split('T')[0];
  }
  if (!until) {
    until = new Date().toISOString().split('T')[0];
  }

  var query = 'SELECT '
    + 'campaign.id, campaign.name, campaign.status, '
    + 'campaign.advertising_channel_type, '
    + 'campaign_budget.amount_micros, '
    + 'metrics.cost_micros, metrics.impressions, metrics.clicks, '
    + 'metrics.ctr, metrics.average_cpm, metrics.average_cpc, '
    + 'metrics.conversions, metrics.cost_per_conversion, '
    + 'metrics.conversions_value, metrics.video_views, '
    + 'metrics.all_conversions '
    + 'FROM campaign '
    + 'WHERE segments.date BETWEEN "' + since + '" AND "' + until + '" '
    + 'ORDER BY metrics.cost_micros DESC';

  var cleanId = customerId.replace(/-/g, '');

  safeFetch('https://googleads.googleapis.com/v17/customers/' + cleanId + '/googleAds:searchStream', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'developer-token': GOOGLE_DEVELOPER_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: query })
  })
  .then(function(result) {
    var campaigns = [];
    (Array.isArray(result) ? result : [result]).forEach(function(batch) {
      (batch.results || []).forEach(function(row) {
        var c = row.campaign || {};
        var m = row.metrics || {};
        var b = row.campaignBudget || {};

        campaigns.push({
          id: c.id || '',
          name: c.name || '',
          status: c.status || 'UNKNOWN',
          channel_type: c.advertisingChannelType || '',
          platform: 'google',
          spend: (m.costMicros || 0) / 1000000,
          impressions: m.impressions || 0,
          clicks: m.clicks || 0,
          ctr: (m.ctr || 0) * 100,
          cpm: (m.averageCpm || 0) / 1000000,
          cpc: (m.averageCpc || 0) / 1000000,
          conversions: m.conversions || 0,
          cost_per_conversion: (m.costPerConversion || 0) / 1000000,
          conversions_value: m.conversionsValue || 0,
          video_views: m.videoViews || 0,
          all_conversions: m.allConversions || 0,
          daily_budget: b.amountMicros ? (b.amountMicros / 1000000) : 0
        });
      });
    });

    // Aggregate campaigns (GAQL returns per-day rows)
    var campMap = {};
    campaigns.forEach(function(c) {
      if (!campMap[c.id]) {
        campMap[c.id] = Object.assign({}, c, {
          spend: 0, impressions: 0, clicks: 0,
          conversions: 0, video_views: 0, all_conversions: 0,
          conversions_value: 0
        });
      }
      campMap[c.id].spend += c.spend;
      campMap[c.id].impressions += c.impressions;
      campMap[c.id].clicks += c.clicks;
      campMap[c.id].conversions += c.conversions;
      campMap[c.id].video_views += c.video_views;
      campMap[c.id].all_conversions += c.all_conversions;
      campMap[c.id].conversions_value += c.conversions_value;
    });

    var finalCamps = Object.values(campMap).map(function(c) {
      c.ctr = c.impressions > 0 ? (c.clicks / c.impressions * 100) : 0;
      c.cpm = c.impressions > 0 ? (c.spend / c.impressions * 1000) : 0;
      c.cpc = c.clicks > 0 ? (c.spend / c.clicks) : 0;
      c.cost_per_conversion = c.conversions > 0 ? (c.spend / c.conversions) : 0;
      return c;
    });

    res.json({ campaigns: finalCamps });
  })
  .catch(function(e) {
    console.error('[google/campaigns]', e.message);
    res.status(500).json({ error: e.message });
  });
});

module.exports = router;
