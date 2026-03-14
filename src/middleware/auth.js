const supabase = require('../supabase');
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const token = header.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user; req.token = token; next();
}
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) { req.user = user; req.token = token; }
  }
  next();
}
module.exports = { requireAuth, optionalAuth };
