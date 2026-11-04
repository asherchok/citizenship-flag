// Citizenship / ITAR Flag — content script
// Walks text nodes, highlights matches in yellow, and tints the viewport red
// when any restrictive-hiring / export-control phrase is found.

(() => {
  const OVERLAY_ID = "__citizenship_itar_flag_overlay__";
  const BADGE_ID = "__citizenship_itar_flag_badge__";
  const HL_CLASS = "__cif_hl__";

  const PATTERNS = [
    {
      label: "ITAR",
      re: /\bITAR\b|International\s+Traffic\s+in\s+Arms\s+Regulations|\bEAR\b\s+controlled|export[-\s]controlled/i,
    },
    {
      label: "Security clearance",
      re: /\b(?:U\.?\s*S\.?\s*(?:Government\s+)?)?(?:secret|top[\s-]secret|ts\s*\/\s*sci|sci|dod|q|l|public\s+trust|security)\s+clearance\b|\b(?:ability|able|eligible|eligibility)\s+to\s+obtain\s+(?:a\s+|an\s+)?(?:secret|top[\s-]secret|ts\s*\/\s*sci|sci|dod|security|public\s+trust)?\s*clearance\b|\baccess\s+to\s+classified\s+(?:information|data|materials?)\b|\bactive\s+security\s+investigation\b/i,
    },
    {
      label: "US citizenship",
      re: /(include|require[sd]?|must\s+(have|be)|need|requires?)\s+(a\s+|an\s+)?U\.?\s*S\.?\s*citizenship|U\.?\s*S\.?\s*citizen(ship)?\s+(is\s+)?required|must\s+be\s+a\s+U\.?\s*S\.?\s*citizen|U\.?\s*S\.?\s*persons?\s+only/i,
    },
    {
      label: "No F-1/J-1/CPT/OPT / no sponsorship",
      re: /\bno\s+F[-\s]?1\b|\bno\s+J[-\s]?1\b|\bno\s+(?:CPT|OPT)\b(?![-\s]?(?:in|out)\b)|\b(?:F[-\s]?1|J[-\s]?1|CPT|OPT)(?:\s*(?:\/|,|or|and)\s*(?:F[-\s]?1|J[-\s]?1|CPT|OPT))*\s+(?:candidates?\s+|students?\s+|visas?\s+)?(?:is\s+|are\s+|will\s+)?not\s+(?:be\s+)?(?:accepted|allowed|eligible|permitted|considered|supported)\b|\bF[-\s]?1\s*\/\s*J[-\s]?1\s+(?:are\s+)?not\b|\bnot\s+(?:able\s+to\s+|eligible\s+to\s+)?sponsor\b|\bdo(?:es)?\s+not\s+(?:offer\s+|provide\s+)?sponsor(?:ship)?\b(?!\s+for)|\bunable\s+to\s+sponsor\b|\bcannot\s+sponsor\b|\bsponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided)\b|\bwill\s+not\s+sponsor\b|\bno\s+(?:visa\s+)?sponsorship\b/i,
    },
    {
      label: "Applicant must not need sponsorship",
      re: /\b(?:does|do|must|should|cannot|can\s+not|should\s+not|will\s+not|shall\s+not)\s+not\s+(?:now\s+or\s+in\s+the\s+future\s+)?require\s+(?:visa\s+|employment\s+|immigration\s+)?sponsorship\b|\bwithout\s+(?:the\s+)?need(?:ing)?\s+(?:for\s+)?(?:visa\s+)?sponsorship\b|\bno\s+need\s+for\s+(?:visa\s+)?sponsorship\b|\b(?:candidates?|applicants?|you)\s+(?:who\s+|that\s+)?(?:do(?:es)?\s+not|must\s+not|should\s+not|cannot|can\s+not)\s+(?:now\s+or\s+in\s+the\s+future\s+)?require\s+sponsorship\b|\bmust\s+be\s+eligible\s+to\s+work\s+in\s+(?:the\s+)?(?:U\.?\s*S\.?|United\s+States)\s+without\s+sponsorship\b|\bauthorized\s+to\s+work\s+in\s+(?:the\s+)?(?:U\.?\s*S\.?|United\s+States)\s+without\s+(?:current\s+or\s+future\s+)?sponsorship\b/i,
    },
  ];

  // Combined regex for the walker (case-insensitive, global).
  const COMBINED_SRC = PATTERNS.map((p) => `(?:${p.re.source})`).join("|");

  let enabled = true;
  let scanScheduled = false;
  let observer = null;
  let mutating = false; // suppress observer during our own DOM writes
  let lastHref = location.href;

  // --- Overlay --------------------------------------------------------------
  function ensureOverlay(matchedLabels) {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        width: "100vw",
        height: "100vh",
        background: "rgba(220, 30, 30, 0.22)",
        pointerEvents: "none",
        zIndex: "2147483646",
        mixBlendMode: "multiply",
      });
      (document.body || document.documentElement).appendChild(overlay);
    }

    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement("div");
      badge.id = BADGE_ID;
      Object.assign(badge.style, {
        position: "fixed",
        top: "12px",
        right: "12px",
        background: "rgba(160, 0, 0, 0.92)",
        color: "#fff",
        font: "600 12px/1.3 system-ui, -apple-system, Segoe UI, sans-serif",
        padding: "8px 10px",
        borderRadius: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
        pointerEvents: "none",
        zIndex: "2147483647",
        maxWidth: "260px",
      });
      (document.body || document.documentElement).appendChild(badge);
    }
    badge.textContent = "Flagged: " + matchedLabels.join(", ");
  }

  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(BADGE_ID)?.remove();
  }

  // --- Highlighting ---------------------------------------------------------
  function unwrapHighlights() {
    const marks = document.querySelectorAll("mark." + HL_CLASS);
    marks.forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize?.();
    });
  }

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT",
    "SELECT", "OPTION", "IFRAME", "SVG", "CANVAS", "CODE", "PRE",
  ]);

  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const v = node.nodeValue;
        if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (p.closest("mark." + HL_CLASS)) return NodeFilter.FILTER_REJECT;
        if (p.closest("#" + OVERLAY_ID + ", #" + BADGE_ID))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function makeMark(text) {
    const mark = document.createElement("mark");
    mark.className = HL_CLASS;
    mark.textContent = text;
    Object.assign(mark.style, {
      background: "rgba(255, 220, 0, 0.9)",
      color: "#000",
      padding: "0 2px",
      borderRadius: "2px",
      boxShadow: "0 0 0 1px rgba(200, 0, 0, 0.6)",
    });
    return mark;
  }

  function highlightAndCount() {
    unwrapHighlights();
    const root = document.body || document.documentElement;
    if (!root) return { labels: [], hits: 0 };

    const combined = new RegExp(COMBINED_SRC, "gi");
    const nodes = collectTextNodes(root);
    const labels = new Set();
    let hits = 0;

    for (const node of nodes) {
      const text = node.nodeValue;
      combined.lastIndex = 0;
      if (!combined.test(text)) continue;

      // Determine which categorical labels this node triggers.
      for (const p of PATTERNS) {
        if (new RegExp(p.re.source, "i").test(text)) labels.add(p.label);
      }

      // Rewrite the text node into text + <mark> fragments.
      const localRe = new RegExp(COMBINED_SRC, "gi");
      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      while ((m = localRe.exec(text)) !== null) {
        if (m[0].length === 0) {
          localRe.lastIndex++;
          continue;
        }
        if (m.index > last) {
          frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        }
        frag.appendChild(makeMark(m[0]));
        last = m.index + m[0].length;
        hits++;
      }
      if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)));
      }
      node.parentNode?.replaceChild(frag, node);
    }

    return { labels: [...labels], hits };
  }

  // --- Scan orchestration --------------------------------------------------
  function scan() {
    scanScheduled = false;
    if (!enabled) {
      mutating = true;
      unwrapHighlights();
      removeOverlay();
      mutating = false;
      return;
    }

    mutating = true;
    try {
      const { labels, hits } = highlightAndCount();
      if (hits > 0) ensureOverlay(labels);
      else removeOverlay();
    } finally {
      mutating = false;
    }
  }

  function scheduleScan(delay = 300) {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(scan, delay);
  }

  function forceRescan() {
    mutating = true;
    unwrapHighlights();
    removeOverlay();
    mutating = false;
    scanScheduled = false;
    scheduleScan(80);
    setTimeout(() => scheduleScan(80), 700);
    setTimeout(() => scheduleScan(80), 1600);
  }

  // --- Observers ------------------------------------------------------------
  function startObserving() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      if (mutating) return;
      // Ignore mutations that are entirely inside our own overlay/mark nodes.
      for (const mu of mutations) {
        const t = mu.target;
        if (
          t &&
          t.nodeType === 1 &&
          (t.id === OVERLAY_ID ||
            t.id === BADGE_ID ||
            (t.classList && t.classList.contains(HL_CLASS)))
        ) {
          continue;
        }
        scheduleScan();
        return;
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function stopObserving() {
    observer?.disconnect();
    observer = null;
  }

  function hookHistory() {
    const fire = () => window.dispatchEvent(new Event("__cif_locationchange"));
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () {
      const r = origPush.apply(this, arguments);
      fire();
      return r;
    };
    history.replaceState = function () {
      const r = origReplace.apply(this, arguments);
      fire();
      return r;
    };
    window.addEventListener("popstate", fire);
    window.addEventListener("__cif_locationchange", forceRescan);
  }

  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      forceRescan();
    }
  }, 500);

  // --- Enable / disable -----------------------------------------------------
  function applyEnabled(val) {
    enabled = !!val;
    if (enabled) {
      startObserving();
      scheduleScan(80);
    } else {
      stopObserving();
      mutating = true;
      unwrapHighlights();
      removeOverlay();
      mutating = false;
    }
  }

  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area === "sync" && "enabled" in changes) {
      applyEnabled(changes.enabled.newValue !== false);
    }
  });

  hookHistory();
  chrome.storage?.sync.get({ enabled: true }, ({ enabled: val }) => {
    applyEnabled(val);
  });
})();
