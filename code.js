// Stroke Center — Figma Plugin
// Duplicates selected shapes, normalises all INSIDE/OUTSIDE strokes to CENTER
// on the copies (originals untouched), places copies next to the originals.

figma.showUI(__html__, { width: 320, height: 280, title: 'Stroke Center' });

figma.on('selectionchange', sendSummary);

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'scan')      sendSummary();
  if (msg.type === 'duplicate') await handleDuplicate();
  if (msg.type === 'resize')    figma.ui.resize(320, Math.ceil(msg.height));
  if (msg.type === 'close')     figma.closePlugin();
};

sendSummary();

// ── Selection scanning ────────────────────────────────────────────────────

function sendSummary() {
  const nodes = [];
  for (const n of figma.currentPage.selection) collectStrokedNodes(n, nodes);
  figma.ui.postMessage({
    type: 'summary',
    nodes: nodes.map(function(n) {
      return {
        name:            n.name,
        type:            n.type,
        align:           n.strokeAlign,
        weight:          n.strokeWeight === figma.mixed ? '?' : n.strokeWeight,
        needsConversion: n.strokeAlign !== 'CENTER',
      };
    }),
  });
}

function collectStrokedNodes(node, out) {
  if ('strokes' in node && node.strokes.length > 0 && 'strokeAlign' in node) {
    out.push(node);
  }
  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      collectStrokedNodes(node.children[i], out);
    }
  }
}

// ── Duplicate + normalise ─────────────────────────────────────────────────

async function handleDuplicate() {
  var sel = figma.currentPage.selection;
  if (!sel.length) {
    figma.ui.postMessage({ type: 'error', message: 'Select at least one layer.' });
    return;
  }

  // Find the right edge of the entire selection (in absolute coords)
  // so we can place copies just to the right of it.
  var maxRight = -Infinity;
  for (var i = 0; i < sel.length; i++) {
    var ax = sel[i].absoluteTransform[0][2];
    var right = ax + sel[i].width;
    if (right > maxRight) maxRight = right;
  }
  var GAP = 100;

  var copies    = [];
  var converted = 0;
  var skipped   = [];

  for (var i = 0; i < sel.length; i++) {
    var node = sel[i];

    // Clone — starts in same parent as original
    var copy = node.clone();

    // Move to page root and set absolute position (original pos + offset to the right)
    var absX = node.absoluteTransform[0][2];
    var absY = node.absoluteTransform[1][2];
    figma.currentPage.appendChild(copy);
    copy.x = maxRight + GAP + (absX - sel[0].absoluteTransform[0][2]);
    copy.y = absY;

    // Normalise all stroked nodes inside the copy
    var strokeNodes = [];
    collectStrokedNodes(copy, strokeNodes);

    for (var j = 0; j < strokeNodes.length; j++) {
      var sn = strokeNodes[j];
      if (sn.strokeAlign === 'CENTER') continue;
      if (sn.strokeWeight === figma.mixed || sn.strokeAlign === figma.mixed) {
        skipped.push(sn.name + ' (mixed — skipped)');
        continue;
      }
      try {
        normalizeStroke(sn);
        converted++;
      } catch (e) {
        skipped.push(sn.name + ' (' + e.message + ')');
      }
    }

    copies.push(copy);
  }

  // Select copies and zoom in so user can inspect
  figma.currentPage.selection = copies;
  figma.viewport.scrollAndZoomIntoView(copies);

  figma.ui.postMessage({ type: 'done', converted: converted, skipped: skipped });
}

// ── Stroke normaliser ─────────────────────────────────────────────────────
//
// INSIDE stroke: visual outer edge = path boundary.
//   To center: path shrinks by w/2 → centered stroke outer edge stays put.
//   delta = -(w/2)
//
// OUTSIDE stroke: visual outer edge = path boundary + w.
//   To center: path grows by w/2 → centered stroke outer edge stays put.
//   delta = +(w/2)
//
// node.resize() handles all node types (RECTANGLE, ELLIPSE, VECTOR, etc.)
// and scales vectorPaths proportionally without touching curve data.

function normalizeStroke(node) {
  var w     = node.strokeWeight;
  var align = node.strokeAlign;
  var delta = align === 'INSIDE' ? -(w / 2) : (w / 2);
  adjustBBox(node, delta);
  node.strokeAlign = 'CENTER';
}

function adjustBBox(node, delta) {
  var newW = Math.max(0.01, node.width  + delta * 2);
  var newH = Math.max(0.01, node.height + delta * 2);
  node.x -= delta;
  node.y -= delta;
  node.resize(newW, newH);
}
