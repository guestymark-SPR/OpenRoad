/* Fault Finder: a step-by-step fault finder for the bike.
   It is a guided checker that works offline (no AI service, no key). Every line is tagged:
   "Manual p.N" = taken from Harley-Davidson's 2025 Softail Owner's Manual (part 94001246EN, covers the Low Rider S),
   "General" = ordinary safe-riding advice that is not from the manual. */
(function () {
  const OR = window.OR, ic = OR.ic, esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MANUAL = 'https://serviceinfo.harley-davidson.com/sip/service/document-pdf-print/2021336259108401639/371977/94001246_1889990_en_US.xml';
  const m = (p, t) => ({ t, s: /^[\d,\- ]+$/.test(String(p)) ? 'Manual p.' + p : 'Manual, ' + p }), g = t => ({ t, s: 'General' });
  const STOP = 'stop', CARE = 'careful', CHK = 'check';
  const R = (level, title, items, more) => ({ r: 1, level, title, items, more });
  const Q = (q, yes, no, hint) => ({ q, yes, no, hint });


  // ---- warning lamps (Operation > Indicators, pp. 77-103) ----
  const LAMPS = [
    ['oil', 'Oil pressure', R(STOP, 'Oil pressure lamp: stop the engine', [
      m(80, 'It comes on with the ignition and goes out once the engine starts. If it is on while the engine is running, oil is not circulating.'),
      g('Pull over as soon as it is safe and switch the engine off. Do not keep riding to find a better place.'),
      m(80, 'Check the oil and add some if it is low. If the oil level is normal and the lamp stays on, stop the engine immediately and see a dealer.'),
      m('183-186', 'Causes listed: low or diluted oil, ice or sludge in cold weather, a faulty oil signal switch, check valve or oil pump.'),
      g('Do not restart it to "see if it has gone". Arrange recovery.')])],
    ['check', 'Check engine', R(CARE, 'Check engine lamp', [
      m('77-103', 'It normally comes on when you switch on, while self-diagnosis runs, and goes out after the engine starts.'),
      m('77-103', 'If it stays on after starting, or comes on at other times, see a Harley-Davidson dealer.'),
      g('If the bike still runs smoothly, ride gently to a dealer. If it is running badly, losing power, or there is smoke or a fuel smell, stop and get it recovered.')])],
    ['fault', 'Fault alert', R(CARE, 'Fault alert lamp', [
      m(92, 'The fault alert lights when the bike detects a fault. The manual does not say which fault, or what to do beyond that.'),
      g('Note what the dash says, check it is riding normally, and get it looked at by a dealer soon. If it is not riding normally, stop.')])],
    ['fuel', 'Low fuel', R(CHK, 'Low fuel lamp', [
      m('77-103', 'A solid lamp means the fuel is near the low level (see Specifications).'),
      m(35, 'Low Rider S: the lamp comes on at about 3.8 L (1.0 gal) remaining, and the tank holds 18.9 L (5.0 gal).'),
      m('77-103', 'If it flashes continuously, or stays on after you have refuelled, see a dealer.'),
      g('Use the Fuel card on the Bike tab for your real range.')])],
    ['batt', 'Battery / charging', R(CARE, 'Battery discharge lamp', [
      m('77-103', 'It indicates overcharging or undercharging of the battery. The manual refers you to Battery Maintenance (p.162).'),
      m('183-186', 'Causes listed for an alternator that does not charge: regulator or engine-ground problems, or damaged charging wiring. Weak battery, heavy accessory use or loose, corroded connections can give a low charge rate.'),
      g('The bike can eventually stop when the battery runs flat. Switch off anything you can do without (extra lights, charger, heated gear) and ride only as far as you need to, to somewhere safe.')])],
    ['shed', 'Load shedding (amber)', R(CARE, 'Load shedding indicator', [
      m('77-103', 'It is on when accessory power has been shut off because the battery voltage is low. See Battery Maintenance (p.162).'),
      g('Treat it like a charging problem: reduce electrical load and get it checked.')])],
    ['sec', 'Security', R(CHK, 'Security lamp', [
      m('77-103', 'Flashing means the system is armed (normal when parked). Solid while armed means the alarm has been activated.'),
      m(69, 'Solid while disarmed, or on while riding: see a Harley-Davidson dealer.'),
      g('If the bike says NO FOB or FOB LOW BATT, use "Won\'t start" in Fault Finder.')])],
    ['abs', 'ABS', R(CARE, 'ABS lamp', [
      m('78-79', 'It flashes at start-up while the system checks itself, until you pass about 5 km/h (3 mph). That is normal.'),
      m('78-79', 'A solid lamp means an ABS malfunction. The ABS is disabled, the normal brakes still work, but the wheels can lock under hard braking.'),
      g('Ride gently, leave extra braking distance, and see a dealer.'),
      m('ABS section', 'ABS needs Harley-Davidson tyres and wheels, and tyre pressures other than those in the Specifications can reduce ABS braking performance.')])],
    ['bf', 'Brake fluid service', R(CARE, 'Brake fluid service indicator', [
      m('77-103', 'It is on when an ABS bleed procedure is required. See a dealer.'),
      g('Check the brakes feel normal before you ride on. If the lever or pedal is soft, do not ride.')])],
    ['tc', 'Traction control', R(CHK, 'Traction control lamp', [
      m(79, 'Solid: traction control has been turned off. Slow flashing: start-up self-check. Rapid flashing: it is working (intervening). Off: the system is on.'),
      m(103, 'Solid together with the security/fault lamp means a fault: traction control is disabled, so see a dealer.')])],
    ['tpms', 'Low tyre pressure', R(CHK, 'Low tyre pressure (TPMS) lamp', [
      m(101, 'The bike shows front and rear pressures and an indicator when one is low. Check the tyre pressures.'),
      m('31, 47-48', 'Low Rider S, cold tyres at 20°C (68°F) or less: front 221 kPa (32 psi), rear 276 kPa (40 psi).'),
      g('If a tyre is visibly flat, or the bike feels vague or wobbly, stop. See "Flat or low tyre".')])],
    ['ts', 'Turn signal flashing fast', R(CHK, 'Turn signal flashing rapidly', [
      m(78, 'Rapid flashing means a bulb has failed. Use hand signals and replace the component at the earliest opportunity.')])]
  ];

  // ---- the question trees ----
  const wontStart = Q('Do the dash and lamps light up when you turn the switch to RUN?',
    Q('Does the display say NO FOB or FOB LOW BATT, or is the security lamp on solid?',
      R(CHK, 'Fob or security problem', [
        m(69, 'A discharged fob battery: disarm with the PIN and replace the battery. A damaged fob: disarm with the PIN, and a dealer sells replacements.'),
        m(60, 'The fob uses a Panasonic CR2032 (or equivalent), positive side up. Open it by turning a thin blade in the slot. The manual says to replace it every year.'),
        m(69, 'Warnings or alarms with the fob present can be radio interference. Keep the fob out of metal enclosures and 76 mm (3 in) from other electronics. Put it on the seat with the switch at RUN, then move the bike at least 5 m (15 ft) from that spot.'),
        m('64-70', 'With a PIN you enter the five digits on the odometer using the left turn switch to change a digit and the right turn switch to store it. Follow the manual\'s Security System chapter for the exact steps.'),
        m(69, 'Security lamp solid while the bike is disarmed: see a dealer.')]),
      Q('When you press the start switch, does the engine turn over (crank)?',
        R(CHK, 'Cranks but will not fire', [
          m('183-186', 'The manual lists: empty fuel tank, clogged fuel filter, battery and terminal problems, fouled spark plugs, loose plug cables or coil connections, fuel pump, blown fuse.'),
          m(86, 'The starter runs for 10 seconds and stops. Press again to retry. After several failed attempts, see a dealer.'),
          m(94, 'Do not open the throttle before starting. The fuel pump may run briefly to prime when you switch on.'),
          g('Check the fuel first: the low fuel lamp only warns at about 3.8 L left, so a stuck gauge or a long idle can still leave you empty.'),
          g('Do not keep cranking. Repeated attempts flatten the battery and can flood the engine.')]),
        Q('Have you checked the start routine below?',
          R(CHK, 'Starter does not turn the engine', [
            m(94, 'Start routine: fob in range, switch to RUN, make sure it is in neutral (green lamp on, and roll the bike back and forth with the clutch lever released), squeeze the clutch lever to the grip, then press start.'),
            m('183-186', 'The manual lists: switch position, discharged or corroded battery connections, clutch lever or neutral position, jiffy stand position, blown fuse.'),
            m(95, 'If the bike has fallen over, it will not start until the tip condition is reset: stand it upright, switch OFF, wait 45 seconds, switch to RUN, then press the hazard switch to stop the flashers.'),
            g('If it only clicks or the dash dims when you press start, the battery is probably flat or a terminal is loose. Do not jump-start it unless you have checked how in your manual: I have not verified a jump-start procedure for this bike.')]),
          R(CHK, 'Do the start routine first', [m(94, 'Fob in range, switch to RUN, neutral (green lamp, and roll the bike back and forth with the clutch lever released), clutch lever squeezed in, then press start.'), g('Then answer again.')]))
      )),
    R(CHK, 'No power at all', [
      m('183-186', 'The manual lists a discharged battery, loose or corroded battery connections, switch position and a blown fuse.'),
      g('If the dash is completely dead, the battery is flat or disconnected. A roadside battery check or jump from your breakdown cover is the safest route.'),
      g('I have not verified where the fuses and battery are on this bike from the manual, so use the manual\'s Service Procedures section or a dealer.')]));

  const stalls = Q('Did a warning lamp come on (oil pressure, battery, fault or check engine) before it cut out?',
    R(STOP, 'Do not restart yet', [
      g('Pull in safely. Look at which lamp it was and use "A warning light" in Fault Finder.'),
      m(80, 'Oil pressure lamp on while running: stop the engine immediately.'),
      g('If it was the oil lamp, do not restart. Arrange recovery.')]),
    R(CARE, 'Engine cut out', [
      m(97, 'If the engine stalls or stops for any reason, turn the switch to OFF to prevent the battery discharging.'),
      m(35, 'Check you have fuel: on the Low Rider S the low fuel lamp comes on at about 3.8 L (1.0 gal) left.'),
      m(94, 'Then restart using the normal routine. If it restarts and runs normally, it still needs checking, so ride gently and avoid busy roads.'),
      g('If it cuts out again, or runs badly, stop riding and call for recovery.')]));

  const rough = Q('Is there smoke, a fuel smell, a burning smell or liquid dripping?',
    R(STOP, 'Stop and get away from the bike', [
      g('Stop safely, switch off, put the side stand down on firm ground and move away. Fuel or oil on hot parts is a fire risk.'),
      g('Do not restart it. If there is a fire or anyone is hurt, call 999 (112 also works in the UK and abroad).')]),
    R(CARE, 'Runs rough, misfires or lacks power', [
      m('183-186', 'The manual lists: spark plugs, cables or plug gap, weak battery, wiring damage or shorts, water or dirt in the fuel, plugged fuel vent, fouled injectors.'),
      m('183-186', 'Starts hard: also heavy oil in cold weather, or a plugged fuel vent or line.'),
      g('Did it start after you filled up at a different station, or after heavy rain? Water or dirt in the fuel is on the manual\'s list, so avoid using that fuel again.'),
      g('If it gets worse, shakes, or loses power in traffic, stop and get recovery.')]));

  const hot = Q('Is there smoke, steam, a burning smell or leaking oil?',
    R(STOP, 'Stop now', [
      g('Stop safely, switch off and move away. Do not open anything hot.'),
      m('183-186', 'The manual lists these causes of overheating: not enough oil or oil not circulating, heavy carbon from lugging the engine, not enough airflow from long idling.'),
      g('Do not restart it. Arrange recovery.')]),
    R(CARE, 'Running hot', [
      m('183-186', 'Causes the manual lists: not enough oil or oil not circulating, heavy carbon from lugging the engine, not enough airflow during long idling.'),
      g('Stop somewhere safe and let the engine cool. Do not idle in queues longer than you have to.'),
      g('Check the oil level (see the manual). If the oil lamp came on, use "A warning light".'),
      g('If it overheats again, stop riding.')]));

  const brakes = Q('Does the lever or pedal feel soft, go to the grip, or is there much less stopping power?',
    R(STOP, 'Do not ride on', [
      m(186, 'The manual lists: low brake fluid, air in the lines, worn master cylinder or caliper piston, contaminated or worn pads, worn or warped disc, heat fade, dragging pads, too little lever free play.'),
      g('Soft or weak brakes mean you cannot stop reliably. Stop riding and arrange recovery.'),
      g('If the brakes only faded after a long hard descent, let them cool fully. If they do not recover, do not ride.')]),
    R(CARE, 'Brakes feel different', [
      m(186, 'The manual lists: low fluid, air in lines, worn pads or disc, contaminated pads, dragging pads. A dealer should check it.'),
      g('If the ABS lamp is on, use "A warning light", then ABS.'),
      g('Test gently at low speed on a quiet road before riding on. If in any doubt, do not ride.')]));

  const tyre = Q('Is the tyre visibly flat, or does the bike feel vague, wobbly or drag to one side?',
    R(STOP, 'Stop riding', [
      g('Slow down gradually, avoid hard braking and sudden steering, and stop somewhere safe.'),
      m(8, 'The manual says not to tow a disabled motorcycle.'),
      g('Ask your breakdown service for a recovery vehicle that carries the bike.'),
      m('8, 52', 'If a tyre is repaired: do not exceed 80 km/h (50 mph) for the first 24 hours, and never use a repaired tyre above 129 km/h (80 mph). Small tread punctures can be repaired from inside the removed tyre by a dealer.'),
      m(8, 'The manual says do not use liquid tyre balancers or sealants in aluminium wheels.')]),
    R(CHK, 'Low tyre pressure', [
      m('31, 47-48', 'Low Rider S, cold tyres at 20°C (68°F) or less: front 221 kPa (32 psi), rear 276 kPa (40 psi).'),
      m(5, 'After hitting a kerb or pothole, have the tyre inspected inside and out by a dealer straight away.'),
      m('ABS section', 'ABS needs correct pressures: other pressures can reduce ABS braking performance.'),
      g('Check pressure cold, with a gauge you trust. If a tyre keeps losing air, do not ride.')]));

  const gearbox = Q('Does the clutch slip (revs rise but the bike does not pull)?',
    R(CARE, 'Clutch slipping', [
      m(185, 'Causes the manual lists: improper clutch adjustment, worn friction discs, not enough spring tension.'),
      g('Ride gently without hard acceleration to a dealer. If it will not pull at all, stop.')]),
    Q('Does the clutch drag, fail to release, or chatter?',
      R(CARE, 'Clutch drags, will not release or chatters', [
        m(185, 'Drags or will not release: improper adjustment, primary chaincase overfilled, warped clutch discs. Chatters: worn or warped discs.'),
        g('A bike that will not release the clutch can lurch when put in gear. Take care at stops and get it checked.')]),
      R(CARE, 'Hard to shift or jumps out of gear', [
        m(185, 'Shifts hard: bent shifter rod. Jumps out of gear: worn shifter dogs.'),
        g('A bike jumping out of gear while riding is a hazard. Get it checked before riding further.')])));

  const vibration = Q('Did it start suddenly, or is it severe?',
    R(STOP, 'Stop and check', [
      g('Stop safely. Look for a loose, damaged or leaking part, a tyre problem, or something wrapped around the wheel.'),
      m('183-186', 'Causes listed for excessive vibration: loose rear fork pivot shaft or engine mounting bolts, a tight or poorly lubricated chain or a worn belt, frame, wheel or tyre damage, misalignment.'),
      g('If you cannot find an obvious cause, do not ride on.')]),
    R(CARE, 'Vibration or noise', [
      m('183-186', 'Causes listed for excessive vibration: loose rear fork pivot shaft or engine mounting bolts, a tight or poorly lubricated chain or a worn belt, frame, wheel or tyre damage, misalignment.'),
      g('Check the tyres and wheels first. Get it looked at by a dealer soon.')]));

  const electrics = R(CARE, 'Lights or electrics failing', [
    m('183-186', 'For a battery that is not charging, the manual lists regulator or engine-ground problems, or damaged charging wiring. For a low charge rate: weak battery, heavy accessory use, loose or corroded connections, or a lot of idling and slow riding.'),
    g('Check whether the battery discharge or load shedding lamp is on (see "A warning light").'),
    g('If the headlight or brake light fails, do not ride after dark or in traffic.'),
    g('I have not verified where the fuses are on this bike from the manual, so use the Service Procedures section or a dealer.')]);

  const fell = R(CHK, 'After a fall or tip-over', [
    g('Check yourself first. If you are hurt, call 999 (112 also works in the UK and abroad).'),
    m(95, 'The engine will not start until the tip condition is reset: stand the bike upright, switch OFF, wait 45 seconds, switch to RUN, then press the hazard switch to stop the flashers.'),
    g('Before riding, look for fuel or oil leaks, bent levers or footrests, damaged tyres or wheels, and check the brakes work properly at walking speed.'),
    m(5, 'If a tyre struck something hard, have it inspected inside and out by a dealer straight away.'),
    g('If anything is bent, leaking, or does not feel right, do not ride. Arrange recovery.')]);

  const SYMS = [
    ['start', 'Won\'t start', 'moto', wontStart],
    ['stall', 'Cuts out while riding', 'warn', stalls],
    ['lamp', 'A warning light', 'warn', { menu: 'lamp' }],
    ['rough', 'Runs rough or loses power', 'gear', rough],
    ['hot', 'Overheating or burning smell', 'fuel', hot],
    ['brake', 'Brakes feel wrong', 'noentry', brakes],
    ['tyre', 'Flat or low tyre', 'gear', tyre],
    ['gear', 'Clutch or gears', 'gear', gearbox],
    ['vib', 'Vibration or a noise', 'gear', vibration],
    ['elec', 'Lights or electrics', 'warn', electrics],
    ['fell', 'Bike fell over', 'moto', fell]
  ];

  const LV = { stop: ['Stop riding', 'var(--red,#e53935)'], careful: ['Ride gently, then get it checked', '#ef8f00'], check: ['Try these checks', '#00897b'] };

  OR.mechanicSheet = function () {
    const hd = OR.cfg.bike && OR.cfg.bike.profile === 'hd-fxlrs-2025';
    const hist = [];
    const tel = () => { try { return (((OR.store.get('papers', {}) || {}).breakdown || {}).tel || '').replace(/\s/g, ''); } catch (e) { return ''; } };
    OR.sheet('<div id="mech"></div>', b => {
      const root = b.querySelector('#mech');
      const bar = (back) => '<div class="mhead">' + (back ? '<button class="mback" id="mBack" aria-label="Back">' + ic('chev') + '</button>' : '') + '<h2>' + ic('wrench') + 'Fault Finder</h2></div>';
      function menu() {
        root.innerHTML = bar(false) + '<p class="small muted">What is the bike doing? Answer a few questions and it will tell you whether to stop, or how to get going. It works offline.</p>' +
          (hd ? '' : '<p class="small warnbox">This guide is based on the Harley-Davidson Softail manual. Other bikes can differ, so check your own manual for the bike-specific details.</p>') +
          '<div class="menu mechmenu">' + SYMS.map(s => '<button data-s="' + s[0] + '">' + OR.badge(s[2], '#ef6c00') + '<span><b>' + esc(s[1]) + '</b></span>' + ic('chev', 'chev') + '</button>').join('') + '</div>' +
          '<div class="mnote small muted">If anyone is hurt or you are in danger, call 999 (112 also works in the UK and abroad).</div>' + foot();
        root.querySelectorAll('[data-s]').forEach(x => x.onclick = () => { hist.length = 0; go(SYMS.find(s => s[0] === x.dataset.s)[3]); });
      }
      function lampMenu() {
        root.innerHTML = bar(true) + '<h3>Which light?</h3><div class="menu mechmenu">' + LAMPS.map(l => '<button data-l="' + l[0] + '"><span><b>' + esc(l[1]) + '</b></span>' + ic('chev', 'chev') + '</button>').join('') + '</div>' + foot();
        root.querySelector('#mBack').onclick = back;
        root.querySelectorAll('[data-l]').forEach(x => x.onclick = () => go(LAMPS.find(l => l[0] === x.dataset.l)[2]));
      }
      function foot() {
        return '<p class="small muted mfoot">Based on Harley-Davidson\'s <a href="' + MANUAL + '" target="_blank" rel="noopener">2025 Softail Owner\'s Manual</a> (covers the Low Rider S). Each line says whether it is from the manual (with the page) or general advice. It does not replace a mechanic.</p>';
      }
      function go(node) { hist.push(node); draw(); }
      function back() { hist.pop(); hist.length ? draw() : menu(); }
      function draw() {
        const n = hist[hist.length - 1];
        if (n.menu === 'lamp') return lampMenu();
        if (n.q) {
          root.innerHTML = bar(true) + '<h3 class="mq">' + esc(n.q) + '</h3><div class="mbtns"><button class="btn pri" id="mY">Yes</button><button class="btn" id="mN">No</button></div>' + foot();
          root.querySelector('#mBack').onclick = back; root.querySelector('#mY').onclick = () => go(n.yes); root.querySelector('#mN').onclick = () => go(n.no);
          return;
        }
        const lv = LV[n.level];
        const t = tel();
        const help = '<div class="mact">' +
          (t ? '<a class="btn wide go" href="tel:' + esc(t) + '">' + ic('helmet') + 'Call breakdown cover</a>' : '<button class="btn wide ghost" id="mPap">' + ic('id') + 'Add your breakdown number</button>') +
          '<button class="btn wide ghost" id="mLoc">' + ic('near') + 'Send my location</button>' +
          (OR.group && OR.group.state && OR.group.state.on ? '<button class="btn wide ghost" id="mGrp">' + ic('group') + 'Tell my group I need help</button>' : '') + '</div>';
        root.innerHTML = bar(true) + '<div class="mres" style="--c:' + lv[1] + '"><span class="mlv">' + esc(lv[0]) + '</span><h3>' + esc(n.title) + '</h3></div><ul class="mlist">' +
          n.items.map(i => '<li>' + esc(i.t) + '<small class="' + (i.s === 'General' ? 'gen' : 'man') + '">' + esc(i.s) + '</small></li>').join('') + '</ul>' + help +
          '<button class="btn wide ghost" id="mAgain">Start again</button>' + foot();
        root.querySelector('#mBack').onclick = back; root.querySelector('#mAgain').onclick = () => { hist.length = 0; menu(); };
        const L = root.querySelector('#mLoc'); if (L) L.onclick = () => {
          const p = OR.pos; if (!p) return OR.toast('No GPS fix yet');
          const ll = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
          OR.share('I have a problem with the bike. My location: https://maps.google.com/?q=' + ll, 'My location');
        };
        const G = root.querySelector('#mGrp'); if (G) G.onclick = () => OR.confirm('Tell the group you need help? They\'ll get your position.', () => OR.group.say('help'), { ok: 'Send help request', danger: true });
        const P = root.querySelector('#mPap'); if (P) P.onclick = () => { OR.closeSheet(); OR.openMore('papers'); };
      }
      menu();
    });
  };
})();
