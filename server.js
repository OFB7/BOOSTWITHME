import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { z } from "zod";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL || APP_URL;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY || "NGN";
const EMAIL_FROM = process.env.EMAIL_FROM || "no-reply@boostwithme.local";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "danyellsdave7@gmail.com").toLowerCase();
const ADMIN_NAME = process.env.ADMIN_NAME || "David Daniel";
const ADMIN_PHONE = process.env.ADMIN_PHONE || "08144594011";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "boostwithme7@gmail.com";
const DOMAIN = process.env.DOMAIN || "boostwithme.com";

if (NODE_ENV === "production" && (!process.env.DATABASE_URL || !process.env.JWT_SECRET)) {
  console.error("Production requires DATABASE_URL and JWT_SECRET.");
  process.exit(1);
}

const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 10)
}) : null;

async function query(text, params = []) {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool.query(text, params);
}
const one = async (text, params=[]) => (await query(text, params)).rows[0] || null;
const many = async (text, params=[]) => (await query(text, params)).rows;
const run = async (text, params=[]) => { const r = await query(text, params); return { changes: r.rowCount, rows: r.rows }; };
async function tx(work) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const out = await work(client); await client.query("COMMIT"); return out; }
  catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));
app.get("/styles.css", (_req, res) => res.sendFile(path.join(__dirname, "styles.css")));app.get("/app.js", (_req, res) => res.sendFile(path.join(__dirname, "app.js")));

const authAttempts = new Map();
function authRateLimit(req, res, next) {
  const key = `${req.ip}:${req.path}`; const now = Date.now(); const windowMs = 15*60*1000; const max = 12;
  const recent = (authAttempts.get(key)||[]).filter(t=>now-t<windowMs);
  if (recent.length >= max) return res.status(429).json({error:"Too many attempts. Please try again later."});
  recent.push(now); authAttempts.set(key,recent); next();
}
function publicUser(u){ return {id:u.id,name:u.name,email:u.email,role:u.role}; }
function signToken(u){ return jwt.sign({id:u.id,role:u.role},JWT_SECRET,{expiresIn:"7d"}); }
function setAuth(res,u){ res.cookie("bw_auth",signToken(u),{httpOnly:true,sameSite:"lax",secure:NODE_ENV==="production",maxAge:7*24*60*60*1000}); }
async function auth(req,res,next){ try { const token=req.cookies.bw_auth; if(!token) return res.status(401).json({error:"Authentication required"}); req.user=jwt.verify(token,JWT_SECRET); next(); } catch { return res.status(401).json({error:"Invalid or expired session"}); } }
function admin(req,res,next){ if(req.user?.role!=="admin") return res.status(403).json({error:"Admin access required"}); next(); }
function money(kobo){ return `₦${(Number(kobo)/100).toLocaleString("en-NG",{minimumFractionDigits:2})}`; }
function tokenHash(token){ return crypto.createHash("sha256").update(token).digest("hex"); }
async function audit(actor,action,targetType,targetId,details=""){ await run("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)",[actor?.id||null,action,targetType||null,String(targetId??""),details]); }
async function sendEmail({to,subject,text}){
  const webhook=process.env.EMAIL_WEBHOOK_URL; if(!webhook) return {sent:false,reason:"EMAIL_WEBHOOK_URL not configured"};
  const r=await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json","X-Email-From":EMAIL_FROM},body:JSON.stringify({from:EMAIL_FROM,to,subject,text})});
  if(!r.ok) throw new Error("Email delivery failed"); return {sent:true};
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),email_verified_at TIMESTAMPTZ,verification_token_hash TEXT,verification_expires_at TIMESTAMPTZ,reset_token_hash TEXT,reset_expires_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS services (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,platform TEXT NOT NULL,description TEXT NOT NULL,price_kobo BIGINT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS orders (id BIGSERIAL PRIMARY KEY,public_id TEXT NOT NULL UNIQUE,user_id BIGINT NOT NULL REFERENCES users(id),service_id BIGINT NOT NULL REFERENCES services(id),package_name TEXT NOT NULL,target_url TEXT NOT NULL,amount_kobo BIGINT NOT NULL,status TEXT NOT NULL DEFAULT 'pending_payment',payment_reference TEXT UNIQUE,payment_status TEXT NOT NULL DEFAULT 'unpaid',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS order_events (id BIGSERIAL PRIMARY KEY,order_id BIGINT NOT NULL REFERENCES orders(id),status TEXT NOT NULL,note TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_logs (id BIGSERIAL PRIMARY KEY,actor_user_id BIGINT REFERENCES users(id),action TEXT NOT NULL,target_type TEXT,target_id TEXT,details TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS support_tickets (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),subject TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id); CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status); CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at); CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status); CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);`;

async function initDatabase(){
  if(!pool) return;
  await query(schemaSql);
  const c=await one("SELECT COUNT(*)::int AS c FROM services");
  if(!c.c){
    await query("INSERT INTO services(name,platform,description,price_kobo) VALUES($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12),($13,$14,$15,$16)",[
      "Instagram Promotion","Instagram","Campaign support designed to increase qualified visibility and engagement.",500000,
      "TikTok Promotion","TikTok","Promotion campaigns designed to improve content discovery and audience awareness.",500000,
      "YouTube Promotion","YouTube","Campaign options for increasing video discovery and audience awareness.",750000,
      "Facebook Promotion","Facebook","Social promotion packages for pages, brands and creators.",500000]);
  }
}

app.get("/api/health",async(_req,res)=>{ try { await one("SELECT 1 AS ok"); res.json({ok:true,service:"BOOSTWITHME API",database:"postgresql"}); } catch { res.status(503).json({ok:false,service:"BOOSTWITHME API",database:"unavailable"}); } });
app.get("/api/config",(_req,res)=>res.json({brand:"BOOSTWITHME",domain:DOMAIN,adminName:ADMIN_NAME,adminPhone:ADMIN_PHONE,supportEmail:SUPPORT_EMAIL}));
app.get("/api/services",async(_req,res)=>{ const services=await many("SELECT id,name,platform,description,price_kobo FROM services WHERE active=TRUE ORDER BY id"); res.json({services:services.map(s=>({...s,price:money(s.price_kobo)}))}); });

const signupSchema=z.object({name:z.string().min(2).max(80),email:z.string().email().max(200),password:z.string().min(8).max(100)});
app.post("/api/auth/register",authRateLimit,async(req,res)=>{ try {
  const p=signupSchema.safeParse(req.body); if(!p.success) return res.status(400).json({error:"Enter a valid name, email and password (8+ characters)."});
  const {name,password}=p.data, email=p.data.email.toLowerCase(); if(await one("SELECT id FROM users WHERE email=$1",[email])) return res.status(409).json({error:"An account with that email already exists."});
  const hash=await bcrypt.hash(password,12), role=ADMIN_EMAIL===email?"admin":"customer", token=crypto.randomBytes(32).toString("hex");
  const u=await one("INSERT INTO users(name,email,password_hash,role,verification_token_hash,verification_expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '24 hours') RETURNING id,name,email,role",[name,email,hash,role,tokenHash(token)]);
  await audit(u,"user.register","user",u.id); const verifyUrl=`${FRONTEND_URL}/api/auth/verify-email?token=${token}`; try{await sendEmail({to:u.email,subject:"Verify your BOOSTWITHME account",text:`Welcome to BOOSTWITHME. Verify your email: ${verifyUrl}`});}catch{} setAuth(res,u); res.status(201).json({user:publicUser(u),emailVerificationRequired:true});
 } catch(e){ console.error(e); res.status(500).json({error:"Unable to create account."}); } });

app.post("/api/auth/login",authRateLimit,async(req,res)=>{ const p=z.object({email:z.string().email(),password:z.string().min(1)}).safeParse(req.body); if(!p.success)return res.status(400).json({error:"Invalid login details."}); const u=await one("SELECT * FROM users WHERE email=$1",[p.data.email.toLowerCase()]); if(!u||!(await bcrypt.compare(p.data.password,u.password_hash)))return res.status(401).json({error:"Invalid email or password."}); setAuth(res,u); res.json({user:publicUser(u)}); });
app.get("/api/auth/verify-email",async(req,res)=>{ const token=String(req.query.token||""); if(!token)return res.status(400).send("Invalid verification link."); const u=await one("SELECT * FROM users WHERE verification_token_hash=$1 AND verification_expires_at>now()",[tokenHash(token)]); if(!u)return res.status(400).send("This verification link is invalid or expired."); await run("UPDATE users SET email_verified_at=now(),verification_token_hash=NULL,verification_expires_at=NULL WHERE id=$1",[u.id]); await audit(u,"user.email_verified","user",u.id); res.send("Email verified successfully. You can return to BOOSTWITHME and sign in."); });
app.post("/api/auth/resend-verification",authRateLimit,async(req,res)=>{ const email=String(req.body?.email||"").toLowerCase(),u=await one("SELECT * FROM users WHERE email=$1",[email]); if(u&&!u.email_verified_at){const t=crypto.randomBytes(32).toString("hex");await run("UPDATE users SET verification_token_hash=$1,verification_expires_at=now()+interval '24 hours' WHERE id=$2",[tokenHash(t),u.id]);try{await sendEmail({to:u.email,subject:"Verify your BOOSTWITHME account",text:`Verify your email: ${FRONTEND_URL}/api/auth/verify-email?token=${t}`});}catch{}} res.json({ok:true,message:"If the account exists and needs verification, a new verification link has been sent."}); });
app.post("/api/auth/request-password-reset",authRateLimit,async(req,res)=>{ const email=String(req.body?.email||"").toLowerCase(),u=await one("SELECT * FROM users WHERE email=$1",[email]); if(u){const t=crypto.randomBytes(32).toString("hex");await run("UPDATE users SET reset_token_hash=$1,reset_expires_at=now()+interval '1 hour' WHERE id=$2",[tokenHash(t),u.id]);try{await sendEmail({to:u.email,subject:"Reset your BOOSTWITHME password",text:`Reset your password: ${FRONTEND_URL}/?reset_token=${t}`});}catch{}} res.json({ok:true,message:"If that email exists, password-reset instructions have been sent."}); });
app.post("/api/auth/reset-password",authRateLimit,async(req,res)=>{const p=z.object({token:z.string().min(20),password:z.string().min(8).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid reset request."});const u=await one("SELECT * FROM users WHERE reset_token_hash=$1 AND reset_expires_at>now()",[tokenHash(p.data.token)]);if(!u)return res.status(400).json({error:"Reset token is invalid or expired."});await run("UPDATE users SET password_hash=$1,reset_token_hash=NULL,reset_expires_at=NULL WHERE id=$2",[await bcrypt.hash(p.data.password,12),u.id]);await audit(u,"user.password_reset","user",u.id);res.json({ok:true});});
app.post("/api/auth/logout",(_req,res)=>{res.clearCookie("bw_auth");res.json({ok:true});});
app.get("/api/auth/me",auth,async(req,res)=>{const u=await one("SELECT id,name,email,role FROM users WHERE id=$1",[req.user.id]);res.json({user:publicUser(u)});});

const orderSchema=z.object({serviceId:z.coerce.number().int().positive(),packageName:z.string().min(2).max(80),targetUrl:z.string().url().max(500)});
app.post("/api/orders",auth,async(req,res)=>{const p=orderSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Choose a service, package and valid profile/content URL."});const s=await one("SELECT * FROM services WHERE id=$1 AND active=TRUE",[p.data.serviceId]);if(!s)return res.status(404).json({error:"Service not found."});const publicId="BW"+Date.now().toString(36).toUpperCase()+crypto.randomBytes(2).toString("hex").toUpperCase();const o=await one("INSERT INTO orders(public_id,user_id,service_id,package_name,target_url,amount_kobo) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[publicId,req.user.id,s.id,p.data.packageName,p.data.targetUrl,s.price_kobo]);await run("INSERT INTO order_events(order_id,status,note) VALUES($1,$2,$3)",[o.id,"pending_payment","Order created; awaiting payment."]);const order=await one(`SELECT o.public_id,o.package_name,o.target_url,o.amount_kobo,o.status,o.payment_status,o.created_at,s.name service_name,s.platform FROM orders o JOIN services s ON s.id=o.service_id WHERE o.id=$1`,[o.id]);res.status(201).json({order:{...order,amount:money(order.amount_kobo)}});});
app.get("/api/orders",auth,async(req,res)=>{const orders=await many(`SELECT o.public_id,o.package_name,o.target_url,o.amount_kobo,o.status,o.payment_status,o.payment_reference,o.created_at,o.updated_at,s.name service_name,s.platform FROM orders o JOIN services s ON s.id=o.service_id WHERE o.user_id=$1 ORDER BY o.id DESC`,[req.user.id]);res.json({orders:orders.map(o=>({...o,amount:money(o.amount_kobo)}))});});
app.get("/api/orders/:publicId",auth,async(req,res)=>{const o=await one(`SELECT o.*,s.name service_name,s.platform FROM orders o JOIN services s ON s.id=o.service_id WHERE o.public_id=$1 AND o.user_id=$2`,[req.params.publicId,req.user.id]);if(!o)return res.status(404).json({error:"Order not found"});const events=await many("SELECT status,note,created_at FROM order_events WHERE order_id=$1 ORDER BY id",[o.id]);res.json({order:{...o,amount:money(o.amount_kobo),events}});});

app.post("/api/payments/paystack/initialize",auth,async(req,res)=>{try{const p=z.object({publicId:z.string().min(4)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid order."});if(!PAYSTACK_SECRET_KEY)return res.status(503).json({error:"Payments are not configured yet. Add PAYSTACK_SECRET_KEY to the deployment environment."});const order=await one("SELECT o.*,u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.public_id=$1 AND o.user_id=$2",[p.data.publicId,req.user.id]);if(!order)return res.status(404).json({error:"Order not found"});if(order.payment_status==="paid")return res.status(409).json({error:"This order is already paid."});const reference=`BW-${order.public_id}-${crypto.randomBytes(5).toString("hex")}`;const response=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({email:order.email,amount:String(order.amount_kobo),currency:PAYSTACK_CURRENCY,reference,callback_url:`${APP_URL}/payment/callback`,metadata:{order_public_id:order.public_id}})});const data=await response.json();if(!response.ok||!data.status)return res.status(502).json({error:data.message||"Unable to initialize payment"});await run("UPDATE orders SET payment_reference=$1,updated_at=now() WHERE id=$2",[reference,order.id]);res.json({authorization_url:data.data.authorization_url,access_code:data.data.access_code,reference});}catch(e){console.error(e);res.status(502).json({error:"Unable to initialize payment."});}});
app.get("/payment/callback",(_req,res)=>res.sendFile(path.join(__dirname,"payment-callback.html")));

async function markPaid(order,note){ if(order.payment_status==="paid")return; await tx(async client=>{await client.query("UPDATE orders SET payment_status='paid',status='processing',updated_at=now() WHERE id=$1",[order.id]);await client.query("INSERT INTO order_events(order_id,status,note) VALUES($1,$2,$3)",[order.id,"processing",note]);}); }
app.get("/api/payments/paystack/verify",auth,async(req,res)=>{try{const reference=String(req.query.reference||"");if(!reference||!PAYSTACK_SECRET_KEY)return res.status(400).json({error:"Missing payment reference or payment configuration."});const order=await one("SELECT * FROM orders WHERE payment_reference=$1 AND user_id=$2",[reference,req.user.id]);if(!order)return res.status(404).json({error:"Payment reference not found."});const response=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`}});const data=await response.json();if(!response.ok||!data.status)return res.status(502).json({error:data.message||"Unable to verify payment."});const paid=data.data?.status==="success"&&Number(data.data.amount)===Number(order.amount_kobo);if(paid)await markPaid(order,"Payment verified from transaction callback.");const fresh=await one("SELECT public_id,status,payment_status FROM orders WHERE id=$1",[order.id]);res.json({verified:paid,order:fresh});}catch(e){console.error(e);res.status(502).json({error:"Unable to verify payment."});}});
app.post("/api/payments/paystack/webhook",async(req,res)=>{if(!PAYSTACK_SECRET_KEY)return res.sendStatus(200);const signature=String(req.headers["x-paystack-signature"]||"");const expected=crypto.createHmac("sha512",PAYSTACK_SECRET_KEY).update(req.rawBody).digest("hex");if(!signature||signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.sendStatus(401);try{const event=req.body;if(event.event==="charge.success"){const d=event.data,order=await one("SELECT * FROM orders WHERE payment_reference=$1",[d.reference]);if(order&&d.status==="success"&&Number(d.amount)===Number(order.amount_kobo))await markPaid(order,"Payment verified; order is now processing.");}return res.sendStatus(200);}catch(e){console.error(e);return res.sendStatus(500);}});

app.get("/api/support",auth,async(req,res)=>{const tickets=await many("SELECT id,subject,message,status,created_at FROM support_tickets WHERE user_id=$1 ORDER BY id DESC",[req.user.id]);res.json({tickets});});
app.post("/api/support",auth,async(req,res)=>{const p=z.object({subject:z.string().min(2).max(120),message:z.string().min(5).max(2000)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Please enter a subject and message."});const t=await one("INSERT INTO support_tickets(user_id,subject,message) VALUES($1,$2,$3) RETURNING id",[req.user.id,p.data.subject,p.data.message]);res.status(201).json({ticketId:t.id});});

app.get("/api/admin/customers",auth,admin,async(_req,res)=>{const customers=await many(`SELECT u.id,u.name,u.email,u.role,u.created_at,COUNT(o.id)::int order_count,COALESCE(SUM(CASE WHEN o.payment_status='paid' THEN o.amount_kobo ELSE 0 END),0) spend_kobo FROM users u LEFT JOIN orders o ON o.user_id=u.id GROUP BY u.id ORDER BY u.id DESC`);res.json({customers:customers.map(c=>({...c,spend:money(c.spend_kobo)}))});});
app.get("/api/admin/stats",auth,admin,async(_req,res)=>{const totals=await one(`SELECT COUNT(*)::int total_orders,COALESCE(SUM(CASE WHEN payment_status='paid' THEN amount_kobo ELSE 0 END),0) revenue_kobo,COUNT(DISTINCT user_id)::int customers,COUNT(CASE WHEN payment_status='paid' THEN 1 END)::int paid_orders FROM orders`);const counts=await many("SELECT status,COUNT(*)::int count FROM orders GROUP BY status");const tickets=await one("SELECT COUNT(*)::int count FROM support_tickets WHERE status='open'");res.json({stats:{...totals,revenue:money(totals.revenue_kobo),open_tickets:tickets.count,status_counts:Object.fromEntries(counts.map(x=>[x.status,x.count]))}});});
app.patch("/api/admin/customers/:id/role",auth,admin,async(req,res)=>{const p=z.object({role:z.enum(["customer","admin"])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid role."});if(Number(req.params.id)===Number(req.user.id)&&p.data.role!=="admin")return res.status(400).json({error:"You cannot remove your own admin access."});const r=await run("UPDATE users SET role=$1 WHERE id=$2",[p.data.role,req.params.id]);if(!r.changes)return res.status(404).json({error:"Customer not found."});await audit(req.user,"admin.customer_role_changed","user",req.params.id,`role=${p.data.role}`);res.json({ok:true});});
app.get("/api/admin/services",auth,admin,async(_req,res)=>{const s=await many("SELECT id,name,platform,description,price_kobo,active,created_at FROM services ORDER BY id");res.json({services:s.map(x=>({...x,price:money(x.price_kobo)}))});});
const serviceAdminSchema=z.object({name:z.string().min(2).max(100),platform:z.string().min(2).max(40),description:z.string().min(5).max(500),priceKobo:z.coerce.number().int().positive(),active:z.coerce.boolean().optional()});
app.post("/api/admin/services",auth,admin,async(req,res)=>{const p=serviceAdminSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Enter valid service details."});const x=p.data,s=await one("INSERT INTO services(name,platform,description,price_kobo,active) VALUES($1,$2,$3,$4,$5) RETURNING id",[x.name,x.platform,x.description,x.priceKobo,x.active!==false]);await audit(req.user,"admin.service_created","service",s.id);res.status(201).json({id:s.id});});
app.patch("/api/admin/services/:id",auth,admin,async(req,res)=>{const p=serviceAdminSchema.partial().safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid service details."});const cur=await one("SELECT * FROM services WHERE id=$1",[req.params.id]);if(!cur)return res.status(404).json({error:"Service not found"});const x=p.data;await run("UPDATE services SET name=$1,platform=$2,description=$3,price_kobo=$4,active=$5 WHERE id=$6",[x.name??cur.name,x.platform??cur.platform,x.description??cur.description,x.priceKobo??cur.price_kobo,x.active===undefined?cur.active:x.active,cur.id]);await audit(req.user,"admin.service_updated","service",cur.id);res.json({ok:true});});
app.get("/api/admin/tickets",auth,admin,async(_req,res)=>{const t=await many(`SELECT t.id,t.subject,t.message,t.status,t.created_at,u.name customer_name,u.email FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC`);res.json({tickets:t});});
app.patch("/api/admin/tickets/:id",auth,admin,async(req,res)=>{const p=z.object({status:z.enum(["open","in_progress","closed"])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid ticket status."});const r=await run("UPDATE support_tickets SET status=$1 WHERE id=$2",[p.data.status,req.params.id]);if(!r.changes)return res.status(404).json({error:"Ticket not found"});await audit(req.user,"admin.ticket_updated","ticket",req.params.id,`status=${p.data.status}`);res.json({ok:true});});
app.get("/api/admin/audit-logs",auth,admin,async(req,res)=>{const limit=Math.min(Number(req.query.limit||100),500);const logs=await many(`SELECT a.id,a.action,a.target_type,a.target_id,a.details,a.created_at,u.name actor_name,u.email actor_email FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.id DESC LIMIT $1`,[limit]);res.json({logs});});
app.get("/api/admin/orders",auth,admin,async(_req,res)=>{const o=await many(`SELECT o.public_id,o.amount_kobo,o.status,o.payment_status,o.payment_reference,o.created_at,u.name customer_name,u.email,s.name service_name FROM orders o JOIN users u ON u.id=o.user_id JOIN services s ON s.id=o.service_id ORDER BY o.id DESC`);res.json({orders:o.map(x=>({...x,amount:money(x.amount_kobo)}))});});
const statusSchema=z.object({status:z.enum(["pending_payment","processing","in_progress","completed","cancelled","refunded"]),note:z.string().max(500).optional()});
app.patch("/api/admin/orders/:publicId/status",auth,admin,async(req,res)=>{const p=statusSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid status."});const order=await one("SELECT * FROM orders WHERE public_id=$1",[req.params.publicId]);if(!order)return res.status(404).json({error:"Order not found"});await tx(async client=>{await client.query("UPDATE orders SET status=$1,updated_at=now() WHERE id=$2",[p.data.status,order.id]);await client.query("INSERT INTO order_events(order_id,status,note) VALUES($1,$2,$3)",[order.id,p.data.status,p.data.note||"Status updated by admin."]);});await audit(req.user,"admin.order_status_changed","order",order.public_id,`status=${p.data.status}`);res.json({ok:true});});

app.get(/.*/,(req,res)=>{
  if(req.path.startsWith("/api/")){
    return res.status(404).json({error:"Not found"});
  }

  res.sendFile(path.join(__dirname,"index.html"));
});

initDatabase()
  .then(()=>app.listen(PORT,()=>console.log(`BOOSTWITHME running at ${APP_URL} using PostgreSQL`)))
  .catch(e=>{
    console.error("Database initialization failed:",e);
    process.exit(1);
  });