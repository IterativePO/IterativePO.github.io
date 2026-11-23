(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const el = (tag, attrs, parent) => {
    const element = document.createElementNS(NS, tag);
    if (attrs) {
      for (const key in attrs) {
        element.setAttribute(key, attrs[key]);
      }
    }
    if (parent) parent.appendChild(element);
    return element;
  };

  /* ------------------------------------------------------------------------
   * Pure Native SVG Math & Mixed-Text Renderer (ZERO <foreignObject>)
   * Uses MathJax v4 tex2svg() vector <path> groups + native SVG <text>,
   * eliminating WebKit Bug #23113 (<foreignObject> scaling/opacity detachment).
   * ------------------------------------------------------------------------ */
  const parseRichTokens = (str) => {
    const tokens = [];
    let bold = false;
    let i = 0;
    let buf = '';
    const flushText = () => {
      if (buf) {
        tokens.push({ type: 'text', text: buf, bold });
        buf = '';
      }
    };
    while (i < str.length) {
      if (str[i] === '*' && str[i + 1] === '*') {
        flushText();
        bold = !bold;
        i += 2;
      } else if (str[i] === '$') {
        const end = str.indexOf('$', i + 1);
        if (end !== -1) {
          flushText();
          tokens.push({ type: 'math', tex: str.slice(i + 1, end), bold });
          i = end + 1;
        } else {
          buf += str[i++];
        }
      } else {
        buf += str[i++];
      }
    }
    flushText();
    return tokens;
  };

  const renderSvgMathGroup = async (host) => {
    const tex2svgAsync = window.MathJax?.tex2svgPromise
      ? (tex) => window.MathJax.tex2svgPromise(tex, { display: false })
      : (window.MathJax?.tex2svg
        ? (tex) => Promise.resolve(window.MathJax.tex2svg(tex, { display: false }))
        : null);
    if (!tex2svgAsync) return;
    if (host.dataset.rendered === '1' || host.dataset.rendered === 'pending') return;

    const raw = host.dataset.math;
    if (!raw) return;
    host.dataset.rendered = 'pending';

    const x = parseFloat(host.dataset.x || '0');
    const y = parseFloat(host.dataset.y || '0');
    const fontSize = parseFloat(host.dataset.size || '13.5');
    const align = host.dataset.align || 'center';
    const valign = host.dataset.valign || 'middle';
    const color = host.dataset.color || '#242a30';
    const baseWeight = host.dataset.weight || '400';
    const fontStyle = host.dataset.style || 'normal';
    const maxW = host.dataset.maxW ? parseFloat(host.dataset.maxW) : 0;

    const tokens = parseRichTokens(raw);
    const hasText = tokens.some((t) => t.type === 'text' && t.text.trim().length > 0);
    const mathScale = (fontSize * (hasText ? 1.06 : 1.04)) / 1000;

    /* Pre-render all math tokens asynchronously before mutating SVG DOM */
    const renderedTokens = [];
    for (const tok of tokens) {
      if (tok.type === 'math') {
        /* Wrapping in {...} prevents MathJax v4 inline linebreaks from splitting SVG formulas */
        const mjxNode = await tex2svgAsync('{' + tok.tex + '}');
        renderedTokens.push({ ...tok, mjxNode });
      } else {
        renderedTokens.push(tok);
      }
    }

    while (host.firstChild) host.removeChild(host.firstChild);

    const inner = el('g', {}, host);
    let curX = 0;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const tok of renderedTokens) {
      if (tok.type === 'text') {
        const str = tok.text;
        const trimmed = str.trim();
        if (!trimmed) {
          curX += str.includes('\u2002') ? fontSize * 0.5 : fontSize * 0.28;
          continue;
        }
        if (str.startsWith('\u2002')) curX += fontSize * 0.5;
        else if (str.startsWith(' ')) curX += fontSize * 0.28;

        const tEl = el('text', {
          x: curX.toFixed(2),
          y: '0',
          'font-size': fontSize,
          'font-weight': tok.bold ? '700' : baseWeight,
          'font-style': fontStyle
        }, inner);
        tEl.style.fill = color;
        tEl.textContent = trimmed;
        const w = tEl.getComputedTextLength();
        curX += w;

        if (str.endsWith('\u2002')) curX += fontSize * 0.5;
        else if (str.endsWith(' ')) curX += fontSize * 0.28;
      } else {
        const topSvgs = Array.from(tok.mjxNode.children).filter(
          (child) => child.tagName && child.tagName.toLowerCase() === 'svg'
        );
        for (const mjxSvg of topSvgs) {
          const vb = (mjxSvg.getAttribute('viewBox') || '0 -700 1000 900').split(/\s+/).map(Number);
          const [vbX, vbY, vbW, vbH] = vb;
          const gChild = Array.from(mjxSvg.children).find(
            (child) => child.tagName && child.tagName.toLowerCase() === 'g'
          );
          if (!gChild) continue;

          const adopted = document.importNode(gChild, true);
          adopted.setAttribute('fill', color);
          adopted.setAttribute('stroke', color);

          const wrap = el('g', {
            transform: 'translate(' + (curX - vbX * mathScale).toFixed(2) + ',0) scale(' + mathScale.toFixed(5) + ')'
          }, inner);
          wrap.style.color = color;
          wrap.appendChild(adopted);

          curX += vbW * mathScale;
          const topY = vbY * mathScale;
          const botY = (vbY + vbH) * mathScale;
          if (topY < minY) minY = topY;
          if (botY > maxY) maxY = botY;
        }
      }
    }

    const totalW = curX;
    const fitScale = (maxW > 0 && totalW > maxW) ? (maxW / totalW) : 1;

    let tx = x;
    if (align === 'center') tx = x - (totalW * fitScale) / 2;
    else if (align === 'right') tx = x - totalW * fitScale;

    let ty = y;
    if (valign === 'middle') {
      if (!hasText && Number.isFinite(minY) && Number.isFinite(maxY)) {
        ty = y - ((minY + maxY) / 2) * fitScale;
      } else {
        ty = y + fontSize * 0.34 * fitScale;
      }
    }

    const transform = 'translate(' + tx.toFixed(2) + ',' + ty.toFixed(2) + ')' +
      (fitScale < 1 ? ' scale(' + fitScale.toFixed(4) + ')' : '');
    inner.setAttribute('transform', transform);
    host.dataset.rendered = '1';
  };

  let renderPromise = null;
  const renderAllSvgMath = () => {
    if (!window.MathJax?.tex2svgPromise && !window.MathJax?.tex2svg) return Promise.resolve();
    if (renderPromise) return renderPromise;
    renderPromise = (async () => {
      const hosts = Array.from(document.querySelectorAll('svg g.svg-tex'));
      for (const host of hosts) {
        await renderSvgMathGroup(host);
      }
      document.documentElement.dataset.svgMathReady = '1';
    })();
    return renderPromise;
  };

  window.__renderIterpoSvgMath = renderAllSvgMath;

  const makeSvgMath = (parent, opts) => {
    const attrs = {
      class: 'svg-tex',
      'data-math': opts.math,
      'data-x': String(opts.x),
      'data-y': String(opts.y),
      'data-size': String(opts.size || 13.5),
      'data-align': opts.align || 'center',
      'data-valign': opts.valign || 'middle',
      'data-color': opts.color || '#1f2428'
    };
    if (opts.weight) attrs['data-weight'] = String(opts.weight);
    if (opts.style) attrs['data-style'] = opts.style;
    if (opts.maxW) attrs['data-max-w'] = String(opts.maxW);
    return el('g', attrs, parent);
  };

  /* ------------------------------------------------------------------------
   * Figure 1: Animated IterPO Overview Diagram (#fig)
   * ------------------------------------------------------------------------ */
  const svg = document.getElementById('fig');
  if (svg) {
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const lerp = (a, b, u) => a + (b - a) * u;
    const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
    const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
    const easeOut = (u) => 1 - Math.pow(1 - u, 2.4);

    const setOp = (element, value) => {
      value = Math.round(value * 1000) / 1000;
      if (element._op !== value) {
        element._op = value;
        element.setAttribute('opacity', value);
      }
    };

    const EPISODES = [
      { turns: 3, r: 0 },
      { turns: 4, r: 1 },
      { turns: 2, r: 1 }
    ];

    const defs = el('defs', {}, svg);
    [['ah', 'ahead'], ['ahA', 'aheadA']].forEach(([id, className]) => {
      const marker = el('marker', {
        id, viewBox: '0 0 10 10', refX: '7.5', refY: '5',
        markerWidth: '9', markerHeight: '9', orient: 'auto', markerUnits: 'userSpaceOnUse'
      }, defs);
      el('path', { d: 'M0,1.5 L9.5,5 L0,8.5 z', class: className }, marker);
    });

    const gradient = el('linearGradient', { id: 'coneG', x1: '546', y1: '0', x2: '1068', y2: '0', gradientUnits: 'userSpaceOnUse' }, defs);
    [[0, 'var(--or-node)', 0.65], [0.22, 'var(--or-stroke)', 0.4], [0.6, 'var(--or-fill)', 0.24], [1, 'var(--or-fill)', 0]]
      .forEach(([offset, color, opacity]) => {
        el('stop', { offset, style: 'stop-color:' + color + ';stop-opacity:' + opacity }, gradient);
      });

    /* Clip-path so the orange fan expands outward from Q^\pi the instant the response hits it */
    const coneClip = el('clipPath', { id: 'coneClip' }, defs);
    const coneClipRect = el('rect', { x: 546, y: 295, width: 530, height: 198 }, coneClip);

    const layers = {};
    ['panels', 'cone', 'paths', 'ghosts', 'boxes', 'text', 'episodes', 'response']
      .forEach((name) => { layers[name] = el('g', {}, svg); });

    layers.cone.setAttribute('clip-path', 'url(#coneClip)');
    layers.ghosts.setAttribute('clip-path', 'url(#coneClip)');

    /* Background panels (top panel bottom is y = 252) */
    el('rect', { x: 24, y: 18, width: 1007, height: 234, rx: 18, class: 'panel' }, layers.panels);
    el('rect', { x: 24, y: 268, width: 556, height: 232, rx: 18, class: 'panel' }, layers.panels);

    /* Orange cone: top edge stays below y = 308 so the caption at y = 264..304 has clean clearance below top gray box (y = 252) */
    const cone = el('path', {
      d: 'M546,396 C600,322 750,310 1068,308 L1068,484 C750,482 600,470 546,396 Z',
      fill: 'url(#coneG)'
    }, layers.cone);

    /* Top panel labels */
    makeSvgMath(layers.text, {
      x: 42, y: 42, size: 16, align: 'left', valign: 'middle', color: '#1f2428', maxW: 970,
      math: '**Learn multi-turn $Q^\\pi$:** Collect trajectories from $\\pi$ and regress on Monte Carlo returns to fit $Q^\\pi$.'
    });

    [['Turn 1', 504], ['Turn 2', 648], ['Turn 3', 792], ['Turn 4', 936]]
      .forEach(([label, x]) => {
        const text = el('text', { x, y: 224, 'text-anchor': 'middle', 'font-size': 13.5 }, layers.text);
        text.textContent = label;
      });

    /* Native SVG token legend: (■ = token) centered at x = 504 */
    const tokOpen = el('text', { x: 472, y: 243, 'text-anchor': 'end', 'font-size': 12.5 }, layers.text);
    tokOpen.textContent = '(';
    el('rect', { x: 475, y: 234, width: 9, height: 9, rx: 1, class: 'tok' }, layers.text);
    const tokClose = el('text', { x: 488, y: 243, 'text-anchor': 'start', 'font-size': 12.5 }, layers.text);
    tokClose.textContent = '= token)';

    /* Bottom-left panel labels */
    makeSvgMath(layers.text, {
      x: 42, y: 294, size: 15.5, align: 'left', valign: 'middle', color: '#1f2428', maxW: 520,
      math: '**Single-turn GRPO:** Run (token-level) GRPO with $Q^\\pi$ as the reward.'
    });
    const responseLabel = el('text', { x: 360, y: 344, 'text-anchor': 'middle', 'font-size': 12.5 }, layers.text);
    responseLabel.textContent = 'Single-turn response';
    const grpoLabel = el('text', { x: 360, y: 426, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 700 }, layers.text);
    grpoLabel.textContent = 'GRPO';
    const estimatedLabel = el('text', { x: 360, y: 482, 'text-anchor': 'middle', 'font-size': 12.5 }, layers.text);
    estimatedLabel.textContent = 'Estimated multi-turn return';

    /* Cone & Repeat labels */
    const coneTextGroup = el('g', {}, layers.text);
    makeSvgMath(coneTextGroup, {
      x: 598, y: 277, size: 15, align: 'left', valign: 'middle', color: '#1f2428', maxW: 470,
      math: 'Future turns are implicitly \u201ccompressed\u201d into $Q^\\pi$ model'
    });
    const coneSub = el('text', { x: 598, y: 300, 'font-size': 15 }, coneTextGroup);
    coneSub.textContent = '(not explicitly generated!)';

    const repeatTextGroup = el('g', {}, layers.text);
    const repTitle = el('text', { x: 1096, y: 318, 'font-size': 15.5 }, repeatTextGroup);
    repTitle.textContent = 'Repeat';
    makeSvgMath(repeatTextGroup, {
      x: 1096, y: 342, size: 18, align: 'left', valign: 'middle', color: '#2c73eb', maxW: 96,
      math: '$\\pi \\leftarrow \\pi\'$'
    });

    /* Arrows */
    const paths = {};
    const makePath = (key, d) => {
      const path = el('path', { d, class: 'arrow', 'marker-end': 'url(#ah)' }, layers.paths);
      paths[key] = { el: path, on: false };
    };
    makePath('episode0', 'M352,88 L288,120');
    makePath('episode1', 'M352,136 L286,136');
    makePath('episode2', 'M352,184 L288,152');
    makePath('toResp', 'M252,382 L292,374');
    makePath('toQ', 'M428,374 L472,382');
    makePath('return', 'M472,446 Q360,474 254,446');
    makePath('improve', 'M144,441 V542 H657');
    makePath('repeat', 'M899,542 H1082 V136 H1039');

    const setActive = (key, active) => {
      const path = paths[key];
      if (path.on !== active) {
        path.on = active;
        path.el.classList.toggle('active', active);
        path.el.setAttribute('marker-end', active ? 'url(#ahA)' : 'url(#ah)');
      }
    };

    /* Static neural network icon */
    const makeStaticNetwork = (parent, x, yCenter, className) => {
      const counts = [3, 4, 4, 2];
      const gapX = 23;
      const gapY = 17;
      const radius = 6.5;
      const positions = counts.map((count, layer) =>
        Array.from({ length: count }, (_, index) => [
          x + layer * gapX,
          yCenter + (index - (count - 1) / 2) * gapY
        ])
      );
      const edgeGroup = el('g', { class: className + '-edge' }, parent);
      for (let layer = 0; layer < counts.length - 1; layer++) {
        for (const [x1, y1] of positions[layer]) {
          for (const [x2, y2] of positions[layer + 1]) {
            el('line', { x1, y1, x2, y2 }, edgeGroup);
          }
        }
      }
      const nodeGroup = el('g', {}, parent);
      for (let layer = 0; layer < counts.length; layer++) {
        for (const [cx, cy] of positions[layer]) {
          el('circle', { cx, cy, r: radius, class: className + '-node' }, nodeGroup);
        }
      }
    };

    /* Model boxes */
    // 1. Q^\pi-model box: y = 90..182 (center y = 136), x = 42..272
    const qModelGroup = el('g', {}, layers.boxes);
    el('rect', { x: 42, y: 90, width: 230, height: 92, rx: 14, class: 'orbox' }, qModelGroup);
    makeSvgMath(qModelGroup, {
      x: 108, y: 136, size: 23, weight: 500, align: 'center', valign: 'middle', color: '#dd8418', maxW: 120,
      math: '$Q^\\pi$-model'
    });
    makeStaticNetwork(qModelGroup, 182, 136, 'or');

    // 2. LLM box: y = 347..437 (center y = 392), x = 42..248
    el('rect', { x: 42, y: 347, width: 206, height: 90, rx: 14, class: 'blbox' }, layers.boxes);
    const llmText = el('text', { x: 93, y: 401, 'text-anchor': 'middle', 'font-size': 25, 'font-weight': 500, class: 'bl-ink' }, layers.text);
    llmText.textContent = 'LLM';
    makeStaticNetwork(layers.boxes, 154, 392, 'bl');

    // 3. Q^\pi reward box: y = 334..450 (center y = 392), x = 480..546
    el('rect', { x: 480, y: 334, width: 66, height: 116, rx: 10, class: 'orbox' }, layers.boxes);
    makeSvgMath(layers.text, {
      x: 513, y: 392, size: 24, align: 'center', valign: 'middle', color: '#dd8418', maxW: 56,
      math: '$Q^\\pi$'
    });

    // 4. LLM \pi' (improved) box: y = 498..586 (center y = 542), x = 662..894
    const improvedGroup = el('g', {}, layers.boxes);
    el('rect', { x: 662, y: 498, width: 232, height: 88, rx: 14, class: 'blbox2' }, improvedGroup);
    makeSvgMath(improvedGroup, {
      x: 723, y: 533, size: 20, weight: 500, align: 'center', valign: 'middle', color: '#2c73eb', maxW: 112,
      math: 'LLM $\\pi\'$'
    });
    const impSub = el('text', { x: 723, y: 558, 'text-anchor': 'middle', 'font-size': 14.5, class: 'bl-ink' }, improvedGroup);
    impSub.textContent = '(improved)';
    makeStaticNetwork(improvedGroup, 792, 542, 'bl');

    /* Top episodes: centered at y = 86, 136, 186 */
    const EP_Y = [65, 115, 165];
    const EP_X = 432;
    const TURN_PITCH = 144;
    const TOKEN_SIZE = 28;
    const episodeViews = EPISODES.map((episode, index) => {
      const y = EP_Y[index];
      const group = el('g', {}, layers.episodes);
      const label = el('text', { x: 422, y: y + 26, 'text-anchor': 'end', 'font-size': 13.5, class: 'muted' }, group);
      label.textContent = 'Episode ' + (index + 1);
      el('rect', { x: EP_X, y, width: episode.turns * TURN_PITCH, height: 42, rx: 6, class: 'track' }, group);

      const cells = [];
      for (let turn = 0; turn < episode.turns; turn++) {
        const baseX = EP_X + 8 + turn * TURN_PITCH;
        const isLastTurn = turn === episode.turns - 1;
        for (const offsetX of [0, 32, 92]) {
          const isTerminalCell = isLastTurn && offsetX === 92;
          const rect = el('rect', { x: baseX + offsetX, y: y + 7, width: TOKEN_SIZE, height: TOKEN_SIZE, rx: 2, class: 'tok' }, group);
          let text = null;
          if (isTerminalCell) {
            text = el('text', { x: baseX + offsetX + 14, y: y + 26, 'text-anchor': 'middle', 'font-size': 14.5, class: 'chiptext', 'font-weight': 700 }, group);
            text.textContent = '+' + episode.r;
          }
          cells.push({ r: rect, tx: text, term: isTerminalCell });
        }
        const dots = el('text', { x: baseX + 76, y: y + 23, 'text-anchor': 'middle', 'font-size': 15 }, group);
        dots.textContent = '⋯';
        el('line', { x1: EP_X + (turn + 1) * TURN_PITCH - 8, y1: y + 5, x2: EP_X + (turn + 1) * TURN_PITCH - 8, y2: y + 37, class: 'div' }, group);
      }
      return { g: group, cells, r: episode.r };
    });

    /* Single-turn response tokens in bottom-left panel (matching paper figure) */
    const responseTokens = [0, 32, 92].map((offsetX) =>
      el('rect', { x: 300 + offsetX, y: 360, width: TOKEN_SIZE, height: TOKEN_SIZE, rx: 2, class: 'tok' }, layers.response)
    );
    const respDots = el('text', { x: 376, y: 377, 'text-anchor': 'middle', 'font-size': 15 }, layers.response);
    respDots.textContent = '⋯';

    /* Ghost compressed branches inside the orange cone (grouped by turn depth 0, 1, 2) */
    const ghostTurns = [];
    const makeGhostTurn = (parent, x, y, terminalText, isPositive) => {
      const group = el('g', {}, parent);
      const width = 18;
      const height = 22;
      el('rect', { x, y, width, height, rx: 1.5, class: 'ghost' }, group);
      el('rect', { x: x + 21, y, width, height, rx: 1.5, class: 'ghost' }, group);
      const dots = el('text', { x: x + 48, y: y + 13, 'text-anchor': 'middle', 'font-size': 11 }, group);
      dots.textContent = '⋯';
      const lastClass = terminalText === null ? 'ghost' : (isPositive ? 'ghostc1' : 'ghostc0');
      el('rect', { x: x + 56, y, width, height, rx: 1.5, class: lastClass }, group);
      if (terminalText !== null) {
        const text = el('text', { x: x + 65, y: y + 15, 'text-anchor': 'middle', 'font-size': 10.5, class: isPositive ? 'gtext1' : 'gtext0' }, group);
        text.textContent = terminalText;
      }
      el('line', { x1: x + 80, y1: y - 2, x2: x + 80, y2: y + height + 2, class: 'gdiv' }, group);
      return group;
    };

    const APEX = [546, 396];
    [
      {
        ang: -6.5, x0: 48, y0: -14,
        subs: [
          { offset: -9, turns: [{ terminal: null }, { terminal: '+1', positive: true }] },
          { offset: 11, turns: [{ terminal: '+0', positive: false }] }
        ]
      },
      {
        ang: 6.5, x0: 48, y0: 4,
        subs: [
          { offset: -9, turns: [{ terminal: null }, { terminal: '+0', positive: false }] },
          { offset: 11, turns: [{ terminal: '+0', positive: false }] }
        ]
      }
    ].forEach((stemConfig, stemIdx) => {
      const wrapper = el('g', { transform: 'translate(' + APEX[0] + ',' + APEX[1] + ') rotate(' + stemConfig.ang + ')' }, layers.ghosts);
      const stemTurn = makeGhostTurn(wrapper, stemConfig.x0, stemConfig.y0, null, false);
      ghostTurns.push({ el: stemTurn, depth: 0, branch: stemIdx });
      stemConfig.subs.forEach((sub, subIdx) => {
        sub.turns.forEach((turn, depthIdx) => {
          const turnGroup = makeGhostTurn(
            wrapper,
            stemConfig.x0 + 92 * (depthIdx + 1),
            stemConfig.y0 + sub.offset,
            turn.terminal,
            turn.positive
          );
          ghostTurns.push({ el: turnGroup, depth: depthIdx + 1, branch: stemIdx * 2 + subIdx });
        });
      });
    });

    /* Synchronized 10.5-second loop */
    const DURATION = 10.5;
    const HIT_TIME = 3.75; // Exact moment the single-turn response arrow hits Q^\pi

    const render = (t) => {
      /* 1. Top Panel: First collect conversations (t = 0.0 .. 1.45), then arrows feed into Q^pi-model (t = 1.5 .. 3.0) */
      episodeViews.forEach((episode, epIdx) => {
        const start = 0.1 + epIdx * 0.2;
        episode.cells.forEach((cell, cellIdx) => {
          const appear = ease(seg(t, start + cellIdx * 0.04, start + cellIdx * 0.04 + 0.26));
          setOp(cell.r, appear);
          if (cell.term) {
            setOp(cell.tx, ease(seg(t, 1.0, 1.38)));
          }
        });

        const arrowAppear = ease(seg(t, 1.5 + epIdx * 0.08, 1.82 + epIdx * 0.08));
        setOp(paths['episode' + epIdx].el, arrowAppear);
        setActive('episode' + epIdx, t >= 1.5 + epIdx * 0.08 && t < 2.95);
      });

      setOp(qModelGroup, lerp(0.45, 1, ease(seg(t, 1.7, 2.2))));

      /* 2. Bottom-Left Panel: LLM generates single-turn response -> arrow strikes Q^pi at HIT_TIME */
      setOp(paths.toResp.el, lerp(0.25, 1, easeOut(seg(t, 2.95, 3.15))));
      setActive('toResp', t >= 2.95 && t < 3.65);

      responseTokens.forEach((tok, idx) => {
        const tokAppear = easeOut(seg(t, 3.08 + idx * 0.12, 3.32 + idx * 0.12));
        setOp(tok, lerp(0.18, 1, tokAppear));
      });
      setOp(respDots, lerp(0.18, 1, easeOut(seg(t, 3.2, 3.44))));

      // Arrow from single-turn response to Q^pi fires at t = 3.55 and hits Q^pi at HIT_TIME = 3.75
      setOp(paths.toQ.el, lerp(0.25, 1, easeOut(seg(t, 3.55, HIT_TIME))));
      setActive('toQ', t >= 3.55 && t < 6.2);

      /* 3. Cone: Immediately fans out from Q^pi at HIT_TIME = 3.75 using easeOut (peak initial velocity) */
      const fanOut = easeOut(seg(t, HIT_TIME, HIT_TIME + 0.55));
      const fanFade = 1 - ease(seg(t, 6.7, 7.5));
      const coneOp = fanOut * fanFade;

      const clipW = Math.round(530 * easeOut(seg(t, HIT_TIME, HIT_TIME + 0.78)));
      if (coneClipRect._w !== clipW) {
        coneClipRect._w = clipW;
        coneClipRect.setAttribute('width', clipW);
      }

      setOp(cone, coneOp);
      setOp(coneTextGroup, easeOut(seg(t, HIT_TIME, HIT_TIME + 0.45)) * fanFade);

      ghostTurns.forEach((item) => {
        const start = HIT_TIME + item.depth * 0.22 + item.branch * 0.03;
        const appear = easeOut(seg(t, start, start + 0.32));
        setOp(item.el, appear * fanFade);
      });

      /* 4. Estimated multi-turn return flows back -> LLM \pi' -> Repeat */
      setActive('return', t >= 6.1 && t < 7.6);
      setActive('improve', t >= 7.3 && t < 8.8);

      const improvedVis = t < 7.3 ? 0.5 : lerp(0.5, 1, ease(seg(t, 7.3, 7.8)));
      setOp(improvedGroup, improvedVis);

      setActive('repeat', t >= 8.7);
      setOp(repeatTextGroup, t >= 8.7 ? 1 : 0.7);
    };

    if (reducedMotion) {
      render(5.4);
    } else {
      let lastTimestamp = performance.now();
      let playhead = 0;

      const tick = (now) => {
        const dt = Math.min(0.05, (now - lastTimestamp) / 1000);
        lastTimestamp = now;
        playhead = (playhead + dt) % DURATION;
        render(playhead);
        requestAnimationFrame(tick);
      };

      render(0);
      requestAnimationFrame(tick);
    }
  }

  /* ------------------------------------------------------------------------
   * Animated IterPO Policy Iteration Convergence Diagram (#iterpo-pi-fig)
   * ------------------------------------------------------------------------ */
  const piSvg = document.getElementById('iterpo-pi-fig');
  if (piSvg) {
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
    const easeOut = (u) => 1 - Math.pow(1 - u, 2.2);

    const arcEval = document.getElementById('ipi-arc-eval');
    const arcImp = document.getElementById('ipi-arc-imp');
    const starGroup = document.getElementById('ipi-star');

    const steps = [0, 1, 2, 3, 4, 5].map((idx) => {
      const line = document.getElementById('ipi-s' + idx);
      const label = document.getElementById('ipi-l' + idx);
      const x1 = parseFloat(line.getAttribute('x1'));
      const y1 = parseFloat(line.getAttribute('y1'));
      const x2 = parseFloat(line.getAttribute('x2'));
      const y2 = parseFloat(line.getAttribute('y2'));
      const len = Math.hypot(x2 - x1, y2 - y1);
      line.setAttribute('stroke-dasharray', len.toFixed(1));
      return { line, label, len, isEval: idx % 2 === 0 };
    });

    // Schedule: 6 alternating steps (Reward Fit -> GRPO -> ... -> (pi*, Q*)), hold, gentle reset
    const STEP_TIMES = [
      [0.35, 1.15],
      [1.35, 2.15],
      [2.35, 3.05],
      [3.20, 3.90],
      [4.05, 4.65],
      [4.80, 5.40]
    ];
    const DURATION = 8.6;

    const setOp = (node, val) => {
      if (!node) return;
      val = Math.round(val * 1000) / 1000;
      if (node._op !== val) {
        node._op = val;
        node.setAttribute('opacity', val);
      }
    };

    const render = (t) => {
      const fadeAll = 1 - seg(t, 7.85, 8.45);
      let evalActive = false;
      let impActive = false;

      steps.forEach((step, idx) => {
        const [start, end] = STEP_TIMES[idx];
        const u = easeOut(seg(t, start, end));
        const offset = (step.len * (1 - u)).toFixed(1);
        step.line.setAttribute('stroke-dashoffset', offset);
        setOp(step.line, (u > 0.03 ? 1 : 0) * fadeAll);

        if (t >= start && t <= end + 0.15) {
          if (step.isEval) evalActive = true;
          else impActive = true;
        }

        if (step.label) {
          const labelVis = easeOut(seg(t, start + 0.2, end + 0.1));
          setOp(step.label, labelVis * fadeAll);
        }
      });

      if (arcEval && arcImp) {
        if (evalActive) {
          arcEval.setAttribute('stroke-width', '2.6');
          setOp(arcEval, 1);
          arcImp.setAttribute('stroke-width', '1.5');
          setOp(arcImp, 0.42);
        } else if (impActive) {
          arcImp.setAttribute('stroke-width', '2.6');
          setOp(arcImp, 1);
          arcEval.setAttribute('stroke-width', '1.5');
          setOp(arcEval, 0.42);
        } else {
          arcEval.setAttribute('stroke-width', '1.65');
          arcImp.setAttribute('stroke-width', '1.65');
          setOp(arcEval, 0.9);
          setOp(arcImp, 0.9);
        }
      }

      const starVis = t < 5.2 ? 0.55 : (0.55 + 0.45 * easeOut(seg(t, 5.2, 5.75)));
      setOp(starGroup, starVis);
    };

    if (reducedMotion) {
      render(6.5);
    } else {
      let lastTimestamp = performance.now();
      let playhead = 0;

      const tick = (now) => {
        const dt = Math.min(0.05, (now - lastTimestamp) / 1000);
        lastTimestamp = now;
        playhead = (playhead + dt) % DURATION;
        render(playhead);
        requestAnimationFrame(tick);
      };

      render(0);
      requestAnimationFrame(tick);
    }
  }

  /* If MathJax already completed startup before script.js ran, render SVG math now */
  if (window.MathJax?.startup?.promise) {
    window.MathJax.startup.promise.then(renderAllSvgMath);
  } else if (window.MathJax?.tex2svgPromise || window.MathJax?.tex2svg) {
    renderAllSvgMath();
  }
})();
