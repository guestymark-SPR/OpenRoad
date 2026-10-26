/* OpenRoad group chat: messages between riders in the group, WhatsApp style. Text, quick messages,
   locations and private messages to one rider, with ticks for sent, arrived and read. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  let box = null, to = '', lastDraw = '';

  const day = t => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }); };
  const tick = n => n === 3 ? '<i class="tk read" title="Read">✓✓</i>' : n === 2 ? '<i class="tk" title="Arrived">✓✓</i>' : '<i class="tk" title="Sent">✓</i>';
  const nameOf = id => { const r = OR.group.state.riders.find(x => x.id === id); return r ? r.n : 'a rider'; };
  const linkify = t => esc(t).replace(/\n/g, '<br>');

  // the thread: chat messages plus quick messages and who joined or left, in time order
  function thread() {
    const st = OR.group.state, out = OR.group.chatList().map(m => Object.assign({ kind: 'chat' }, m));
    (st.msgs || []).forEach(m => out.push(Object.assign({ kind: m.sys ? 'sys' : 'quick' }, m)));
    return out.sort((a, b) => a.t - b.t);
  }
  function bubble(m) {
    if (m.kind === 'sys') return '<div class="cm-sys">' + esc((m.n ? m.n + ' ' : '') + m.text) + '</div>';
    const mine = m.mine, time = OR.clock(new Date(m.t));
    const head = mine ? '' : '<b class="cm-who" style="color:' + esc(m.c || '#e53935') + '">' + esc(m.n) + '</b>';
    let body;
    if (m.kind === 'quick') body = '<span class="cm-quick ' + (m.k === 'help' || m.k === 'crash' ? 'sos' : '') + '">' + esc(m.text) + '</span>';
    else {
      body = (m.to ? '<span class="cm-priv">' + ic('chat') + (mine ? 'Private to ' + esc(nameOf(m.to)) : 'Private to you') + '</span>' : '') + (m.x ? '<span class="cm-text">' + linkify(m.x) + '</span>' : '');
      if (m.la != null) body += '<button class="cm-loc" data-la="' + m.la + '" data-lo="' + m.lo + '" data-n="' + esc(mine ? 'You' : m.n) + '">' + OR.badge('near', '#e53935') + '<span><b>' + (mine ? 'Your' : esc(m.n) + '\'s') + ' location</b><small>Tap to show on the map' + (OR.pos ? ' · ' + OR.fmtDist(OR.dist([OR.pos.lng, OR.pos.lat], [m.lo, m.la])) + ' away' : '') + '</small></span></button>';
    }
    return '<div class="cm ' + (mine ? 'cmine' : 'ctheirs') + '"><div class="cm-b">' + head + body + '<span class="cm-t">' + time + (mine && m.kind === 'chat' ? tick(OR.group.ticks(m)) : '') + '</span></div></div>';
  }
  function draw(force) {
    if (!box) return;
    const st = OR.group.state, list = thread();
    const sig = list.length + ':' + (list.length ? list[list.length - 1].key : '') + ':' + list.filter(m => m.mine).map(m => OR.group.ticks(m)).join('') + ':' + st.riders.length;
    if (!force && sig === lastDraw) return; lastDraw = sig;
    const el = $('#chatList', box), atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    let h = '', d = '';
    list.forEach(m => { const dd = day(m.t); if (dd !== d) { d = dd; h += '<div class="cm-day"><span>' + dd + '</span></div>'; } h += bubble(m); });
    el.innerHTML = h || '<div class="cm-empty">' + ic('chat', 'big') + '<p>Messages to the group show here. Everyone in the group sees them, even if they had no signal when you sent them. Use the microphone on your keyboard to talk instead of typing.</p></div>';
    if (atEnd || force) el.scrollTop = el.scrollHeight;
    $$('.cm-loc', el).forEach(b => b.onclick = () => { OR.closeChat(); OR.map.flyTo({ center: [+b.dataset.lo, +b.dataset.la], zoom: 15 }); if (innerWidth < 900) $('#panel').classList.remove('open'); });
    const on = st.riders.filter(r => r.age <= OR.GROUP_LOST).length;
    $('#chatSub', box).textContent = (st.riders.length + 1) + ' riders, ' + (on + 1) + ' online';
    toChip();
    OR.group.chatSeen();
  }
  function toChip() {
    const c = $('#chatTo', box); if (!c) return;
    c.innerHTML = ic('chat') + (to ? 'Private to ' + esc(nameOf(to)) : 'To everyone') + ' ▾';
    c.classList.toggle('priv', !!to);
  }

  OR.openChat = function () {
    if (!OR.group.state.on) return OR.openMore('group');
    if (!box) {
      box = document.createElement('div'); box.id = 'chat';
      box.innerHTML = '<div class="ch-top"><button class="ch-back" id="chatBack" aria-label="Close">' + ic('back') + '</button><div class="ch-t"><b>Group chat</b><small id="chatSub"></small></div>' +
        '<button class="ch-vol" id="chatVol" aria-label="Read messages aloud"></button></div>' +
        '<div id="chatList"></div>' +
        '<div id="chatPresets" class="ch-presets"></div>' +
        '<div class="ch-bar"><div class="ch-tools"><button id="chatTo" class="ch-to"></button><button id="chatPre" class="ch-to">Quick messages ▴</button></div><div class="ch-row"><button id="chatLoc" class="ch-ic" aria-label="Send my location">' + ic('near') + '</button>' +
        '<textarea id="chatIn" rows="1" maxlength="500" placeholder="Message"></textarea><button id="chatSend" class="ch-send" aria-label="Send">' + ic('send') + '</button></div></div>';
      document.body.appendChild(box);
      $('#chatBack', box).onclick = OR.closeChat;
      const vol = () => { const c = OR.chatCfg(); $('#chatVol', box).innerHTML = ic(c.voice ? 'vol' : 'mute'); $('#chatVol', box).classList.toggle('off', !c.voice); };
      $('#chatVol', box).onclick = () => { const c = OR.chatCfg(); c.voice = !c.voice; OR.saveCfg(); OR.chatApply(); vol(); OR.toast(c.voice ? 'New messages will be read out' : 'Messages won\'t be read out'); };
      vol(); OR.chatVolUi = vol;
      $('#chatPre', box).onclick = () => setPresets(!presetsOpen);
      $('#chatIn', box).addEventListener('focus', () => { if (innerHeight < 700) setPresets(false); });
      const input = $('#chatIn', box);
      const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
      input.oninput = grow;
      const send = () => { const t = input.value.trim(); if (!t) return; OR.group.chatSend(t, to, false); input.value = ''; grow(); setTimeout(() => draw(true), 450); };
      $('#chatSend', box).onclick = send;
      input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
      $('#chatLoc', box).onclick = () => { if (!OR.pos) return OR.toast('Waiting for your position'); OR.group.chatSend('', to, true); setTimeout(() => draw(true), 450); };

      $('#chatTo', box).onclick = () => {
        const rs = OR.group.state.riders;
        OR.sheet('<h2>Send to</h2><div class="list">' + '<button class="li pick" data-to="">' + ic('group') + '<b>Everyone in the group</b></button>' +
          rs.map(r => '<button class="li pick" data-to="' + r.id + '"><span class="rdot" style="--c:' + esc(r.c) + '"></span><b>' + esc(r.n) + '</b><small>private</small></button>').join('') + '</div>' +
          '<p class="small muted">Private messages only show on that rider\'s phone. They are encrypted with the group code like everything else, so treat them as private from strangers rather than secret from the group.</p>', b => {
          $$('[data-to]', b).forEach(x => x.onclick = () => { to = x.dataset.to; OR.closeSheet(); toChip(); $('#chatIn', box).focus(); });
        });
      };
    }
    box.hidden = false; document.body.classList.add('chatting');
    drawPresets(); setPresets(OR.chatCfg().showPresets);
    draw(true);
  };
  // the ready-made messages: big buttons, easy with gloves. "Need help" also sends your position.
  let presetsOpen = true;
  function drawPresets() {
    const el = $('#chatPresets', box), list = OR.chatCfg().presets;
    el.innerHTML = list.map((t, i) => '<button data-p="' + i + '">' + esc(t) + '</button>').join('') + '<button data-p="help" class="sos">Need help</button>';
    $$('button', el).forEach(b => b.onclick = () => {
      if (b.dataset.p === 'help') { if (!confirm('Tell the group you need help? They\'ll get your position.')) return; OR.group.say('help'); }
      else OR.group.chatSend(list[+b.dataset.p], to, false);
      b.classList.add('sent'); setTimeout(() => b.classList.remove('sent'), 700);
      setTimeout(() => draw(true), 450);
    });
  }
  function setPresets(open) { presetsOpen = open; $('#chatPresets', box).hidden = !open; $('#chatPre', box).textContent = 'Quick messages ' + (open ? '▾' : '▴'); }
  OR.chatPresetsChanged = () => { if (box) drawPresets(); };
  OR.closeChat = () => { if (box) box.hidden = true; document.body.classList.remove('chatting'); };
  OR.chatTo = id => { to = id || ''; OR.openChat(); };

  // keep the chat, the chat button and its unread badge up to date
  OR.on('group', st => {
    const cb = $('#chatBtn');
    if (cb) { cb.hidden = !st.on; cb.dataset.n = st.unread || ''; cb.classList.toggle('has', !!st.unread); if (!cb.onclick) { cb.innerHTML = ic('chat') + '<span>Chat</span>'; cb.onclick = OR.openChat; } }
    const hc = $('#hChat');
    if (hc) { hc.hidden = !st.on; hc.dataset.n = st.unread || ''; hc.classList.toggle('has', !!st.unread); if (!hc.onclick) { hc.innerHTML = ic('chat'); hc.onclick = OR.openChat; } }
    if (box && !box.hidden) draw();
    if (!st.on && box) OR.closeChat();
  });
  OR.on('chat', add => {
    if (box && !box.hidden) return;
    const m = add.filter(x => !x.mine).slice(-1)[0];
    if (m && Date.now() - m.t < 10 * 60000) OR.toast(m.n + ': ' + (m.x || 'shared their location'), 6000);
  });
})(window.OR);
