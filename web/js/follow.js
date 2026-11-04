/* OpenRoad "let someone follow me": makes a private link that opens a live map of your ride in anyone's browser, no
   app needed. It works as a group of one on a new code: the code is in the link after the # (so it never reaches a
   web server), and your position is encrypted with a key made from it, as for group rides. Switch it off and the
   link stops working (your last position is removed from the relay servers). */
'use strict';
(function (OR) {
  const PAGE = 'https://guestymark-spr.github.io/OpenRoad/follow.html#';
  const N = () => OR.native;
  OR.followActive = () => !!(OR.cfg.follow && OR.cfg.follow.code && OR.group && OR.group.state.on && OR.group.pretty(OR.cfg.group && OR.cfg.group.code) === OR.cfg.follow.code);
  const link = () => PAGE + OR.cfg.follow.code.replace(/-/g, '');

  OR.followSheet = function () {
    if (!(N() && N().groupNewCode)) { OR.toast('Live following needs the OpenRoad Android app', 5000); return; }
    const on = OR.followActive();
    if (!on && OR.group.state.on) { OR.sheet('<h2>' + OR.ic('near') + 'Let someone follow me</h2><p>You are already in a group ride, and a live link would replace it. Leave the group first (Group tab), then come back here.</p>'); return; }
    OR.sheet('<h2>' + OR.ic('near') + 'Let someone follow me</h2>' + (on ?
      '<p><b>Live link is on.</b> Anyone with the link sees where you are, your speed and your battery on a map, as long as OpenRoad stays open or recording.</p>' +
      '<div class="bigbtns"><button class="btn go" id="flSend">' + OR.ic('send') + 'Send the link again</button><button class="btn wide" id="flOff">Stop sharing</button></div>' :
      '<p>Makes a link you can send to family or a friend. They open it in any browser and watch your ride live. No app or account for them.</p>' +
      '<ul class="small"><li>Anyone who has the link can watch, so only send it to people you trust.</li><li>Your position is encrypted; the link holds the key.</li><li>It stops when you tap Stop sharing, and your last position is cleared.</li></ul>' +
      '<div class="bigbtns"><button class="btn go" id="flOn">' + OR.ic('send') + 'Start sharing and send the link</button></div>'), b => {
      const send = () => OR.share('Follow my ride live (no app needed): ' + link(), 'Follow my ride');
      const o = b.querySelector('#flOn'); if (o) o.onclick = () => {
        const code = OR.group.pretty(N().groupNewCode()); OR.cfg.follow = { code }; OR.saveCfg(); OR.group.start(code);
        OR.closeSheet(); OR.toast('Live link is on', 3000); setTimeout(send, 600);
      };
      const s = b.querySelector('#flSend'); if (s) s.onclick = () => { OR.closeSheet(); send(); };
      const f = b.querySelector('#flOff'); if (f) f.onclick = () => { OR.group.leave(); OR.cfg.follow = null; OR.saveCfg(); OR.closeSheet(); OR.toast('Sharing stopped. The link no longer shows you.', 4000); };
    });
  };
})(window.OR);
