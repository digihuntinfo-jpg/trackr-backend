const router = require('express').Router();
const supabase = require('../supabase');
const { requireAuth } = require('../middleware/auth');
router.get('/',requireAuth,async(req,res)=>{try{const{data:owned}=await supabase.from('workspaces').select('*,connections(id,account_name,platform,currency,account_id)').eq('owner_id',req.user.id);res.json({workspaces:owned||[]})}catch(e){res.status(500).json({error:e.message})}});
router.post('/',requireAuth,async(req,res)=>{try{const{name}=req.body;const{data,error}=await supabase.from('workspaces').insert({name,owner_id:req.user.id}).select().single();if(error)return res.status(500).json({error:error.message});res.json({workspace:data})}catch(e){res.status(500).json({error:e.message})}});
module.exports=router;
