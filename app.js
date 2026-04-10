/* ================================================================
   BioAuth — app.js
   Single JS · Login + Dashboard · Lag Ninjas · TMU 2026
   ================================================================
 */
'use strict';

const EMAILJS_CONFIG = {
  publicKey:   'ySkX6AqrHm3UyyM7o', 
  serviceId:   'service_mtxh3s5',   
  templateId:  'template_mzgt54d',          
};

const DEMO_PHRASE = "BioAuth@Secure#9";

/* ─── Storage (batched writes, no hammering) ─── */
const Store = (() => {
  let q = {}, t = null;
  const flush = () => { for (const k in q) { try { localStorage.setItem(k, q[k]); } catch(_){} } q={}; t=null; };
  return {
    set(k, v) { q[k] = typeof v==='string'?v:JSON.stringify(v); if(!t) t=setTimeout(flush,500); },
    get(k, fb=null) { try { const v=localStorage.getItem(k); if(v===null)return fb; try{return JSON.parse(v);}catch(_){return v;} }catch(_){return fb;} },
    del(k) { try{localStorage.removeItem(k);}catch(_){} },
    clear(keys) { keys.forEach(k=>this.del(k)); }
  };
})();

/* ─── Shortcuts ─── */
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const setText = (id,v) => { const e=$(id); if(e) e.textContent=v; };
const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
const sd  = arr => { if(arr.length<2)return 0; const m=avg(arr); return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length); };

/* ─── Toast ─── */
function toast(type, icon, msg) {
  const c = $('toasts'); if(!c) return;
  const el = document.createElement('div');
  el.className = 'toast ' + ({success:'tg',warn:'ta',danger:'tr'}[type]||'');
  el.innerHTML = `<span class="ti">${icon}</span><span class="tt">${msg}</span>`;
  c.appendChild(el);
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),240); }, 3000);
}

/* ─── Alert banner ─── */
function showAlert(msg, type) {
  const box=$('alertBox'); if(!box)return;
  setText('alertIcon',{success:'✅',warn:'⚠️',danger:'❌'}[type]||'●');
  setText('alertMsg', msg);
  box.className = 'alert show '+type;
  clearTimeout(box._t);
  box._t = setTimeout(()=>box.className='alert', 4000);
}

/* ─── Modal ─── */
const openModal  = id => { const e=$(id); if(e) e.classList.add('open'); };
const closeModal = id => {
  // Block closing the step-up modal if it was triggered by anomaly detection
  if(id === 'stepModal' && typeof _otpIsAnomalyModal !== 'undefined' && _otpIsAnomalyModal) return;
  const e=$(id); if(e) e.classList.remove('open');
};

/* ─── Reveal ─── */
function stagger(ids, delay=0, step=80) {
  ids.forEach((id,i)=>{ const e=typeof id==='string'?$(id):id; if(e) setTimeout(()=>e.classList.add('in'),delay+i*step); });
}

/* ─── Log feed ─── */
function log(tag, msg, cls='') {
  const el=$('sysLog'); if(!el)return;
  const t=new Date().toLocaleTimeString('en',{hour12:false});
  const line=document.createElement('div');
  line.className='log-line'+(cls?' '+cls:'');
  line.innerHTML=`<span class="lt">[${t}]</span><span class="lk">[${tag}]</span><span class="lm">${msg}</span>`;
  el.appendChild(line);
  while(el.children.length>40) el.removeChild(el.firstChild);
  el.scrollTop=el.scrollHeight;
}

/* ═══════════════════════════════════════════════════════════
   BIO ENGINE
   ═══════════════════════════════════════════════════════════ */
const Bio = {
  ks:[], mouse:[], vels:[], holdMap:{},
  lastKey:null, lastMouse:{x:0,y:0},
  t0:Date.now(), anomCount:0, enrolled:null,
  _tick:null, _persist:null,
  _anomCooldown:false,   // prevents anomaly spam (1.5s cooldown)

  init() {
    document.addEventListener('keydown',   e=>this._kd(e));
    document.addEventListener('keyup',     e=>this._ku(e));
    document.addEventListener('mousemove', e=>this._mm(e),{passive:true});
    setTimeout(()=>pill('pK'),350);
    setTimeout(()=>pill('pM'),700);
    setTimeout(()=>pill('pS'),1050);

    const savedT0 = Store.get('ba_t0', null);
    if(savedT0) this.t0 = savedT0;
    else { this.t0 = Date.now(); Store.set('ba_t0', this.t0); }

    this._persist = setInterval(()=>Store.set('ba_elapsed',Math.round((Date.now()-this.t0)/1000)),3000);
    log('SYS','BioAuth engine ready','');
  },

  _kd(e) {
    // Don't track keypresses inside OTP input boxes
    if(e.target && e.target.classList.contains('otp-inp')) return;
    const now=Date.now();
    this.holdMap[e.code]=now;
    if(this.lastKey!==null) {
      const iki=now-this.lastKey;
      if(iki>30&&iki<2500) { this.ks.push({iki,t:now}); if(this.ks.length>200)this.ks.shift(); }
    }
    this.lastKey=now;
    setText('mKS',this.ks.length);
    clearTimeout(this._tick);
    this._tick=setTimeout(()=>this._update(),160);
  },

  _ku(e) {
    if(e.target && e.target.classList.contains('otp-inp')) return;
    if(this.holdMap[e.code]) {
      const h=Date.now()-this.holdMap[e.code];
      if(h>20&&h<800&&this.ks.length) this.ks[this.ks.length-1].hold=h;
      delete this.holdMap[e.code];
    }
  },

  _mm(e) {
    const dx=e.clientX-this.lastMouse.x, dy=e.clientY-this.lastMouse.y;
    const d=Math.sqrt(dx*dx+dy*dy);
    if(d>6) {
      this.vels.push(d); if(this.vels.length>50)this.vels.shift();
      this.mouse.push({d,t:Date.now()}); if(this.mouse.length>150)this.mouse.shift();
      this.lastMouse={x:e.clientX,y:e.clientY};
      setText('mMM',this.mouse.length);
    }
  },

  profile() {
    const ikis  = this.ks.map(k=>k.iki);
    const holds = this.ks.map(k=>k.hold).filter(Boolean);
    return {
      avgIKI:avg(ikis), sdIKI:sd(ikis),
      avgHold:avg(holds), sdHold:sd(holds),
      avgVel:avg(this.vels),
      ksCount:this.ks.length, mouseCount:this.mouse.length
    };
  },

  score() {
    const p=this.profile();
    if(p.ksCount<5) return null;

    // ── No enrolled profile yet: enrolment scoring (capped at 60) ──
    if(!this.enrolled) {
      let s=0;
      s += Math.min(p.ksCount,30)*1.3;
      if(p.ksCount>=8&&p.avgIKI>0) {
        const consistency=Math.max(0,1-(p.sdIKI/p.avgIKI));
        s += consistency*14;
      }
      if(p.mouseCount>10) s+=7;
      return Math.min(60,Math.round(s));
    }

    // ── Authenticated scoring vs enrolled profile ──
    const ep=this.enrolled;
    let s=100;

    if(ep.avgIKI>0) {
      const pct=Math.abs(p.avgIKI-ep.avgIKI)/ep.avgIKI;
      if(pct>0.55)      s-=38;
      else if(pct>0.28) s-=20;
      else              s-=pct*28;
    }
    if(ep.avgHold>0&&p.avgHold>0) {
      const pct=Math.abs(p.avgHold-ep.avgHold)/ep.avgHold;
      if(pct>0.65) s-=25;
      else         s-=pct*18;
    }
    if(ep.sdIKI>0&&p.sdIKI>0) {
      const pct=Math.abs(p.sdIKI-ep.sdIKI)/ep.sdIKI;
      if(pct>0.7) s-=14; else s-=pct*9;
    }
    if(ep.avgVel>0&&p.avgVel>0) {
      const pct=Math.abs(p.avgVel-ep.avgVel)/ep.avgVel;
      if(pct>0.8) s-=12; else s-=pct*7;
    }
    if(p.ksCount<10) s-=(10-p.ksCount)*3;

    return Math.max(0,Math.min(100,Math.round(s)));
  },

  _update() {
    const sc=this.score(); if(sc===null)return;
    const cls=sc>=75?'s':sc>=55?'w':'d';
    const numEl=$('trustNum'), barEl=$('barFill'), stEl=$('trustStatus');
    if(numEl){ numEl.textContent=sc+'%'; numEl.className='trust-num '+cls; }
    if(barEl){ barEl.style.width=sc+'%'; barEl.className='bar '+cls; }
    if(stEl) {
      stEl.textContent = !this.enrolled
        ? (sc>=48?'Good sample — ready to enroll':sc>=25?'Collecting behavioral data…':'Keep typing naturally…')
        : (sc>=65?'Strong behavioral match':sc>=40?'Partial match — some deviation':'Low confidence — mismatch detected');
    }

    // Rule: trust < 55 during an active session → increment anomaly counter
    // Cooldown of 1.5s prevents spam increments on every keystroke
    if(this.enrolled && sc < 55 && !this._anomCooldown) {
      this._anomCooldown = true;
      this._recordAnomaly('Low trust score detected (' + sc + '%)');
      // Reset cooldown after 1.5 seconds
      setTimeout(()=>{ this._anomCooldown = false; }, 1500);
    }

    // Persist trust history for dashboard chart
    const hist=Store.get('ba_hist',[]); hist.push({t:Date.now(),sc}); Store.set('ba_hist',hist.slice(-60));
    Store.set('ba_trust',sc);
  },

  /* ─── Record anomaly and check if step-up should fire ─── */
  _recordAnomaly(reason) {
    this.anomCount++;
    setText('mAN', this.anomCount);
    log('ANOMALY', reason + ' [' + this.anomCount + '/3]', 'err');

    // Persist anomaly to storage (for dashboard)
    const sc = this.score() || 0;
    const a = Store.get('ba_anoms', []);
    a.unshift({ t: new Date().toLocaleTimeString(), reason, sc });
    Store.set('ba_anoms', a.slice(0, 25));

    // After 3 anomalies → trigger step-up authentication
    if(this.anomCount >= 3) {
      this.anomCount = 0;  // reset counter
      setText('mAN', 0);
      log('AUTH', 'Anomaly threshold reached — triggering Step-Up', 'err');
      setTimeout(()=>triggerStepUp(true), 500);
    }
  },

  reset() {
    this.ks=[];this.mouse=[];this.vels=[];this.lastKey=null;
    this.anomCount=0; this._anomCooldown=false;
    ['mKS','mMM','mAN'].forEach(id=>setText(id,'0'));
    const n=$('trustNum'),b=$('barFill'),s=$('trustStatus');
    if(n){n.textContent='--';n.className='trust-num e';}
    if(b){b.style.width='0%';b.className='bar';}
    if(s) s.textContent='Start typing to analyze…';
  },

  loadSaved() { const d=Store.get('ba_profile',null); if(d) this.enrolled=d.profile; return d; }
};

function pill(id) { const e=$(id); if(e) e.classList.add('on'); }

/* ═══════════════════════════════════════════════════════════
   EMAIL OTP — via EmailJS
   ═══════════════════════════════════════════════════════════ */
let _currentOtp = '';       // in-memory OTP (source of truth)
let _otpTimerInterval = null;
let _otpSecondsLeft = 60;

async function sendOtpEmail(otp, email) {
  try {
    // Verify EmailJS is loaded
    if(typeof emailjs === 'undefined') {
      console.error('EmailJS SDK not loaded.');
      return false;
    }

    await emailjs.send(
      EMAILJS_CONFIG.serviceId,
      EMAILJS_CONFIG.templateId,
      {
        to_email:   email,   // {{to_email}} in your template
        user_email: email,   // {{user_email}} — shown in body as "Hello, user@..."
        otp_code:   otp,     // {{otp_code}} — the 6-digit code
      },
      EMAILJS_CONFIG.publicKey
    );

    return true;
  } catch(err) {
    console.error('EmailJS send error:', err);
    return false;
  }
}

/* ─── OTP Input wiring ─── */
function wireOtpInputs() {
  const inputs = Array.from($$('#otpInputWrap .otp-inp'));
  if(!inputs.length) return;

  inputs.forEach((inp, i) => {
    inp.addEventListener('input', e => {
      inp.value = inp.value.replace(/\D/g,'').slice(-1);
      inp.classList.toggle('filled', !!inp.value);
      clearOtpError();
      if(inp.value && i < inputs.length - 1) inputs[i+1].focus();
      // Auto-verify when all 6 digits filled
      if(getOtpInput().length === 6) setTimeout(doVerify, 120);
    });

    inp.addEventListener('keydown', e => {
      if(e.key === 'Backspace') {
        if(!inp.value && i > 0) { inputs[i-1].value=''; inputs[i-1].classList.remove('filled'); inputs[i-1].focus(); }
        else { inp.classList.remove('filled'); }
        clearOtpError();
      }
      if(e.key === 'ArrowLeft'  && i > 0) inputs[i-1].focus();
      if(e.key === 'ArrowRight' && i < inputs.length-1) inputs[i+1].focus();
      if(e.key === 'Enter') doVerify();
    });

    inp.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData||window.clipboardData).getData('text').replace(/\D/g,'');
      text.split('').slice(0,6).forEach((ch,j)=>{ if(inputs[j]){ inputs[j].value=ch; inputs[j].classList.add('filled'); } });
      inputs[Math.min(text.length, inputs.length-1)].focus();
      clearOtpError();
      if(text.length === 6) setTimeout(doVerify, 120);
    });
  });
}

function getOtpInput() {
  return Array.from($$('#otpInputWrap .otp-inp')).map(i=>i.value).join('');
}

function clearOtpInputs() {
  $$('#otpInputWrap .otp-inp').forEach(i=>{ i.value=''; i.classList.remove('filled'); });
  const first = document.querySelector('#otpInputWrap .otp-inp');
  if(first) first.focus();
}

function clearOtpError() {
  const el=$('otpError'); if(el){ el.textContent=''; el.style.display='none'; }
}

function showOtpError(msg) {
  const el=$('otpError'); if(!el)return;
  el.textContent=msg; el.style.display='block';
  const row=$('otpInputWrap');
  if(row){ row.classList.add('shake'); setTimeout(()=>row.classList.remove('shake'),500); }
}

/* ─── OTP countdown timer ─── */
// _otpIsAnomalyModal: when true, expiry reloads the page (no bypass allowed)
let _otpIsAnomalyModal = false;

function startOtpTimer(anomalyTriggered) {
  clearOtpTimer();
  _otpIsAnomalyModal = !!anomalyTriggered;
  _otpSecondsLeft = 60;
  updateOtpTimerDisplay();
  _otpTimerInterval = setInterval(()=>{
    _otpSecondsLeft--;
    updateOtpTimerDisplay();
    if(_otpSecondsLeft <= 0) {
      clearOtpTimer();
      _currentOtp = '';
      if(_otpIsAnomalyModal) {
        showOtpError('OTP expired. Reloading…');
        setTimeout(()=>location.reload(), 1200);
      } else {
        showOtpError('OTP expired. Close and try authenticating again.');
        $$('#otpInputWrap .otp-inp').forEach(i=>{ i.disabled=true; });
        const vb=$('verifyBtn'); if(vb) vb.disabled=true;
      }
    }
  }, 1000);
}

function clearOtpTimer() {
  if(_otpTimerInterval) { clearInterval(_otpTimerInterval); _otpTimerInterval=null; }
}

function updateOtpTimerDisplay() {
  const el=$('otpTimer'); if(!el)return;
  el.textContent = _otpSecondsLeft+'s';
  el.style.color = _otpSecondsLeft <= 10 ? 'var(--red)' : 'var(--amber)';
}

/* ═══════════════════════════════════════════════════════════
   LOGIN PAGE
   ═══════════════════════════════════════════════════════════ */
function initLogin() {
  stagger(['rv0','rv1','rv2'],0,150);
  Bio.init();
  wireOtpInputs();

  const saved=Bio.loadSaved();
  if(saved) {
    // Do NOT pre-fill email — user must type it manually each time for security
    toAuthMode();
    log('SYS','Profile found — please type your email to authenticate','');
  }

  $('enrollBtn').addEventListener('click',doEnroll);
  $('authBtn').addEventListener('click',doAuth);

  /* ── Voice Pattern: speak prompt when user moves cursor to passphrase field ── */
  const passField = $('passField');
  const emailField = $('emailField');
  let _voicePlayed = false;
  function speakPassphrasePrompt() {
    const email = emailField ? emailField.value.trim() : '';
    if(!email || _voicePlayed) return;
    if(!window.speechSynthesis) return;
    _voicePlayed = true;
    const utt = new SpeechSynthesisUtterance('Type the demo passphrase');
    utt.rate = 0.95;
    utt.pitch = 1;
    utt.volume = 1;
    window.speechSynthesis.speak(utt);
  }
  if(passField) {
    passField.addEventListener('focus', speakPassphrasePrompt);
    passField.addEventListener('mouseenter', speakPassphrasePrompt);
  }
  // Reset voice flag when email changes so it re-triggers if they change email
  if(emailField) emailField.addEventListener('input', ()=>{ _voicePlayed = false; });
  $('verifyBtn').addEventListener('click',doVerify);
  $('cancelBtn').addEventListener('click',()=>{
    // Block cancel if this is an anomaly-triggered OTP (no bypass allowed)
    if(_otpIsAnomalyModal) return;
    // For normal step-up: cancel = reload the page (user must start over)
    clearOtpTimer();
    _currentOtp = '';
    toast('warn','🔄','Step-up cancelled — reloading…');
    setTimeout(()=>location.reload(), 900);
  });
  $('dashBtn').addEventListener('click',()=>window.open('dashboard.html','_blank'));
}

function toAuthMode() {
  const t=$('modeTag');
  if(t){t.className='mode-tag au';t.innerHTML='<span class="blink"></span>Auth Mode';}
  const eb=$('enrollBtn'),ab=$('authBtn');
  if(eb)eb.style.display='none';
  if(ab)ab.style.display='flex';
}

function toEnrollMode() {
  const t=$('modeTag');
  if(t){t.className='mode-tag en';t.innerHTML='<span class="blink"></span>Enroll Mode';}
  const eb=$('enrollBtn'),ab=$('authBtn');
  if(eb)eb.style.display='flex';
  if(ab)ab.style.display='none';
}

/* ─── Auto-fill demo phrase helper ─── */
function fillDemo() {
  const pf=$('passField'); if(pf){ pf.value=DEMO_PHRASE; pf.focus(); }
}

function doEnroll() {
  const email=($('emailField')||{}).value?.trim()||'';
  const pass =($('passField') ||{}).value||'';

  if(!email) return showAlert('Please enter your email address.','warn');
  if(pass !== DEMO_PHRASE) return showAlert('Use the demo passphrase shown below the field.','warn');

  const p=Bio.profile();
  if(p.ksCount<8) return showAlert('Type the phrase naturally to capture behavior.','warn');

  Bio.enrolled=p;
  Bio.t0=Date.now();
  Store.set('ba_t0',Bio.t0);

  // Store profile WITHOUT password
  Store.set('ba_profile',{email,profile:p,at:Date.now()});
  Store.set('ba_email',email);

  log('ENROLL','Behavior profile captured','ok');
  toast('success','✅','Profile enrolled successfully');

  toAuthMode();
  $('passField').value='';
  Bio.reset();
}

function doAuth() {
  const inputPass = ($('passField') || {}).value || '';

  if(inputPass !== DEMO_PHRASE) {
    // Clear passphrase and reset trust score so user starts fresh
    const pf = $('passField');
    if(pf) { pf.value = ''; pf.focus(); }
    Bio.reset();
    showAlert('Wrong passphrase — cleared. Type the demo phrase again.','danger');
    log('AUTH','❌ Wrong passphrase — passphrase cleared, trust reset','err');
    return;
  }

  const sc = Bio.score();
  if(sc===null || Bio.ks.length<5) return showAlert('Type the phrase naturally.','warn');

  Store.set('ba_auth',{sc,t:Date.now()});

  /* ── TRUST SCORE THRESHOLDS ──────────────────────────────
     ≥ 75  → Direct Login (Access Granted)
     55–74 → Step-Up Authentication (OTP via email)
     < 55  → Counts as anomaly (handled by _update/_recordAnomaly)
  ────────────────────────────────────────────────────────── */
  if(sc >= 75) {
    Store.set('ba_authResult','success');
    log('AUTH','✅ Granted — Trust:'+sc+'%','ok');
    showSuccess();
  }
  else if(sc >= 55) {
    Store.set('ba_authResult','stepup');
    log('AUTH','⚠ Step-up required — Trust:'+sc+'%','err');
    triggerStepUp(false);
  }
  else {
    // Below 55 — clear passphrase, reset trust, then reload
    Bio.anomCount = 0;
    Bio._anomCooldown = true;
    const pf = $('passField');
    if(pf) pf.value = '';
    Bio.reset();
    Store.set('ba_authResult','failed');
    log('AUTH','❌ Denied — Trust:'+sc+'% — reloading page','err');
    showAlert('Trust score too low ('+sc+'%). Page reloading in 2s…','danger');
    toast('danger','❌','Low trust score — restarting…');
    const ab=$('authBtn'), eb=$('enrollBtn');
    if(ab) ab.disabled=true;
    if(eb) eb.disabled=true;
    setTimeout(()=>location.reload(), 2000);
  }
}

/* ─── Step-Up: generate OTP, send via email, open modal ─── */
async function triggerStepUp(fromAnomaly) {
  // Generate 6-digit OTP
  _currentOtp = String(Math.floor(100000 + Math.random() * 900000));

  // Hide/show cancel button: anomaly-triggered = NO cancel (no bypass)
  const cancelBtn = $('cancelBtn');
  if(cancelBtn) cancelBtn.style.display = fromAnomaly ? 'none' : '';

  // Update modal title for anomaly context
  const modalTitle = document.querySelector('#stepModal .modal-title');
  if(modalTitle && fromAnomaly) modalTitle.textContent = '🚨 Suspicious Activity Detected';
  const modalBody = document.querySelector('#stepModal .modal-body');
  if(modalBody && fromAnomaly) modalBody.textContent = '3 behavioral anomalies were detected in your session. You must verify your identity via OTP to continue. This popup cannot be dismissed.';

  // ── Show "sent to email" message ──
  const wrap = $('otpWrap');
  if(wrap) {
    wrap.innerHTML = `
      <div style="
        width:100%; text-align:center; padding:10px 14px;
        background:rgba(96,165,250,0.08); border:1px solid rgba(96,165,250,0.22);
        border-radius:8px; font-size:.72rem; color:var(--blue); line-height:1.6;
      ">
        📧 OTP sent to your email.<br>
        <span style="color:var(--t3); font-size:.65rem;">Check your inbox (and spam folder).</span>
      </div>`;
  }

  // Re-enable inputs in case they were disabled by a previous expired OTP
  $$('#otpInputWrap .otp-inp').forEach(i=>{ i.disabled=false; });
  const vb=$('verifyBtn'); if(vb) vb.disabled=false;

  clearOtpInputs();
  clearOtpError();
  openModal('stepModal');
  startOtpTimer(fromAnomaly);  // pass flag so expiry knows whether to reload

  setTimeout(()=>{ const f=document.querySelector('#otpInputWrap .otp-inp'); if(f) f.focus(); }, 350);

  // ── Send OTP email ──
  const email = Store.get('ba_email','') || ($('emailField')||{}).value?.trim() || '';
  if(!email) {
    log('OTP','No email found — cannot send OTP','err');
    toast('warn','⚠️','No email on file. OTP not sent.');
    return;
  }

  log('OTP','Sending OTP to '+email+'…','');
  toast('warn','📧','Sending OTP to '+email+'…');

  const sent = await sendOtpEmail(_currentOtp, email);

  if(sent) {
    log('OTP','OTP sent successfully to '+email,'ok');
    toast('success','✅','OTP sent to '+email);
  } else {
    // EmailJS not configured or failed — fallback: show OTP in console for demo
    log('OTP','EmailJS not configured — OTP logged to console (demo mode)','err');
    toast('warn','⚠️','Email not configured. Check console for demo OTP.');
    console.warn('╔══════════════════════════════════╗');
    console.warn('║  DEMO MODE — OTP: ' + _currentOtp + '          ║');
    console.warn('╚══════════════════════════════════╝');
    console.warn('Configure EMAILJS_CONFIG in app.js to send real emails.');

    // In demo mode, show OTP on screen as fallback
    if(wrap) {
      wrap.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:.6rem;color:var(--t3);margin-bottom:6px;">
            ⚠️ Demo mode — EmailJS not configured
          </div>
          <div style="display:flex;gap:8px;justify-content:center;">
            ${_currentOtp.split('').map(d=>`<div class="otp-d">${d}</div>`).join('')}
          </div>
        </div>`;
    }
  }
}

function doVerify() {
  const entered = getOtpInput();

  if(entered.length < 6) {
    showOtpError('Please enter all 6 digits.'); return;
  }

  // Compare against in-memory OTP (no localStorage delay issues)
  if(entered !== _currentOtp) {
    showOtpError('Incorrect OTP. Please try again.');
    $$('#otpInputWrap .otp-inp').forEach(i=>{ i.value=''; i.classList.remove('filled'); });
    document.querySelector('#otpInputWrap .otp-inp')?.focus();
    return;
  }

  clearOtpTimer();
  _currentOtp = '';
  closeModal('stepModal');
  clearOtpInputs();
  clearOtpError();
  Store.set('ba_authResult','stepup-verified');
  log('OTP','Step-up OTP verified successfully','ok');
  toast('success','✅','OTP verified. Access granted.');
  setTimeout(showSuccess, 280);
}

function showSuccess() {
  const el=$('successScreen'); if(!el)return;
  const email=Store.get('ba_email','');
  const sEmail=$('successEmail');
  if(sEmail) sEmail.textContent = email ? '👤 '+email : '';
  el.classList.add('show');
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD PAGE
   ═══════════════════════════════════════════════════════════ */
let chart=null;

function initDashboard() {
  setText('initTime',new Date().toLocaleTimeString());
  loadDash();
  stagger(['rv0','rv1','rv2','rv3','rv4','rv5'],0,75);
  wireSidebar();
  wireMobileMenu();

  const tryChart=()=>{ if(typeof Chart!=='undefined')initChart(); else setTimeout(tryChart,100); };
  tryChart();

  const rb=$('refreshBtn');
  if(rb) rb.addEventListener('click',()=>{
    loadDash();
    setText('lastRefresh','Updated '+new Date().toLocaleTimeString());
    addRow('Manual Refresh','success');
    toast('success','↻','Dashboard refreshed.');
  });

  const cb=$('clearBtn'), cc=$('clearCancelBtn');
  if(cb) cb.addEventListener('click',doClear);
  if(cc) cc.addEventListener('click',()=>closeModal('clearModal'));

  [$('logoutBtn'), $('hdrLogoutBtn')].forEach(btn=>{ if(btn) btn.addEventListener('click', doLogout); });

  updateSidebarSession();
  setInterval(updateSidebarSession, 1000);

  const profile=Store.get('ba_profile',null);
  const warn=$('noProfileWarn');
  if(warn) warn.style.display = profile ? 'none' : 'flex';

  // Live refresh loop every 3 seconds
  let last=0;
  (function loop(ts){
    if(ts-last>3000){ loadDash(); setText('lastRefresh','Updated '+new Date().toLocaleTimeString()); last=ts; }
    requestAnimationFrame(loop);
  })(0);
}

function wireMobileMenu() {
  const hamburger=$('hamburger'), sidebar=$('sidebar'), overlay=$('sbOverlay');
  if(!hamburger||!sidebar) return;
  hamburger.addEventListener('click',()=>{
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  });
  if(overlay) overlay.addEventListener('click',()=>{ sidebar.classList.remove('open'); overlay.classList.remove('open'); });
}

function wireSidebar() {
  const actions = {
    'overview'   : ()=>scrollMain(0),
    'analytics'  : ()=>scrollTo('rv3'),
    'sessions'   : ()=>scrollTo('rv4'),
    'anomalies'  : ()=>scrollTo('rv4'),
    'policies'   : ()=>toast('warn','🛡','Policies module — coming soon.'),
    'stepup'     : ()=>scrollTo('rv4'),
    'keystroke'  : ()=>scrollTo('rv5'),
    'mouse'      : ()=>scrollTo('rv5'),
    'session-mon': ()=>scrollTo('rv4'),
    'login-demo' : ()=>window.open('index.html','_blank'),
    'clear'      : ()=>openModal('clearModal'),
    'logout'     : ()=>doLogout(),
  };

  $$('[data-nav]').forEach(item=>{
    const key = item.dataset.nav;
    const fn  = actions[key];
    if(!fn) return;
    item.style.cursor = 'pointer';
    item.addEventListener('click', ()=>{
      $$('[data-nav]').forEach(n=>n.classList.remove('on'));
      item.classList.add('on');
      const sidebar=$('sidebar'), overlay=$('sbOverlay');
      if(sidebar) sidebar.classList.remove('open');
      if(overlay) overlay.classList.remove('open');
      fn();
    });
  });
}

function scrollMain(top) { const m=$('dashMain'); if(m) m.scrollTo({top,behavior:'smooth'}); }
function scrollTo(id)    { const el=$(id); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }

function doLogout() {
  Store.clear(['ba_trust','ba_authResult','ba_auth','ba_hist','ba_anoms','ba_elapsed','ba_otp','ba_t0']);
  toast('warn','🚪','Logged out. Redirecting…');
  setTimeout(()=>window.location.href='index.html',900);
}

function updateSidebarSession() {
  const t0     = Store.get('ba_t0', null);
  const result = Store.get('ba_authResult', null);
  const info   = $('sbSessionInfo');
  if(!info) return;

  if(result) {
    info.style.display='block';
    if(t0) {
      const secs = Math.round((Date.now()-t0)/1000);
      const mins = Math.floor(secs/60), s=secs%60;
      setText('sbSessionTimer', mins>0?`${mins}m ${s}s`:`${s}s`);
    }
    const statusMap = {'success':'✅ Granted','stepup':'⚠ Step-Up','stepup-verified':'✅ Verified','failed':'❌ Denied'};
    setText('sbAuthStatus', statusMap[result]||'--');
  } else {
    info.style.display='none';
  }
}

function initChart() {
  const ctx=$('trustChart'); if(!ctx||chart)return;
  chart=new Chart(ctx,{
    type:'line',
    data:{labels:[],datasets:[
      {label:'Trust Score',data:[],borderColor:'#60a5fa',backgroundColor:'rgba(96,165,250,0.07)',fill:true,tension:.4,pointRadius:2.5,pointBackgroundColor:'#60a5fa',borderWidth:1.8},
      {label:'Auth Threshold (65%)',data:[],borderColor:'rgba(251,191,36,0.4)',borderDash:[5,5],pointRadius:0,borderWidth:1.4,fill:false}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,animation:{duration:260},
      plugins:{legend:{labels:{color:'#475569',font:{family:'JetBrains Mono',size:10}}}},
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.03)'},ticks:{color:'#334155',font:{size:9,family:'JetBrains Mono'},maxTicksLimit:8}},
        y:{min:0,max:100,grid:{color:'rgba(255,255,255,0.03)'},ticks:{color:'#334155',font:{size:9,family:'JetBrains Mono'},callback:v=>v+'%'}}
      }
    }
  });
}

function loadDash() {
  const trust  =Store.get('ba_trust',null);
  const profile=Store.get('ba_profile',null);
  const elapsed=Store.get('ba_elapsed',0);
  const authRes=Store.get('ba_authResult',null);
  const email  =Store.get('ba_email',null);
  const anoms  =Store.get('ba_anoms',[]);

  if(email){ setText('userEmail',email); const av=$('userAv'); if(av) av.textContent=email[0].toUpperCase(); }

  if(trust!==null) {
    const t=parseInt(trust); setText('dsTrust',t+'%'); updateGauge(t);
  }
  if(profile){
    const p=profile.profile;
    setText('dsKS',p.ksCount||0);
    setText('miIKI',Math.round(p.avgIKI||0)+'ms');
    setText('miMouse',p.mouseCount||0);
    setText('miEnrolled','✓ Yes');
    renderSigs(p);
  }

  setText('dsAnom',anoms.length);

  const secs=parseInt(elapsed)||0;
  const mins=Math.floor(secs/60);
  setText('dsSession', mins>0?`${mins}m ${secs%60}s`:`${secs}s`);

  const statusMap={'success':'✅','stepup':'⚠','stepup-verified':'✅','failed':'❌'};
  setText('miAuth',statusMap[authRes]||'--');

  renderAnoms(anoms);
  updateChart();
}

function updateGauge(sc) {
  const circ=365;
  const ring=$('gRing'), badge=$('gBadge'), num=$('gNum');
  if(ring) ring.style.strokeDashoffset=circ-(sc/100)*circ;
  if(num)  num.textContent=sc+'%';
  if(!badge)return;
  if(sc>=65)      { if(ring)ring.style.stroke='var(--green)'; badge.className='badge bg'; badge.innerHTML='<span class="dot p"></span>Secure Session'; }
  else if(sc>=40) { if(ring)ring.style.stroke='var(--amber)'; badge.className='badge ba'; badge.innerHTML='<span class="dot p"></span>Elevated Risk'; }
  else            { if(ring)ring.style.stroke='var(--red)';   badge.className='badge br'; badge.innerHTML='<span class="dot p"></span>High Risk!'; }
}

function renderAnoms(anoms) {
  const feed=$('anomFeed'), badge=$('anomBadge');
  if(!feed)return;
  if(badge) badge.innerHTML=`<span class="dot p"></span>${anoms.length} Alert${anoms.length!==1?'s':''}`;
  if(!anoms.length){
    feed.innerHTML='<div style="text-align:center;padding:26px 0;color:var(--t3);font-size:.7rem;"><div style="font-size:1.3rem;margin-bottom:6px">✅</div>No anomalies detected</div>';
    return;
  }
  feed.innerHTML=anoms.map(a=>{
    const sc=a.sc||50, lv=sc<40?'high':sc<65?'med':'low';
    const ico={high:'🔴',med:'🟡',low:'🔵'}[lv];
    const col={high:'var(--red)',med:'var(--amber)',low:'var(--blue)'}[lv];
    const bg ={high:'rgba(248,113,113,0.1)',med:'rgba(251,191,36,0.1)',low:'rgba(96,165,250,0.1)'}[lv];
    const bd ={high:'rgba(248,113,113,0.22)',med:'rgba(251,191,36,0.22)',low:'rgba(96,165,250,0.22)'}[lv];
    return `<div class="anom-item"><div class="ad" style="background:${bg};border:1px solid ${bd}">${ico}</div><div class="ab"><div class="an">${a.reason}</div><div class="am">${a.t} · ${lv.toUpperCase()}</div></div><div class="ap" style="color:${col}">${sc}%</div></div>`;
  }).join('');
}

function updateChart() {
  const hist=Store.get('ba_hist',[]); if(!hist.length||!chart)return;
  const sl=hist.slice(-25);
  chart.data.labels=sl.map(h=>new Date(h.t).toLocaleTimeString('en',{hour12:false}));
  chart.data.datasets[0].data=sl.map(h=>h.sc);
  chart.data.datasets[1].data=new Array(sl.length).fill(65);
  chart.update('none');
}

function renderSigs(p) {
  const el=$('sigList'); if(!el)return;

  const enrolled = {
    iki  : Math.min((p.avgIKI ||0)/500*100, 100),
    hold : Math.min((p.avgHold||0)/250*100, 100),
    vel  : Math.min((p.avgVel ||0)/45 *100, 100),
    cont : Math.min((p.ksCount||0)/40 *100, 100),
  };

  const trust = parseInt(Store.get('ba_trust', 100)) || 100;
  const deviation = (100 - trust) / 100;

  const live = {
    iki  : Math.max(0, enrolled.iki  * (1 - deviation * 0.9  + (Math.random()-.5)*0.04)),
    hold : Math.max(0, enrolled.hold * (1 - deviation * 0.85 + (Math.random()-.5)*0.04)),
    vel  : Math.max(0, enrolled.vel  * (1 - deviation * 0.7  + (Math.random()-.5)*0.06)),
    cont : Math.max(0, enrolled.cont * (1 - deviation * 0.5  + (Math.random()-.5)*0.03)),
  };

  const sigs=[
    {name:'Inter-Key Interval',  unit:Math.round(p.avgIKI ||0)+'ms', e:enrolled.iki,  l:live.iki,  c:'#60a5fa'},
    {name:'Key Hold Duration',   unit:Math.round(p.avgHold||0)+'ms', e:enrolled.hold, l:live.hold, c:'#a78bfa'},
    {name:'Mouse Velocity',      unit:Math.round(p.avgVel ||0)+'px', e:enrolled.vel,  l:live.vel,  c:'#2dd4bf'},
    {name:'Session Continuity',  unit:p.ksCount+' keys',             e:enrolled.cont, l:live.cont, c:'#fbbf24'},
  ];

  el.innerHTML=sigs.map(s=>`
    <div>
      <div class="sig-head">
        <span class="sig-name">${s.name}</span>
        <span class="sig-nums">
          <span style="color:var(--t3)">Value: <strong style="color:${s.c}">${s.unit}</strong></span>
          <span style="color:var(--t3)">Enrolled: <strong style="color:${s.c};opacity:.7">${Math.round(s.e)}%</strong></span>
          <span style="color:var(--t3)">Live: <strong style="color:${s.c};opacity:.55">${Math.round(s.l)}%</strong></span>
        </span>
      </div>
      <div class="sig-track" style="margin-bottom:3px"><div class="sig-fill" style="background:${s.c};opacity:.35;width:${s.e}%"></div></div>
      <div class="sig-track"><div class="sig-fill" style="background:${s.c};width:${s.l}%"></div></div>
    </div>`).join('');
}

function addRow(name,status) {
  const tbody=$('sessionLog'); if(!tbody)return;
  const cls={success:'bg',warn:'ba',danger:'br'}[status]||'bd';
  const row=document.createElement('tr');
  row.innerHTML=`<td>${name}</td><td>${new Date().toLocaleTimeString()}</td><td><span class="badge ${cls}">${status.toUpperCase()}</span></td>`;
  tbody.insertBefore(row,tbody.firstChild);
  while(tbody.children.length>20) tbody.removeChild(tbody.lastChild);
}

function doClear() {
  Store.clear(['ba_profile','ba_anoms','ba_hist','ba_trust','ba_email','ba_authResult','ba_auth','ba_elapsed','ba_otp','ba_t0']);
  closeModal('clearModal');
  toast('warn','🗑','Profile data cleared.');
  setTimeout(()=>location.reload(),600);
}

/* ─── Router ─── */
document.addEventListener('DOMContentLoaded',()=>{
  if($('enrollBtn'))       initLogin();
  else if($('trustChart')) initDashboard();
});