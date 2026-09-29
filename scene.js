// Scroll reveals and card tilt: small, and independent of WebGL.
(() => {
  const root = document.documentElement, reduce = matchMedia('(prefers-reduced-motion: reduce)');
  root.classList.add('js');
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.querySelectorAll('.app').forEach(c => {
    c.addEventListener('pointermove', e => {
      if (reduce.matches) return;
      const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      c.classList.add('tilting');
      c.style.setProperty('--rx', (0.5 - y) * 5 + 'deg'); c.style.setProperty('--ry', (x - 0.5) * 7 + 'deg');
    });
    c.addEventListener('pointerleave', () => { c.classList.remove('tilting'); c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); });
  });
})();

// Particle hero: thousands of points assemble into an extruded "EverydayOpen", then on scroll most of them
// fly into two orbs (one per app, in its brand color) that dock above the project cards.
// Everything moves in the vertex shader; the CPU only updates a few uniforms per frame.
(() => {
  const canvas = document.getElementById('scene');
  const gl = canvas && canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) return;

  const VS = `
precision highp float;
attribute vec3 aStart, aWord, aOrb, aCol;
attribute vec4 aSeed;
uniform float uT, uIntro, uMorph, uScale, uF, uD, uAsp, uPx, uScroll, uPush, uOrbR, uLight, uMaxPt;
uniform vec2 uRot, uCam, uMouse, uHalf;
uniform vec3 uWord, uO0, uO1, uInk, uOpA, uOpB, uG0, uG1;
varying vec4 vC;
varying float vS;
vec3 ry(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c*p.x + s*p.z, p.y, c*p.z - s*p.x); }
vec3 rx(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c*p.y - s*p.z, s*p.y + c*p.z); }
void main() {
  float r = aSeed.x, g = aSeed.z, halo = step(4.0, aSeed.w), amb = step(1.5, aCol.x);
  vec3 tg;
  if (g < 1.5) {
    vec3 o = rx(ry(aOrb, uT*(0.3 + 0.25*aSeed.y) + r*6.283), 0.42);
    tg = (g < 0.5 ? uO0 : uO1) + o*uOrbR;
  } else {
    tg = vec3(aOrb.xy*uHalf*1.3, aOrb.z);
    tg.xy += 0.25*vec2(sin(uT*0.11 + r*40.0), cos(uT*0.09 + aSeed.y*40.0));
    tg.y += uScroll*(0.12 + 0.03*(aOrb.z + 7.0));
  }
  float ti = smoothstep(0.0, 1.0, clamp(uIntro*1.7 - r*0.7, 0.0, 1.0));
  vec3 w = rx(ry(aWord, uRot.x), uRot.y)*uScale + uWord;
  w += uScale*0.005*vec3(sin(uT*1.3 + r*60.0), cos(uT*1.1 + aSeed.y*60.0), 0.0);
  w = mix(w, tg, amb);
  vec3 p = mix(ry(aStart, (1.0 - ti)*2.4), w, ti);
  float mi = smoothstep(0.0, 1.0, clamp(uMorph*1.6 - aSeed.y*0.6, 0.0, 1.0));
  vec3 q = mix(p, tg, mi) + sin(mi*3.1416)*vec3(sin(r*91.0)*0.6, cos(r*57.0)*0.6, (r - 0.3)*2.5);
  q.xy -= uCam*q.z/uD;
  float wz = uD - q.z;
  vec2 n = vec2(q.x*uF/uAsp, q.y*uF)/wz;
  vec2 d = (n - uMouse)*vec2(uAsp, 1.0);
  float l = length(d) + 1e-4;
  n += d/l*vec2(1.0/uAsp, 1.0)*uPush*0.08*exp(-l*l*16.0);
  gl_Position = vec4(n, 0.0, 1.0);
  float coc = abs(q.z);
  gl_PointSize = min(aSeed.w*uPx*uD/wz*(1.0 + coc*0.45), uMaxPt);
  vec3 dust = mix(uInk, uOpA, 0.35*uLight);
  vec3 wc = amb > 0.5 ? dust : aCol.x > 0.5 ? mix(uOpA, uOpB, aCol.y)*mix(1.35, 1.0, uLight) : uInk;
  vec3 oc = g < 0.5 ? uG0 : (g < 1.5 ? uG1 : dust);
  float wordA = uLight > 0.5 ? 0.85 : 0.62, dustA = uLight > 0.5 ? 0.09 : 0.26;
  float a0 = mix(wordA, dustA, amb), a1 = g > 1.5 ? dustA : wordA;
  float a = mix(a0, a1, mi)*mix(0.25, 1.0, ti)/(1.0 + coc*coc*0.35);
  vC = vec4(mix(wc*aCol.z, oc, mi), mix(a, (uLight > 0.5 ? 0.05 : 0.08)*mi, halo));
  vS = clamp(coc*0.25, 0.0, 0.6);
}`;
  const FS = `
precision mediump float;
varying vec4 vC;
varying float vS;
void main() {
  float a = (1.0 - smoothstep(vS, 1.0, length(gl_PointCoord*2.0 - 1.0)))*vC.a;
  gl_FragColor = vec4(vC.rgb*a, a);
}`;

  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  const U = {};
  for (let i = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i--;) {
    const name = gl.getActiveUniform(prog, i).name;
    U[name] = gl.getUniformLocation(prog, name);
  }

  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  root.classList.add('gl');
  if (reduce) root.classList.add('rm');

  const FONT = getComputedStyle(document.body).fontFamily;
  const D = 8, F = 1 / Math.tan(18 * Math.PI / 180); // camera distance, 36deg vertical fov
  const rnd = (a, b) => a + Math.random() * (b - a);
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

  // Rasterize the wordmark and keep the lit pixels as candidate points (x, y, edge, kind, t).
  function sampleWord(twoLines) {
    const W = 1400, H = twoLines ? 820 : 380, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    const set = fs => { x.font = `700 ${fs}px ${FONT}`; x.letterSpacing = `${-0.015 * fs}px`; };
    set(100);
    const eW = x.measureText('Everyday').width, oW = x.measureText('Open').width;
    const fs = twoLines ? Math.min(100 * W * 0.9 / Math.max(eW, oW), H * 0.42) : Math.min(100 * W * 0.9 / (eW + oW), H * 0.7);
    set(fs);
    const e = x.measureText('Everyday').width, o = x.measureText('Open').width;
    x.textBaseline = 'middle';
    let ox, oy;
    if (twoLines) {
      x.fillStyle = '#f00'; x.fillText('Everyday', (W - e) / 2, H * 0.3);
      ox = (W - o) / 2; oy = H * 0.74;
    } else {
      x.fillStyle = '#f00'; x.fillText('Everyday', (W - e - o) / 2, H / 2);
      ox = (W - e - o) / 2 + e; oy = H / 2;
    }
    x.fillStyle = '#0f0'; x.fillText('Open', ox, oy);
    const px = x.getImageData(0, 0, W, H).data, s = 3, on = (i, j) => i >= 0 && j >= 0 && i < W && j < H && px[(j * W + i) * 4 + 3] > 127;
    const pts = [];
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (let j = 0; j < H; j += s) for (let i = 0; i < W; i += s) {
      if (!on(i, j)) continue;
      const k = (j * W + i) * 4, open = px[k + 1] > px[k];
      const edge = !(on(i - s, j) && on(i + s, j) && on(i, j - s) && on(i, j + s));
      pts.push([i, j, edge, open, (i - ox) / o]);
      x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j);
    }
    const half = (x1 - x0) / 2, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const p of pts) { p[0] = (p[0] - cx) / half; p[1] = (cy - p[1]) / half; }
    return { pts, edges: pts.filter(p => p[2]), w: 2, h: (y1 - y0) / half };
  }

  const buf = gl.createBuffer();
  let count = 0, word = null, layout = '';
  function build(twoLines, n) {
    word = sampleWord(twoLines);
    count = n;
    const a = new Float32Array(n * 16), depth = 0.035;
    for (let i = 0; i < n; i++) {
      const o = i * 16, r = Math.random(), group = r < 0.3 ? 0 : r < 0.6 ? 1 : 2;
      // start: a wide shell behind the camera target, so the intro reads as a swirl converging
      const th = rnd(0, 6.283), ph = Math.acos(rnd(-1, 1)), rad = rnd(5, 10);
      a[o] = rad * Math.sin(ph) * Math.cos(th); a[o + 1] = rad * Math.cos(ph) * 0.6; a[o + 2] = rad * Math.sin(ph) * Math.sin(th) - 3;
      // word: faces at +-depth, edge pixels spread through the depth so the letters read as extruded
      const p = Math.random() < 0.25 ? word.edges[i % word.edges.length] : word.pts[(Math.random() * word.pts.length) | 0];
      a[o + 3] = p[0] + rnd(-0.003, 0.003); a[o + 4] = p[1] + rnd(-0.003, 0.003);
      const face = p[2] ? 0 : Math.random() < 0.55 ? 1 : -1; // front, back, or a side wall
      a[o + 5] = face ? face * depth : rnd(-depth, depth);
      if (group < 2) {
        // orb: mostly a shell with a soft core, plus a tilted ring
        if (Math.random() < 0.72) {
          const t2 = rnd(0, 6.283), p2 = Math.acos(rnd(-1, 1)), r2 = 0.3 + 0.7 * Math.pow(Math.random(), 0.35);
          a[o + 6] = r2 * Math.sin(p2) * Math.cos(t2); a[o + 7] = r2 * Math.cos(p2); a[o + 8] = r2 * Math.sin(p2) * Math.sin(t2);
        } else {
          const t2 = rnd(0, 6.283), r2 = rnd(1.35, 1.7);
          a[o + 6] = r2 * Math.cos(t2); a[o + 7] = rnd(-0.03, 0.03); a[o + 8] = r2 * Math.sin(t2);
        }
      } else {
        a[o + 6] = rnd(-1, 1); a[o + 7] = rnd(-1, 1); a[o + 8] = rnd(-7, 2.5);
      }
      const ambient = group === 2 && Math.random() < 0.3;
      a[o + 9] = ambient ? 2 : p[3] ? 1 : 0; a[o + 10] = Math.min(1, Math.max(0, p[4])); a[o + 11] = face > 0 ? rnd(0.9, 1.15) : face < 0 ? rnd(0.45, 0.6) : rnd(0.55, 0.8); // shading sells the depth
      const halo = group < 2 && Math.random() < 0.012;
      a[o + 12] = Math.random(); a[o + 13] = Math.random(); a[o + 14] = group; a[o + 15] = halo ? rnd(9, 16) : rnd(0.6, 1.35);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW);
    [['aStart', 3], ['aWord', 3], ['aOrb', 3], ['aCol', 3], ['aSeed', 4]].reduce((off, [name, size]) => {
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 64, off);
      return off + size * 4;
    }, 0);
  }

  function theme() {
    const dark = darkMQ.matches, cards = document.querySelectorAll('.app');
    const glow = i => hex((cards[i] && cards[i].dataset[dark ? 'glow' : 'glowLight']) || (dark ? '#ffffff' : '#000000'));
    gl.uniform1f(U.uLight, dark ? 0 : 1);
    gl.uniform3fv(U.uInk, dark ? [0.93, 0.95, 1] : [0.05, 0.06, 0.08]);
    gl.uniform3fv(U.uOpA, hex(dark ? '#7098FF' : '#2457E0'));
    gl.uniform3fv(U.uOpB, hex(dark ? '#C6F23C' : '#6F9A00'));
    gl.uniform3fv(U.uG0, glow(0));
    gl.uniform3fv(U.uG1, glow(1));
    gl.enable(gl.BLEND);
    if (dark) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  theme();

  const slot = document.querySelector('.mark-slot'), apps = document.getElementById('apps');
  const mouse = { x: 0, y: 0, sx: 0, sy: 0, on: 0, push: 0 };
  let t0 = performance.now(), last = t0, morph = 0, raf = 0, visible = true, lost = false, q = 1, slow = 0;

  function draw(now) {
    const dpr = Math.min(devicePixelRatio || 1, q < 1 ? 1 : 2), W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const s = slot.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    const two = s.width / Math.max(s.height, 1) < 2.4, n = W < 700 ? 7000 : 14000, key = two + ':' + n;
    if (key !== layout) { layout = key; build(two, n); }
    const halfH = D / F, wpp = 2 * halfH / H; // world units per CSS pixel at z = 0
    const toWorld = (x, y) => [(x - c.left - W / 2) * wpp, (H / 2 - (y - c.top)) * wpp, 0];
    const dt = Math.min((now - last) / 1000, 0.05), t = (now - t0) / 1000, k = 1 - Math.exp(-dt * 4);
    last = now;

    const intro = reduce ? 1 : Math.min(t / 2.8, 1), ease = 1 - Math.pow(1 - intro, 3);
    const top = apps ? apps.getBoundingClientRect().top : Infinity, target = reduce ? 0 : Math.min(Math.max((H * 0.95 - top) / (H * 0.6), 0), 1);
    morph = reduce ? 0 : morph + (target - morph) * k;
    mouse.sx += (mouse.x - mouse.sx) * k; mouse.sy += (mouse.y - mouse.sy) * k;
    mouse.push += (mouse.on - mouse.push) * k;

    const orbPx = Math.min(Math.max(W * 0.055, 44, 0), 76), cards = document.querySelectorAll('.app');
    const orb = i => {
      const r = cards[i] && cards[i].getBoundingClientRect();
      return r ? toWorld(r.left + r.width / 2, r.top - orbPx * 1.6) : [(i - 0.5) * 4, -halfH * 3, 0];
    };
    const time = reduce ? 3 : t;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U.uT, time);
    gl.uniform1f(U.uIntro, intro);
    gl.uniform1f(U.uMorph, morph);
    gl.uniform1f(U.uScale, Math.min(s.width * 0.94 / word.w, s.height * 0.86 / word.h) * wpp);
    gl.uniform1f(U.uF, F);
    gl.uniform1f(U.uD, D);
    gl.uniform1f(U.uAsp, W / H);
    gl.uniform1f(U.uPx, 2.3 * dpr * Math.min(1, Math.max(0.8, W / 1200)));
    gl.uniform1f(U.uMaxPt, 70 * dpr);
    gl.uniform1f(U.uScroll, scrollY * wpp);
    gl.uniform1f(U.uPush, reduce ? 0 : mouse.push);
    gl.uniform1f(U.uOrbR, orbPx * wpp);
    gl.uniform2f(U.uHalf, halfH * W / H, halfH);
    gl.uniform2f(U.uRot, 0.14 * Math.sin(time * 0.23) + mouse.sx * 0.28 + (1 - ease) * 0.9, 0.06 * Math.sin(time * 0.17) - mouse.sy * 0.16);
    gl.uniform2f(U.uCam, mouse.sx * 0.8, mouse.sy * 0.5);
    gl.uniform2f(U.uMouse, mouse.sx, mouse.sy);
    gl.uniform3fv(U.uWord, toWorld(s.left + s.width / 2, s.top + s.height / 2));
    gl.uniform3fv(U.uO0, orb(0));
    gl.uniform3fv(U.uO1, orb(1));
    gl.drawArrays(gl.POINTS, 0, count * q | 0); // points are in random order, so a prefix is an even thinning
  }

  const frame = now => {
    raf = 0;
    // Adaptive quality: after ~1 s of frames slower than 40 fps, drop to 1x pixels and half the points, once.
    const ft = now - last;
    if (q === 1 && ft < 100) slow = ft > 25 ? slow + 1 : Math.max(slow - 1, 0);
    if (slow > 40) q = 0.5;
    draw(now); kick();
  };
  const kick = () => { if (!raf && visible && !lost && !document.hidden && !reduce) raf = requestAnimationFrame(frame); };
  const still = () => requestAnimationFrame(draw); // reduced motion: one static frame, redrawn only when needed

  addEventListener('pointermove', e => {
    mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = 1 - e.clientY / innerHeight * 2; mouse.on = 1;
  }, { passive: true });
  const off = () => { mouse.on = 0; mouse.x = mouse.y = 0; };
  addEventListener('pointerout', e => { if (!e.relatedTarget) off(); });
  addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') off(); }); // touch: no hover to follow
  addEventListener('pointercancel', off);
  canvas.addEventListener('webglcontextlost', () => { lost = true; root.classList.remove('gl'); }); // show the CSS wordmark
  document.addEventListener('visibilitychange', () => { last = performance.now(); kick(); });
  darkMQ.addEventListener('change', () => { theme(); reduce ? still() : kick(); });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; last = performance.now(); kick(); })
    .observe(document.getElementById('stage') || canvas);
  if (reduce) { still(); addEventListener('resize', still); } else kick();
})();
