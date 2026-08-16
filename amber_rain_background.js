(() => {
  'use strict';

  const canvas = document.getElementById('amberRainBackground');
  if (!canvas) return;

  const TARGET_FPS = 30;
  const MAX_DEVICE_PIXEL_RATIO = 1.25;
  const TARGET_DENSITY = 0.55;
  const FONT_PX = 14;
  const CHAR_WIDTH = 9;
  const CHAR_HEIGHT = 14;
  const FRAME_INTERVAL = 1000 / TARGET_FPS;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const context = canvas.getContext('2d', {
    alpha: true,
    desynchronized: true
  });

  if (!context) {
    canvas.hidden = true;
    return;
  }

  const AMBER = { r: 255, g: 176, b: 40 };
  const AMBER_HOT = { r: 255, g: 220, b: 120 };
  const HEAD_CHARS = ['|', '!', '|', ':'];
  const BODY_CHARS = [':', ':', '.', '\''];
  const TAIL_CHARS = ['.', '\'', '`', ',', ' ', '.'];
  const SPLASH_FRAMES = [
    { yOffset: 0, rows: [' . '] },
    { yOffset: 0, rows: ['.o.'] },
    { yOffset: -1, rows: ['. .', ' O '] },
    { yOffset: -1, rows: ['\'   \'', ' . . '] },
    { yOffset: -1, rows: ['`     `', '  .   '] }
  ];

  let width = 1;
  let height = 1;
  let columns = 1;
  let rows = 1;
  let drops = [];
  let splashes = [];
  let groundShimmer = [];
  let animationFrame = 0;
  let lastFrameAt = 0;

  function colorString(color, alpha) {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
  }

  function targetDropCount() {
    return Math.max(1, Math.floor(columns * TARGET_DENSITY));
  }

  function spawnDrop(initial = false) {
    const layer = Math.random();
    let speed;
    let intensity;
    let length;

    if (layer < 0.3) {
      speed = 0.35 + Math.random() * 0.25;
      intensity = 0.35 + Math.random() * 0.15;
      length = 4 + Math.floor(Math.random() * 3);
    } else if (layer < 0.75) {
      speed = 0.7 + Math.random() * 0.5;
      intensity = 0.6 + Math.random() * 0.2;
      length = 6 + Math.floor(Math.random() * 4);
    } else {
      speed = 1.2 + Math.random() * 0.9;
      intensity = 0.85 + Math.random() * 0.15;
      length = 8 + Math.floor(Math.random() * 6);
    }

    drops.push({
      column: Math.floor(Math.random() * columns),
      y: initial ? Math.random() * rows : -Math.random() * 12,
      speed,
      intensity,
      length,
      layer
    });
  }

  function resetScene() {
    drops = [];
    splashes = [];
    groundShimmer = Array.from({ length: columns }, () => Math.random());
    while (drops.length < targetDropCount()) spawnDrop(true);
  }

  function resize() {
    const nextWidth = Math.max(1, window.innerWidth);
    const nextHeight = Math.max(1, window.innerHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    const renderWidth = Math.max(1, Math.round(nextWidth * ratio));
    const renderHeight = Math.max(1, Math.round(nextHeight * ratio));

    if (
      canvas.width === renderWidth
      && canvas.height === renderHeight
      && width === nextWidth
      && height === nextHeight
    ) {
      return;
    }

    width = nextWidth;
    height = nextHeight;
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.font = `${FONT_PX}px "Courier New", monospace`;
    context.textBaseline = 'top';
    columns = Math.max(1, Math.floor(width / CHAR_WIDTH));
    rows = Math.max(1, Math.floor(height / CHAR_HEIGHT));
    context.fillStyle = 'rgb(0, 0, 0)';
    context.fillRect(0, 0, width, height);
    resetScene();
  }

  function drawGround(frameScale) {
    const groundY = (rows - 1) * CHAR_HEIGHT;

    for (let column = 0; column < columns; column++) {
      groundShimmer[column] += (Math.random() - 0.5) * 0.04 * frameScale;
      groundShimmer[column] = Math.max(0, Math.min(1, groundShimmer[column]));
      const shimmer = groundShimmer[column];
      if (shimmer <= 0.45) continue;

      const alpha = (shimmer - 0.45) * 0.275;
      const character = shimmer > 0.85 ? '~' : shimmer > 0.65 ? '-' : '.';
      context.fillStyle = colorString(AMBER, alpha);
      context.shadowBlur = 0;
      context.fillText(character, column * CHAR_WIDTH, groundY);
    }
  }

  function drawDrops(frameScale) {
    for (const drop of drops) {
      drop.y += drop.speed * frameScale;
      const headRow = Math.floor(drop.y);

      for (let index = 0; index < drop.length; index++) {
        const row = headRow - index;
        if (row < 0 || row >= rows) continue;

        const fade = (1 - index / drop.length) * drop.intensity;
        if (fade < 0.04) continue;

        let character;
        if (index === 0) {
          character = HEAD_CHARS[(drop.column + row) % HEAD_CHARS.length];
          context.fillStyle = colorString(AMBER_HOT, Math.min(1, fade));
          context.shadowColor = 'rgba(255, 200, 90, 0.9)';
          context.shadowBlur = 10 * drop.layer + 4;
        } else if (index < 3) {
          character = BODY_CHARS[(drop.column * 3 + row) % BODY_CHARS.length];
          context.fillStyle = colorString(AMBER, fade * 0.9);
          context.shadowColor = 'rgba(255, 176, 40, 0.5)';
          context.shadowBlur = 4;
        } else {
          character = TAIL_CHARS[(drop.column * 7 + row * 5) % TAIL_CHARS.length];
          context.fillStyle = colorString(AMBER, fade * 0.9);
          context.shadowBlur = 0;
        }

        context.fillText(character, drop.column * CHAR_WIDTH, row * CHAR_HEIGHT);
      }

      if (headRow < rows) continue;

      if (Math.random() < 0.6) {
        splashes.push({
          column: drop.column,
          age: 0,
          intensity: drop.intensity
        });
      }

      if (drop.column >= 0 && drop.column < columns) {
        groundShimmer[drop.column] = Math.min(1, groundShimmer[drop.column] + 0.6);
        if (drop.column > 0) {
          groundShimmer[drop.column - 1] = Math.min(1, groundShimmer[drop.column - 1] + 0.25);
        }
        if (drop.column < columns - 1) {
          groundShimmer[drop.column + 1] = Math.min(1, groundShimmer[drop.column + 1] + 0.25);
        }
      }

      drop.done = true;
    }

    context.shadowBlur = 0;
    drops = drops.filter((drop) => !drop.done);
    while (drops.length < targetDropCount()) spawnDrop();
  }

  function drawSplashes(frameScale) {
    for (const splash of splashes) {
      const frameIndex = Math.floor(splash.age / 3);
      if (frameIndex >= SPLASH_FRAMES.length) {
        splash.done = true;
        continue;
      }

      const frame = SPLASH_FRAMES[frameIndex];
      const alpha = (1 - frameIndex / SPLASH_FRAMES.length) * splash.intensity;
      context.fillStyle = colorString(AMBER_HOT, alpha);
      context.shadowColor = 'rgba(255, 200, 100, 0.8)';
      context.shadowBlur = 6;

      for (let rowIndex = 0; rowIndex < frame.rows.length; rowIndex++) {
        const line = frame.rows[rowIndex];
        const startColumn = splash.column - Math.floor(line.length / 2);
        const drawRow = rows - 1 + frame.yOffset + rowIndex;
        if (drawRow < 0 || drawRow >= rows) continue;

        for (let characterIndex = 0; characterIndex < line.length; characterIndex++) {
          const character = line[characterIndex];
          if (character === ' ') continue;
          const column = startColumn + characterIndex;
          if (column < 0 || column >= columns) continue;
          context.fillText(character, column * CHAR_WIDTH, drawRow * CHAR_HEIGHT);
        }
      }

      splash.age += frameScale;
    }

    context.shadowBlur = 0;
    splashes = splashes.filter((splash) => !splash.done);
  }

  function drawScene(frameScale) {
    context.fillStyle = 'rgba(0, 0, 0, 0.22)';
    context.fillRect(0, 0, width, height);
    drawGround(frameScale);
    drawDrops(frameScale);
    drawSplashes(frameScale);
  }

  function queueFrame() {
    if (!animationFrame && !document.hidden && !reducedMotion.matches) {
      animationFrame = window.requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    animationFrame = 0;
    const elapsed = now - lastFrameAt;
    if (!lastFrameAt || elapsed >= FRAME_INTERVAL) {
      const frameScale = lastFrameAt ? Math.min(2.5, elapsed / (1000 / 60)) : 1;
      lastFrameAt = now;
      resize();
      drawScene(frameScale);
    }
    queueFrame();
  }

  function updatePlayback() {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    lastFrameAt = 0;
    if (document.hidden) return;

    resize();
    if (reducedMotion.matches) {
      drawScene(0);
      return;
    }

    queueFrame();
  }

  window.addEventListener('resize', updatePlayback);
  document.addEventListener('visibilitychange', updatePlayback);
  reducedMotion.addEventListener('change', updatePlayback);
  updatePlayback();
})();
