import { list, get, put } from '@vercel/blob';
import { createHash } from 'node:crypto';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export default async function handler(req,res) {
  const code=req.headers['x-trip-code'];
  if(typeof code!=='string'||!/^[a-f0-9]{48}$/.test(code))return res.status(401).json({error:'Code de voyage invalide'});
  const room=createHash('sha256').update(code).digest('hex').slice(0,40);
  const prefix='rooms/'+room+'/';
  try{
    if(req.method==='GET'){
      const items=[];let cursor;
      do{
        const page=await list({prefix,limit:100,cursor});
        items.push(...page.blobs);cursor=page.hasMore?page.cursor:null;
      }while(cursor&&items.length<200);
      const combined={},combinedEdits={};
      for(const blob of items.slice(0,200)){
        const obj=await get(blob.pathname,{access:'private'});
        if(!obj||obj.statusCode!==200)continue;
        let data;try{data=JSON.parse(await new Response(obj.stream).text())}catch{continue}
        for(const [k,v] of Object.entries(data.edits||{})){if(!/^[^:]{1,40}:(?:[0-9]{1,3}|[a-f0-9-]{36})$/.test(k))continue;if(!v||typeof v.t!=='number'||!v.v||typeof v.v.name!=='string'||typeof v.v.qty!=='number'||typeof v.v.deleted!=='boolean')continue;if(!combinedEdits[k]||v.t>combinedEdits[k].t)combinedEdits[k]=v}for(const [k,v] of Object.entries(data.checks||{})){
          if(!/^[^:]{1,40}:[0-9]{1,3}$/.test(k))continue;
          if(!v||typeof v.t!=='number'||typeof v.v!=='boolean')continue;
          if(!combined[k]||v.t>combined[k].t)combined[k]=v;
        }
      }
      return res.status(200).json({checks:combined,edits:combinedEdits,devices:items.length});
    }
    if(req.method==='POST'){
      if(JSON.stringify(req.body||{}).length>30000)return res.status(413).json({error:'Données trop volumineuses'});
      const {device,checks,edits={}}=req.body||{};
      if(typeof device!=='string'||!/^[a-f0-9-]{36}$/.test(device)||!checks||typeof checks!=='object'||Array.isArray(checks))return res.status(400).json({error:'Données invalides'});
      const clean={};for(const [k,v] of Object.entries(checks)){
        if(!/^[^:]{1,40}:(?:[0-9]{1,3}|[a-f0-9-]{36})$/.test(k)||!v||typeof v.v!=='boolean'||typeof v.t!=='number'||!Number.isFinite(v.t)||Math.abs(v.t-Date.now())>31536000000)return res.status(400).json({error:'Valeur invalide'});
        clean[k]={v:v.v,t:v.t};
      }
      const cleanEdits={};if(!edits||typeof edits!=='object'||Array.isArray(edits))return res.status(400).json({error:'Modifications invalides'});for(const [k,e] of Object.entries(edits)){if(!/^[^:]{1,40}:(?:[0-9]{1,3}|[a-f0-9-]{36})$/.test(k)||!e||typeof e.t!=='number'||!Number.isFinite(e.t)||Math.abs(e.t-Date.now())>31536000000||!e.v||typeof e.v.name!=='string'||e.v.name.length>100||!e.v.name.trim()||!Number.isInteger(e.v.qty)||e.v.qty<1||e.v.qty>999||typeof e.v.deleted!=='boolean')return res.status(400).json({error:'Modification invalide'});cleanEdits[k]={v:{name:e.v.name,qty:e.v.qty,deleted:e.v.deleted},t:e.t}}await put(prefix+device+'.json',JSON.stringify({checks:clean,edits:cleanEdits}),{access:'private',allowOverwrite:true,contentType:'application/json',cacheControlMaxAge:60});
      return res.status(200).json({ok:true});
    }
    res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Méthode interdite'});
  }catch(err){console.error('Sync failure',err?.message);return res.status(503).json({error:'Synchronisation temporairement indisponible'})}
}
