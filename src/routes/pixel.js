const router = require('express').Router();
const supabase = require('../supabase');
const { requireAuth } = require('../middleware/auth');
router.get('/script/:token', async (req, res) => {
  const { data: pixel } = await supabase.from('pixels').select('id,workspace_id').eq('pixel_token', req.params.token).single();
  if (!pixel) return res.status(404).send('// Pixel not found');
  const apiBase = process.env.API_URL || 'https://api.trackr.ga4specialist.com';
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`(function(){var T=window.Trackr=window.Trackr||{};T.pixelId='${pixel.id}';T.api='${apiBase}';function gP(n){return new URLSearchParams(window.location.search).get(n)}function sC(n,V,d){document.cookie=n+'='+V+';expires='+new Date(Date.now()+d*864e5).toUTCString()+';path=/'}function gC(n){return(document.cookie.match('(^|;)\\s*'+n+'\\s*=\\s*([^;]+)')||[]).pop()||null}var cId=gP('fbclid')||gP('gclid')||gC('_tkr_cid');var pl=gP('fbclid')?'meta':gP('gclid')?'google':null;if(cId){sC('tkr_cid',cId,30);fetch(T.api+'/api/pixel/click',{ethod:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pixel_id:T.pixelId,click_id:cId,platform:pl,landing_url:window.location.href})}).catch(function(){})}T.trackLead=function(d){fetch(T.api+'/api/pixel/lead',{method:'POST'headers:{'Content-Type':'application/json'},body:JSON.stringify({pixel_id:T.pixelId,click_id:gC('_tkr_cid'),source_url:window.location.href,email:d.email||null,phone:d.phone||null,name:d.name||null})}).catch(function(){})};document.addEventListener('submit',function(e){var f=e.target;var em=(f.querySelector('[name=email],[type=email]')||{}).value;var ph=(f.querySelector('[name=phone],[type=tel]')||{}).value;if(em||ph)T.trackLead({email:em,phone:ph})},true)})();`.trim());});
router.post('/click', async (req, res) => {
  try {
    const { pixel_id, click_id, platform, landing_url } = req.body;
    if (!pixel_id || !click_id) return res.status(400).json({ error: 'Missing' });
    await supabase.from('clicks').upsert({ pixel_id, click_id, platform, landing_url, ip:req.ip, user_agent:req.headers['user-agent'] }, { onConflict:'click_id', ignoreDuplicates:true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/lead', async (req, res) => {
  try {
    const { pixel_id, click_id, email, phone, name, source_url, meta } = req.body;
    if (!pixel_id) return res.status(400).json({ error: 'Missing' });
    const { data, error } = await supabase.from('leads').insert({ pixel_id, click_id:click_id||null, email, phone, name, source_url, meta:meta||{} }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, lead_id: data.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
