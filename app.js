async function loadBrandConfig(){
  try{
    const r=await fetch('/api/config',{credentials:'include'});
    if(!r.ok) return;
    const c=await r.json();
    const email=document.querySelector('#supportEmail');
    const phone=document.querySelector('#supportPhone');
    if(email){email.textContent=c.supportEmail; email.href=`mailto:${c.supportEmail}`;}
    if(phone){phone.textContent=c.adminPhone; phone.href=`https://wa.me/${c.adminPhone.replace(/^0/,'234')}`;}
    document.title=`${c.brand} — Social Growth Platform`;
  }catch{}
}
loadBrandConfig();

const modal=document.querySelector('#modal'),body=document.querySelector('#modalBody');
let services=[],currentUser=null;

async function api(url,options={}){
  const r=await fetch(url,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||'Request failed');
  return data;
}
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function openModal(html){body.innerHTML=html;modal.classList.add('show')}
function closeModal(){modal.classList.remove('show')}
modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});

function openAuth(mode){
  const signup=mode==='signup';
  openModal(`<h2>${signup?'Create your account':'Welcome back'}</h2><div id="authError"></div>
  ${signup?'<div class="field"><label>Full name</label><input id="name" placeholder="Your name"></div>':''}
  <div class="field"><label>Email</label><input id="email" type="email" placeholder="you@example.com"></div>
  <div class="field"><label>Password</label><input id="password" type="password" placeholder="At least 8 characters"></div>
  <button class="btn primary full" onclick="submitAuth('${signup?'signup':'login'}')">${signup?'Create account':'Log in'}</button>
  ${!signup?'<p class="hint"><a href="#" onclick="openForgotPassword();return false">Forgot password?</a></p>':''}
  <p class="hint">${signup?'Already registered?':'Need an account?'} <a href="#" onclick="openAuth('${signup?'login':'signup'}');return false">${signup?'Log in':'Create one'}</a></p>`)
}

function openForgotPassword(){openModal(`<h2>Reset your password</h2><div id="resetError"></div><div class="field"><label>Email</label><input id="resetEmail" type="email" placeholder="you@example.com"></div><button class="btn primary full" onclick="requestReset()">Send reset link</button><p class="hint">If the account exists, we’ll send instructions.</p>`)}
async function requestReset(){try{await api('/api/auth/request-password-reset',{method:'POST',body:JSON.stringify({email:document.querySelector('#resetEmail').value})});openModal('<h2>Check your email</h2><p class="success">If that email is registered, password-reset instructions have been sent.</p><button class="btn dark full" onclick="closeModal()">Close</button>')}catch(e){document.querySelector('#resetError').innerHTML=`<div class="error">${esc(e.message)}</div>`}}
function openResetFromUrl(){const token=new URLSearchParams(location.search).get('reset_token');if(!token)return;openModal(`<h2>Create a new password</h2><div id="newPassError"></div><div class="field"><label>New password</label><input id="newPassword" type="password" minlength="8"></div><button class="btn primary full" onclick="submitReset('${token}')">Update password</button>`)}
async function submitReset(token){try{await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token,password:document.querySelector('#newPassword').value})});history.replaceState({},'',location.pathname);openModal(`<h2>Password updated</h2><p class="success">Your password has been changed. You can now log in.</p><button class="btn dark full" onclick="closeModal();openAuth('login')">Log in</button>`)}catch(e){document.querySelector('#newPassError').innerHTML=`<div class="error">${esc(e.message)}</div>`}}
async function submitAuth(mode){
  try{const data=await api(`/api/auth/${mode==='signup'?'register':'login'}`,{method:'POST',body:JSON.stringify({...(mode==='signup'?{name:document.querySelector('#name').value}:{}),email:document.querySelector('#email').value,password:document.querySelector('#password').value})});
    closeModal();currentUser=data.user;renderAuth(currentUser);showDashboard();if(currentUser.role==='admin')showAdmin();
  }catch(e){document.querySelector('#authError').innerHTML=`<div class="error">${esc(e.message)}</div>`}
}
function renderAuth(user){
  const a=document.querySelector('#authArea');
  if(!user){a.innerHTML='<button class="btn dark" onclick="openAuth(\'login\')">Log in</button>';return}
  a.innerHTML=`<span class="welcome">Hi, ${esc(user.name.split(' ')[0])}</span>${user.role==='admin'?'<button class="btn light" onclick="showAdmin()">Admin</button>':''}<button class="btn dark" onclick="logout()">Log out</button>`;
}
async function logout(){await api('/api/auth/logout',{method:'POST'});currentUser=null;renderAuth(null);document.querySelector('#dashboardPanel').innerHTML='<p>Log in to view your orders.</p>';document.querySelector('#adminPanel').innerHTML='<p>Admin access required.</p>'}

async function loadServices(){
  const data=await api('/api/services');services=data.services;
  document.querySelector('#serviceGrid').innerHTML=services.map(s=>`<article class="card"><div class="ico">${esc(s.platform.slice(0,2).toUpperCase())}</div><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><div class="cardfoot"><strong>From ${esc(s.price)}</strong><button onclick="openOrder(${s.id})">Order</button></div></article>`).join('');
}
function openOrder(id){
  const s=services.find(x=>x.id===id);if(!s)return;
  openModal(`<h2>Order ${esc(s.name)}</h2><p>${esc(s.description)}</p><div id="orderError"></div>
    <div class="field"><label>Package</label><select id="package"><option>Starter</option><option>Growth</option><option>Pro</option></select></div>
    <div class="field"><label>Profile / content URL</label><input id="target" placeholder="https://instagram.com/..."></div>
    <button class="btn primary full" onclick="createOrder(${s.id})">Create order</button><p class="hint">You’ll be asked to log in before an order is created.</p>`)
}
async function createOrder(serviceId){
  try{const d=await api('/api/orders',{method:'POST',body:JSON.stringify({serviceId,packageName:document.querySelector('#package').value,targetUrl:document.querySelector('#target').value})});closeModal();await showDashboard();openPayment(d.order.public_id)}
  catch(e){if(e.message.includes('Authentication')){openAuth('login');return}document.querySelector('#orderError').innerHTML=`<div class="error">${esc(e.message)}</div>`}
}
async function openPayment(publicId){
  try{const d=await api('/api/payments/paystack/initialize',{method:'POST',body:JSON.stringify({publicId})});window.location.href=d.authorization_url}
  catch(e){openModal(`<h2>Payment setup</h2><div class="error">${esc(e.message)}</div><button class="btn dark full" onclick="closeModal()">Close</button>`)}
}
async function showDashboard(){
  try{
    const me=await api('/api/auth/me'); currentUser=me.user; renderAuth(currentUser);
    const [d,tickets]=await Promise.all([api('/api/orders'),api('/api/support')]);
    document.querySelector('#dashboardPanel').innerHTML=`<div class="panelhead"><strong>Overview</strong><span class="success pill">Account active</span></div>
      <div class="metricrow"><div><small>Active orders</small><b>${d.orders.filter(o=>['processing','in_progress'].includes(o.status)).length}</b></div><div><small>Total orders</small><b>${d.orders.length}</b></div><div><small>Completed</small><b>${d.orders.filter(o=>o.status==='completed').length}</b></div></div>
      <div class="dashsection"><div class="panelhead"><strong>Recent orders</strong><span class="hint">Tap an order for its timeline</span></div>
      ${d.orders.length?d.orders.slice(0,10).map(o=>`<button class="order orderbtn" onclick="showOrder('${esc(o.public_id)}')"><span><b>${esc(o.public_id)}</b> · ${esc(o.service_name)}<br><small>${esc(o.amount)} · ${esc(o.payment_status)} · ${esc(o.created_at)}</small></span><strong>${esc(o.status.replaceAll('_',' '))}</strong></button>`).join(''):'<p>No orders yet. Choose a service above.</p>'}</div>
      <div class="dashsection"><div class="panelhead"><strong>Support</strong><button class="mini" onclick="showSupport()">New ticket</button></div>
      ${tickets.tickets.length?tickets.tickets.slice(0,5).map(t=>`<div class="order"><span><b>#${t.id} · ${esc(t.subject)}</b><br><small>${esc(t.created_at)}</small></span><strong>${esc(t.status.replaceAll('_',' '))}</strong></div>`).join(''):'<p class="hint">No support tickets yet.</p>'}</div>`;
  }catch{document.querySelector('#dashboardPanel').innerHTML='<p>Log in to view your orders.</p>'}
}
async function showOrder(publicId){
  try{
    const d=await api(`/api/orders/${encodeURIComponent(publicId)}`),o=d.order;
    openModal(`<h2>Order ${esc(o.public_id)}</h2><p><b>${esc(o.service_name)}</b> · ${esc(o.platform)}</p><div class="orderdetail"><div><small>Package</small><b>${esc(o.package_name)}</b></div><div><small>Amount</small><b>${esc(o.amount)}</b></div><div><small>Payment</small><b>${esc(o.payment_status)}</b></div><div><small>Status</small><b>${esc(o.status.replaceAll('_',' '))}</b></div><div><small>Target</small><a href="${esc(o.target_url)}" target="_blank" rel="noopener">Open link</a></div></div><h3>Order timeline</h3><div class="timeline">${o.events.map(e=>`<div><span></span><strong>${esc(e.status.replaceAll('_',' '))}</strong><small>${esc(e.created_at)}</small><p>${esc(e.note||'')}</p></div>`).join('')}</div>`);
  }catch(e){openModal(`<h2>Order unavailable</h2><div class="error">${esc(e.message)}</div>`)}
}
function showSupport(){openModal(`<h2>Contact support</h2><div id="supportError"></div><div class="field"><label>Subject</label><input id="subject" placeholder="Payment, order, service..."></div><div class="field"><label>Message</label><textarea id="message" placeholder="Tell us how we can help"></textarea></div><button class="btn primary full" onclick="sendSupport()">Send request</button>`)}
async function sendSupport(){try{const d=await api('/api/support',{method:'POST',body:JSON.stringify({subject:document.querySelector('#subject').value,message:document.querySelector('#message').value})});openModal(`<h2>Request sent</h2><div class="success">Support ticket #${d.ticketId} has been created.</div><button class="btn dark full" onclick="closeModal()">Close</button>`)}catch(e){document.querySelector('#supportError').innerHTML=`<div class="error">${esc(e.message)}</div>`}}

async function showAdmin(){
  try{const me=await api('/api/auth/me');if(me.user.role!=='admin')throw new Error('Admin access required');currentUser=me.user;renderAuth(currentUser);document.querySelector('#adminPanel').innerHTML='<div class="loading">Loading admin dashboard…</div>';document.querySelector('#admin').scrollIntoView({behavior:'smooth'});
    const [stats,orders,servicesData,tickets,customersData]=await Promise.all([api('/api/admin/stats'),api('/api/admin/orders'),api('/api/admin/services'),api('/api/admin/tickets'),api('/api/admin/customers')]);
    renderAdmin(stats.stats,orders.orders,servicesData.services,tickets.tickets,customersData.customers);
  }catch(e){document.querySelector('#adminPanel').innerHTML=`<div class="error">${esc(e.message)}</div>`}
}
function renderAdmin(stats,orders,svc,tickets,customers){
  const counts=stats.status_counts||{};
  document.querySelector('#adminPanel').innerHTML=`<div class="adminhead"><div><p class="eyebrow">ADMIN CONTROL CENTER</p><h2>BOOSTWITHME operations</h2></div><button class="btn primary" onclick="openNewService()">+ Add service</button></div>
  <div class="adminmetrics"><div><small>Revenue</small><b>${esc(stats.revenue)}</b></div><div><small>Orders</small><b>${stats.total_orders}</b></div><div><small>Paid orders</small><b>${stats.paid_orders}</b></div><div><small>Customers</small><b>${stats.customers}</b></div><div><small>Open tickets</small><b>${stats.open_tickets}</b></div></div>
  <div class="adminsection"><h3>Orders</h3><div class="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Service</th><th>Amount</th><th>Payment</th><th>Status</th></tr></thead><tbody>${orders.slice(0,40).map(o=>`<tr><td><b>${esc(o.public_id)}</b><small>${esc(o.created_at)}</small></td><td>${esc(o.customer_name)}<small>${esc(o.email)}</small></td><td>${esc(o.service_name)}</td><td>${esc(o.amount)}</td><td>${esc(o.payment_status)}</td><td><select onchange="updateOrderStatus('${esc(o.public_id)}',this.value)">${['pending_payment','processing','in_progress','completed','cancelled','refunded'].map(x=>`<option ${x===o.status?'selected':''}>${x}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div></div>
  <div class="adminsection"><h3>Customers</h3><div class="tablewrap"><table><thead><tr><th>Customer</th><th>Joined</th><th>Orders</th><th>Spend</th><th>Role</th></tr></thead><tbody>${customers.slice(0,50).map(c=>`<tr><td><b>${esc(c.name)}</b><small>${esc(c.email)}</small></td><td>${esc(c.created_at)}</td><td>${c.order_count}</td><td>${esc(c.spend)}</td><td><select onchange="updateCustomerRole(${c.id},this.value)">${['customer','admin'].map(x=>`<option ${x===c.role?'selected':''}>${x}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div></div>
  <div class="adminsection"><h3>Services & pricing</h3><div class="tablewrap"><table><thead><tr><th>Service</th><th>Platform</th><th>Price</th><th>Active</th><th></th></tr></thead><tbody>${svc.map(s=>`<tr><td><b>${esc(s.name)}</b><small>${esc(s.description)}</small></td><td>${esc(s.platform)}</td><td>${esc(s.price)}</td><td>${s.active?'Yes':'No'}</td><td><button class="mini" onclick='openEditService(${JSON.stringify(s)})'>Edit</button></td></tr>`).join('')}</tbody></table></div></div>
  <div class="adminsection"><h3>Support tickets</h3><div class="tablewrap"><table><thead><tr><th>#</th><th>Customer</th><th>Subject</th><th>Status</th></tr></thead><tbody>${tickets.slice(0,40).map(t=>`<tr><td>#${t.id}</td><td>${esc(t.customer_name)}<small>${esc(t.email)}</small></td><td><b>${esc(t.subject)}</b><small>${esc(t.message)}</small></td><td><select onchange="updateTicket(${t.id},this.value)">${['open','in_progress','closed'].map(x=>`<option ${x===t.status?'selected':''}>${x}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div></div>`;
}
async function updateCustomerRole(id,role){try{await api(`/api/admin/customers/${id}/role`,{method:'PATCH',body:JSON.stringify({role})});await showAdmin()}catch(e){alert(e.message)}}
async function updateOrderStatus(id,status){try{await api(`/api/admin/orders/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});await showAdmin()}catch(e){alert(e.message)}}
async function updateTicket(id,status){try{await api(`/api/admin/tickets/${id}`,{method:'PATCH',body:JSON.stringify({status})});await showAdmin()}catch(e){alert(e.message)}}
function openNewService(){openServiceForm({title:'Add service',endpoint:'/api/admin/services',method:'POST',service:{name:'',platform:'Instagram',description:'',price_kobo:500000,active:1}})}
function openEditService(s){openServiceForm({title:'Edit service',endpoint:`/api/admin/services/${s.id}`,method:'PATCH',service:s})}
function openServiceForm({title,endpoint,method,service}){openModal(`<h2>${title}</h2><div id="serviceError"></div><div class="field"><label>Name</label><input id="sn" value="${esc(service.name)}"></div><div class="field"><label>Platform</label><input id="sp" value="${esc(service.platform)}"></div><div class="field"><label>Description</label><textarea id="sd">${esc(service.description)}</textarea></div><div class="field"><label>Price (NGN)</label><input id="sprice" type="number" min="1" step="0.01" value="${(service.price_kobo/100).toFixed(2)}"></div><label class="check"><input id="sa" type="checkbox" ${service.active?'checked':''}> Active service</label><button class="btn primary full" onclick="saveService('${endpoint}','${method}')">Save service</button>`)}
async function saveService(endpoint,method){try{await api(endpoint,{method,body:JSON.stringify({name:document.querySelector('#sn').value,platform:document.querySelector('#sp').value,description:document.querySelector('#sd').value,priceKobo:Math.round(Number(document.querySelector('#sprice').value)*100),active:document.querySelector('#sa').checked})});closeModal();showAdmin();loadServices()}catch(e){document.querySelector('#serviceError').innerHTML=`<div class="error">${esc(e.message)}</div>`}}

(async()=>{openResetFromUrl();await loadServices();try{const me=await api('/api/auth/me');currentUser=me.user;renderAuth(me.user);showDashboard();if(me.user.role==='admin')showAdmin()}catch{renderAuth(null)}})();
