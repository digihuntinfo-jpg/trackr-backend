const supabase = require('../supabase');
async function requireAuth(req,res,next){
  const h=req.headers.authorization;
  if(!h||!h.startsWith('Bearer '))return res.status(401).json({error:'Missing token'});
  const token=h.split(' ')[1];
  const {data:{user},error}=await supabase.auth.getUser(token);
  if(error||!user)return res.status(401).json({error:'Invalid token'});
  req.user=user;req.token=token;next();
}
async function optionalAuth(req,res,next){
  const h=req.headers.authorization;
  if(h&&h.startsWith('Bearer ')){
    const token=h.split(' ')[1];
    const {data:{user}}=await supabase.auth.getUser(token);
    if(user){req.user=user;req.token=token;}
  }
  next();
}
module.exports={requireAuth,optionalAuth};
