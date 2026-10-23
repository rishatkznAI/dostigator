// Secure-context localhost service-worker check; same fixture Auth and real Data API as stand.mjs.
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
const root=resolve('../iphone-pwa');let unavailable=false
const {ownerA,tokens}=await(await fetch('http://127.0.0.1:4210/__test/identities')).json()
const session={access_token:tokens.ownerA,refresh_token:'test-fixture',expires_at:Math.floor(Date.now()/1000)+86400,expires_in:86400,token_type:'bearer',user:{id:ownerA,aud:'authenticated',role:'authenticated',email:'isolated@local.test',app_metadata:{},user_metadata:{display_name:'PWA стенд'},created_at:new Date().toISOString()}}
createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname
 if(path==='/__test/unavailable'){unavailable=new URL(req.url,'http://localhost').searchParams.get('value')==='1';res.end(String(unavailable));return}
 if(path==='/__test/login'){res.setHeader('Content-Type','text/html');res.end(`<script>localStorage.setItem('sb-127-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('dostigator:onboarding:v1:${ownerA}','skipped');location.replace('/training')</script>`);return}
 if(unavailable){res.writeHead(503);res.end('Offline test: static origin unavailable');return}
 const file=resolve(root,'.'+path);if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return}
 const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.woff2':'font/woff2'}
 try {const content=await readFile(file);res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(content)}catch{res.setHeader('Content-Type','text/html');res.end(await readFile(root+'/index.html'))}
}).listen(4213,'127.0.0.1',()=>console.log('PWA isolated test http://127.0.0.1:4213/__test/login'))
