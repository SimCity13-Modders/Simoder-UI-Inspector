(function (packetText) {
    try {
        var packet = JSON.parse(packetText || "{}");
        var op = packet.op || "init";
        var args = packet.args || {};

        function isInspectorNode(el) {
            var cur = el;
            if (cur && cur.nodeType !== 1) cur = cur.parentNode;
            while (cur && cur.nodeType === 1) {
                if (cur.getAttribute && cur.getAttribute("data-simoder-devtools") === "true") {
                    return true;
                }
                cur = cur.parentNode;
            }
            return false;
        }

        function escapeHtml(s) {
            return String(s || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
        }

        function buildSelector(el) {
            if (!el || el.nodeType !== 1) return "";
            if (el.id) return "#" + el.id;
            var parts = [];
            var cur = el;
            var guard = 0;
            while (cur && cur.nodeType === 1 && guard < 6) {
                var tag = String(cur.tagName || "div").toLowerCase();
                if (cur.id) {
                    parts.unshift("#" + cur.id);
                    break;
                }
                var cls = "";
                if (typeof cur.className === "string" && cur.className.replace(/\s+/g, " ").trim()) {
                    var tokens = cur.className.replace(/\s+/g, " ").trim().split(" ");
                    cls = "." + tokens.slice(0, 2).join(".");
                }
                var sibIdx = 1;
                var sib = cur.previousElementSibling;
                while (sib) {
                    if (sib.tagName === cur.tagName) sibIdx += 1;
                    sib = sib.previousElementSibling;
                }
                var nth = sibIdx > 1 ? ":nth-of-type(" + sibIdx + ")" : "";
                parts.unshift(tag + cls + nth);
                if (tag === "body") break;
                cur = cur.parentElement;
                guard += 1;
            }
            return parts.join(" > ");
        }

        function buildAncestors(el) {
            var list = [];
            var cur = el ? el.parentElement : null;
            var guard = 0;
            while (cur && cur.nodeType === 1 && guard < 8) {
                var tag = String(cur.tagName || "").toLowerCase();
                var label = tag;
                if (cur.id) label += "#" + cur.id;
                else if (typeof cur.className === "string" && cur.className.trim()) {
                    label += "." + cur.className.trim().split(/\s+/)[0];
                }
                list.unshift(label);
                cur = cur.parentElement;
                guard += 1;
            }
            return list;
        }

        function safeStyleCssText(style) {
            if (!style) return "";
            var parts = [];
            try {
                var len = typeof style.length === "number" ? style.length : 0;
                for (var i = 0; i < len && parts.length < 32; i++) {
                    var prop = String(style[i] || "");
                    if (!prop) continue;
                    // EAWebKit 2011 crashes at EAWebKit.dll+0x44ee6 inside CSSBorderImageValue::cssText()
                    if (prop.indexOf("border-image") !== -1) {
                        parts.push(prop + ": <border-image>");
                        continue;
                    }
                    try {
                        var val = style.getPropertyValue ? style.getPropertyValue(prop) : "";
                        if (val !== undefined && val !== null && String(val) !== "") {
                            parts.push(prop + ": " + String(val));
                        }
                    } catch (_eProp) {}
                }
            } catch (_eStyle) {}
            return parts.join("; ").slice(0, 512);
        }

        function collectMatchedCssRules(el) {
            var out = [];
            try {
                var matcher = el.matches || el.webkitMatchesSelector || el.mozMatchesSelector || el.msMatchesSelector;
                if (typeof matcher !== "function" || !document.styleSheets) {
                    return out;
                }
                var sheets = document.styleSheets;
                var inspected = 0;
                for (var si = sheets.length - 1; si >= 0 && out.length < 24 && inspected < 500; si--) {
                    var sheet = sheets[si];
                    if (!sheet) continue;
                    var rules = null;
                    try { rules = sheet.cssRules; } catch (_eSheet) { rules = null; }
                    if (!rules || !rules.length) continue;
                    for (var ri = rules.length - 1; ri >= 0 && out.length < 24 && inspected < 500; ri--) {
                        var r = rules[ri];
                        if (!r || r.type !== 1 || !r.selectorText || !r.style) continue;
                        var selText = String(r.selectorText);
                        if (selText.length > 256 || selText.indexOf("::") !== -1 || selText.indexOf("@") !== -1) continue;
                        inspected += 1;
                        try {
                            if (matcher.call(el, selText)) {
                                out.push({
                                    selector: selText,
                                    cssText: safeStyleCssText(r.style)
                                });
                            }
                        } catch (_eMatch) {}
                    }
                }
            } catch (_e) {}
            return out;
        }

        function collectComputedStyle(el) {
            var res = {};
            try {
                var cs = window.getComputedStyle(el, null);
                if (cs) {
                    var keys = [
                        "display", "position", "visibility", "opacity",
                        "width", "height", "margin", "padding",
                        "color", "backgroundColor", "fontSize", "fontFamily", "zIndex"
                    ];
                    for (var i = 0; i < keys.length; i++) {
                        res[keys[i]] = String(cs[keys[i]] || "");
                    }
                }
            } catch (_e) {}
            return res;
        }

        function collectSimoderMeta(el) {
            var meta = {};
            try {
                if (el && el.attributes) {
                    for (var i = 0; i < el.attributes.length; i++) {
                        var a = el.attributes[i];
                        if (a && a.name && (a.name.indexOf("data-simoder") === 0 || a.name === "data-slot")) {
                            meta[a.name] = String(a.value || "");
                        }
                    }
                }
            } catch (_e) {}
            return meta;
        }

        function serializeElement(el, includeStyles) {
            if (!el || el.nodeType !== 1 || isInspectorNode(el)) return null;
            var rect = { x: 0, y: 0, width: 0, height: 0 };
            try {
                var r = el.getBoundingClientRect();
                rect = {
                    x: Math.round(r.left),
                    y: Math.round(r.top),
                    width: Math.round(r.width),
                    height: Math.round(r.height)
                };
            } catch (_e) {}

            var outer = "";
            var descCount = el.getElementsByTagName ? el.getElementsByTagName("*").length : (el.children ? el.children.length : 0);
            if (descCount > 12) {
                var tagLower = String(el.tagName || "div").toLowerCase();
                var attrs = "";
                if (el.id) attrs += " id=\"" + escapeHtml(el.id) + "\"";
                if (typeof el.className === "string" && el.className.trim()) {
                    attrs += " class=\"" + escapeHtml(el.className.trim()) + "\"";
                }
                outer = "<" + tagLower + attrs + "><!-- " + descCount + " descendant elements (summary) --></" + tagLower + ">";
            } else {
                try { outer = String(el.outerHTML || ""); } catch (_e2) {}
                if (outer.length > 2048) outer = outer.slice(0, 2048) + "<!-- truncated -->";
            }

            var matched = includeStyles ? collectMatchedCssRules(el) : [];
            var computed = includeStyles ? collectComputedStyle(el) : {};
            var sel = buildSelector(el);
            var ancestors = buildAncestors(el);
            var simMeta = collectSimoderMeta(el);

            var md = [
                "### Simoder UI Inspector Selection",
                "- **Selector**: `" + sel + "`",
                "- **Ancestors**: `" + ancestors.join(" > ") + "`",
                "- **Rect**: `" + rect.x + ", " + rect.y + " (" + rect.width + "x" + rect.height + ")`"
            ];
            if (Object.keys(simMeta).length > 0) {
                md.push("- **Simoder Metadata**: `" + JSON.stringify(simMeta) + "`");
            }
            if (matched.length > 0) {
                md.push("", "#### Matched CSS Rules");
                for (var i = 0; i < matched.length && i < 10; i++) {
                    md.push("- `" + matched[i].selector + "` -> `" + matched[i].cssText + "`");
                }
            }
            if (outer) {
                md.push("", "#### outerHTML", "```html", outer, "```");
            }

            return {
                tag: String(el.tagName || "").toLowerCase(),
                id: String(el.id || ""),
                className: typeof el.className === "string" ? el.className : "",
                selector: sel,
                ancestors: ancestors,
                rect: rect,
                outerHtml: outer,
                matchedCssRules: matched,
                computedStyle: computed,
                simoderMetadata: simMeta,
                aiContextMarkdown: md.join("\n")
            };
        }

        function cleanupOldState() {
            var old = window.__simoderUiInspector;
            if (!old) return;
            try {
                if (old.onMouseMove) {
                    document.removeEventListener("mousemove", old.onMouseMove, true);
                    window.removeEventListener("mousemove", old.onMouseMove, true);
                }
                if (old.onMouseDown) document.removeEventListener("mousedown", old.onMouseDown, true);
                if (old.onMouseUp) {
                    document.removeEventListener("mouseup", old.onMouseUp, true);
                    window.removeEventListener("mouseup", old.onMouseUp, true);
                }
                if (old.onClick) document.removeEventListener("click", old.onClick, true);
                if (old.onKeyDown) document.removeEventListener("keydown", old.onKeyDown, true);
                if (old.shieldEl && old.shieldEl.parentNode) old.shieldEl.parentNode.removeChild(old.shieldEl);
                if (old.highlightEl && old.highlightEl.parentNode) old.highlightEl.parentNode.removeChild(old.highlightEl);
                if (old.tooltipEl && old.tooltipEl.parentNode) old.tooltipEl.parentNode.removeChild(old.tooltipEl);
                if (old.rootEl && old.rootEl.parentNode) old.rootEl.parentNode.removeChild(old.rootEl);
            } catch (_e3) {}
            delete window.__simoderUiInspector;
        }

        function stopEv(ev) {
            if (!ev) return;
            if (ev.preventDefault) ev.preventDefault();
            if (ev.stopPropagation) ev.stopPropagation();
            if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
            ev.cancelBubble = true;
        }

        function ensureState() {
            if (window.__simoderUiInspector && window.__simoderUiInspector.version === 16) {
                return window.__simoderUiInspector;
            }
            cleanupOldState();
            var st = {
                version: 16,
                panelOpen: false,
                pickMode: false,
                drag: null,
                selectedEl: null,
                selectedData: null,
                pendingClipboard: null,
                keybinds: {
                    toggle_panel: "Ctrl+Alt+I",
                    toggle_picker: "Ctrl+Shift+O"
                },
                shieldEl: null,
                rootEl: null,
                highlightEl: null,
                tooltipEl: null,
                bodyEl: null,
                onMouseMove: null,
                onMouseDown: null,
                onMouseUp: null,
                onClick: null,
                onKeyDown: null,
                setPickMode: null
            };

            var shield = document.createElement("div");
            shield.setAttribute("data-simoder-devtools", "true");
            shield.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99994;background:rgba(0,0,0,0.001);cursor:crosshair;pointer-events:auto;display:none;";
            document.body.appendChild(shield);
            st.shieldEl = shield;

            var hl = document.createElement("div");
            hl.setAttribute("data-simoder-devtools", "true");
            hl.style.cssText = "position:fixed;pointer-events:none;z-index:99995;border:2px solid #38bdf8;background:rgba(56,189,248,0.16);display:none;box-sizing:border-box;";
            document.body.appendChild(hl);
            st.highlightEl = hl;

            var tt = document.createElement("div");
            tt.setAttribute("data-simoder-devtools", "true");
            tt.style.cssText = "position:fixed;pointer-events:none;z-index:99996;background:#0f172a;color:#e2e8f0;border:1px solid #38bdf8;font:11px/1.3 Consolas,monospace;padding:3px 6px;border-radius:3px;display:none;white-space:nowrap;";
            document.body.appendChild(tt);
            st.tooltipEl = tt;

            var viewW = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1280;
            var viewH = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 720;
            var initLeft = Math.max(8, viewW - 420);
            var maxPanelH = Math.max(260, viewH - 96);
            var maxBodyH = Math.max(200, maxPanelH - 44);
            var panel = document.createElement("div");
            panel.setAttribute("data-simoder-devtools", "true");
            panel.style.cssText = "position:fixed;top:72px;left:" + initLeft + "px;width:400px;max-height:" + maxPanelH + "px;z-index:99997;pointer-events:auto;background:rgba(15,23,42,0.96);color:#e2e8f0;border:1px solid #475569;-webkit-border-radius:4px;border-radius:4px;font:12px/1.4 Consolas,monospace;display:none;-webkit-box-shadow:0 4px 10px rgba(0,0,0,0.42);box-shadow:0 4px 10px rgba(0,0,0,0.42);";
            panel.innerHTML =
                "<div id='sd-ins-header' style='padding:8px 10px;background:#1e293b;border-bottom:1px solid #334155;overflow:hidden;cursor:move;-webkit-user-select:none;user-select:none;'>" +
                "<span id='sd-ins-title' style='font-weight:bold;color:#38bdf8;float:left;line-height:22px;'>Simoder UI Inspector</span>" +
                "<div style='float:right;'>" +
                "<button id='sd-ins-pick' type='button' style='margin-right:4px;padding:3px 8px;background:#0284c7;color:#fff;border:0;border-radius:3px;cursor:pointer;'>Pick</button>" +
                "<button id='sd-ins-copy' type='button' style='margin-right:4px;padding:3px 8px;background:#16a34a;color:#fff;border:0;border-radius:3px;cursor:pointer;'>Copy for AI</button>" +
                "<button id='sd-ins-close' type='button' style='padding:3px 8px;background:#475569;color:#fff;border:0;border-radius:3px;cursor:pointer;'>X</button>" +
                "</div></div>" +
                "<div id='sd-ins-body' style='padding:10px;overflow-y:auto;max-height:" + maxBodyH + "px;word-break:break-word;clear:both;'>Click <b>Pick</b> or press <b>Ctrl+Shift+O</b> to inspect any element.</div>";
            document.body.appendChild(panel);
            st.rootEl = panel;
            st.bodyEl = document.getElementById("sd-ins-body");

            function setPickMode(active) {
                st.pickMode = !!active;
                st.shieldEl.style.display = st.pickMode ? "block" : "none";
                if (!st.pickMode) {
                    st.highlightEl.style.display = "none";
                    st.tooltipEl.style.display = "none";
                }
            }
            st.setPickMode = setPickMode;

            function closePanel() {
                st.panelOpen = false;
                setPickMode(false);
                st.rootEl.style.display = "none";
            }

            function elementUnderPoint(x, y) {
                var wasShield = st.shieldEl.style.display;
                st.shieldEl.style.display = "none";
                var el = document.elementFromPoint(x, y);
                st.shieldEl.style.display = wasShield;
                return el;
            }

            function positionHighlight(el) {
                if (!el || el.nodeType !== 1 || isInspectorNode(el)) {
                    st.highlightEl.style.display = "none";
                    st.tooltipEl.style.display = "none";
                    return;
                }
                var r = el.getBoundingClientRect();
                st.highlightEl.style.left = Math.round(r.left) + "px";
                st.highlightEl.style.top = Math.round(r.top) + "px";
                st.highlightEl.style.width = Math.max(2, Math.round(r.width)) + "px";
                st.highlightEl.style.height = Math.max(2, Math.round(r.height)) + "px";
                st.highlightEl.style.display = "block";

                var label = String(el.tagName || "").toLowerCase();
                if (el.id) label += "#" + el.id;
                else if (typeof el.className === "string" && el.className.trim()) {
                    label += "." + el.className.trim().split(/\s+/)[0];
                }
                label += " (" + Math.round(r.width) + "x" + Math.round(r.height) + ")";
                st.tooltipEl.textContent = label;
                st.tooltipEl.style.left = Math.max(4, Math.round(r.left)) + "px";
                st.tooltipEl.style.top = Math.max(4, Math.round(r.top) - 22) + "px";
                st.tooltipEl.style.display = "block";
            }

            function renderSelection(el) {
                st.selectedEl = el;
                st.selectedData = serializeElement(el, true);
                if (!st.selectedData || !st.bodyEl) return;
                var d = st.selectedData;
                var rulesHtml = "";
                for (var i = 0; i < d.matchedCssRules.length && i < 12; i++) {
                    var mr = d.matchedCssRules[i];
                    rulesHtml += "<div style='margin-bottom:4px;padding:4px;background:#0f172a;border-left:2px solid #38bdf8;'>" +
                        "<div style='color:#7dd3fc;'>" + escapeHtml(mr.selector) + "</div>" +
                        "<div style='color:#cbd5e1;'>" + escapeHtml(mr.cssText) + "</div></div>";
                }
                st.bodyEl.innerHTML =
                    "<div style='color:#94a3b8;margin-bottom:6px;'>" + escapeHtml(d.ancestors.join(" > ")) + "</div>" +
                    "<div style='color:#38bdf8;font-weight:bold;margin-bottom:6px;'>" + escapeHtml(d.selector) + " (" + d.rect.width + "x" + d.rect.height + ")</div>" +
                    "<div style='margin-bottom:6px;color:#f8fafc;font-weight:bold;'>Styles (Matched CSS)</div>" +
                    (rulesHtml || "<div style='color:#64748b;'>No matched rules</div>") +
                    "<div style='margin-top:8px;margin-bottom:4px;color:#f8fafc;font-weight:bold;'>outerHTML</div>" +
                    "<pre style='margin:0;padding:6px;background:#020617;color:#a5f3fc;white-space:pre-wrap;max-height:180px;overflow:auto;'>" + escapeHtml(d.outerHtml) + "</pre>";
            }

            st.renderSelection = renderSelection;
            st.positionHighlight = positionHighlight;

            var headerEl = document.getElementById("sd-ins-header");
            var pickBtn = document.getElementById("sd-ins-pick");
            var copyBtn = document.getElementById("sd-ins-copy");
            var closeBtn = document.getElementById("sd-ins-close");

            panel.ondragstart = function () { return false; };
            panel.onmousedown = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); if (ev) ev.cancelBubble = true; };
            panel.onmouseup = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); if (ev) ev.cancelBubble = true; };
            panel.onclick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); if (ev) ev.cancelBubble = true; };

            if (headerEl) {
                headerEl.ondragstart = function () { return false; };
                headerEl.onselectstart = function () { return false; };
            }

            pickBtn.onmousedown = function (ev) {
                stopEv(ev);
                setPickMode(!st.pickMode);
            };
            pickBtn.onclick = stopEv;

            copyBtn.onmousedown = function (ev) {
                stopEv(ev);
                if (st.selectedData && st.selectedData.aiContextMarkdown) {
                    st.pendingClipboard = st.selectedData.aiContextMarkdown;
                    copyBtn.textContent = "Copied!";
                    if (typeof window.setTimeout === "function") {
                        window.setTimeout(function () {
                            if (copyBtn) copyBtn.textContent = "Copy for AI";
                        }, 1000);
                    }
                }
            };
            copyBtn.onclick = stopEv;

            closeBtn.onmousedown = function (ev) {
                stopEv(ev);
                closePanel();
            };
            closeBtn.onclick = stopEv;

            var titleEl = document.getElementById("sd-ins-title");
            function setTitleMoving(moving) {
                if (titleEl) {
                    titleEl.textContent = moving ? "Moving..." : "Simoder UI Inspector";
                }
            }

            function updateDragPosition(ev, _src) {
                if (!st.drag) return;
                var vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1280;
                var vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 720;
                var nx = Math.max(4, Math.min(vw - 80, Math.round(ev.clientX - st.drag.dx)));
                var ny = Math.max(4, Math.min(vh - 40, Math.round(ev.clientY - st.drag.dy)));
                panel.style.setProperty("left", nx + "px", "important");
                panel.style.setProperty("top", ny + "px", "important");
            }

            function cancelDrag() {
                st.drag = null;
                setTitleMoving(false);
            }

            function finishDrag(ev, _src) {
                if (!st.drag) return false;
                cancelDrag();
                stopEv(ev);
                return true;
            }

            panel.onmousemove = function (ev) {
                if (st.drag) {
                    updateDragPosition(ev, "panel");
                }
            };

            shield.onmousemove = function (ev) {
                if (st.drag) {
                    updateDragPosition(ev, "shield");
                    return;
                }
                if (!st.pickMode) return;
                var target = elementUnderPoint(ev.clientX, ev.clientY);
                if (target && !isInspectorNode(target)) {
                    positionHighlight(target);
                }
            };
            shield.onmousedown = function (ev) {
                if (!st.pickMode) return;
                stopEv(ev);
            };
            shield.onmouseup = function (ev) {
                if (finishDrag(ev, "shield")) return;
                stopEv(ev);
            };
            shield.onclick = stopEv;

            function isPanelNode(el) {
                if (!st.rootEl || !el) return false;
                var cur = el.nodeType === 1 ? el : el.parentNode;
                return cur === st.rootEl || (cur && st.rootEl.contains ? st.rootEl.contains(cur) : false);
            }

            function isButtonTarget(el) {
                var cur = el;
                if (cur && cur.nodeType !== 1) cur = cur.parentNode;
                while (cur && cur.nodeType === 1) {
                    if (String(cur.tagName || "").toUpperCase() === "BUTTON") return true;
                    if (cur === headerEl || cur === panel) break;
                    cur = cur.parentNode;
                }
                return false;
            }

            function isHeaderDragTarget(el, ev) {
                if (!st.panelOpen || !headerEl) return false;
                if (isButtonTarget(el)) return false;
                var cur = el;
                if (cur && cur.nodeType !== 1) cur = cur.parentNode;
                while (cur && cur.nodeType === 1) {
                    if (cur === headerEl) return true;
                    cur = cur.parentNode;
                }
                if (ev && typeof headerEl.getBoundingClientRect === "function") {
                    var hr = headerEl.getBoundingClientRect();
                    if (ev.clientX >= hr.left && ev.clientX <= hr.right && ev.clientY >= hr.top && ev.clientY <= hr.bottom) {
                        return true;
                    }
                }
                return false;
            }

            st.onMouseMove = function (ev) {
                if (st.drag) {
                    updateDragPosition(ev, "doc");
                    return;
                }
                if (!st.pickMode) return;
                var target = elementUnderPoint(ev.clientX, ev.clientY);
                if (target && !isInspectorNode(target)) {
                    positionHighlight(target);
                }
            };
            function completePick(target) {
                var apply = function () {
                    setPickMode(false);
                    st.panelOpen = true;
                    st.rootEl.style.display = "block";
                    if (target && !isInspectorNode(target)) {
                        positionHighlight(target);
                        renderSelection(target);
                    }
                };
                if (typeof window.setTimeout === "function") {
                    window.setTimeout(apply, 0);
                } else {
                    apply();
                }
            }

            st.onMouseDown = function (ev) {
                var tgt = ev ? (ev.target || ev.srcElement) : null;
                if (isHeaderDragTarget(tgt, ev)) {
                    stopEv(ev);
                    var r = panel.getBoundingClientRect();
                    panel.style.setProperty("left", Math.round(r.left) + "px", "important");
                    panel.style.setProperty("top", Math.round(r.top) + "px", "important");
                    st.drag = {
                        dx: ev.clientX - r.left,
                        dy: ev.clientY - r.top
                    };
                    setTitleMoving(true);
                    return;
                }
                if (isPanelNode(tgt)) {
                    return;
                }
                if (!st.pickMode) return;
                stopEv(ev);
                var target = elementUnderPoint(ev.clientX, ev.clientY) || tgt;
                completePick(target);
            };
            st.onMouseUp = function (ev) {
                if (finishDrag(ev, "doc")) return;
                var tgt = ev ? (ev.target || ev.srcElement) : null;
                if (isPanelNode(tgt)) {
                    return;
                }
                if (st.pickMode) {
                    stopEv(ev);
                }
            };
            st.onClick = function (ev) {
                var tgt = ev ? (ev.target || ev.srcElement) : null;
                if (isPanelNode(tgt)) {
                    return;
                }
                if (st.pickMode) {
                    stopEv(ev);
                }
            };
            function eventToChord(ev) {
                var c = ev ? (ev.keyCode || ev.which) : 0;
                if (c === 16 || c === 17 || c === 18 || c === 91 || c === 92) return "";
                var tok = null;
                if (c >= 65 && c <= 90) tok = String.fromCharCode(c);
                else if (c >= 48 && c <= 57) tok = String.fromCharCode(c);
                else if (c >= 112 && c <= 123) tok = "F" + String(c - 111);
                else {
                    var map = {
                        32: "Space", 13: "Enter", 9: "Tab", 27: "Esc", 8: "Backspace",
                        46: "Delete", 45: "Insert", 36: "Home", 35: "End", 33: "PageUp",
                        34: "PageDown", 38: "Up", 40: "Down", 37: "Left", 39: "Right",
                        192: "Backquote", 189: "Minus", 187: "Equal", 219: "BracketLeft",
                        221: "BracketRight", 186: "Semicolon", 222: "Quote", 188: "Comma",
                        190: "Period", 191: "Slash", 220: "Backslash"
                    };
                    tok = map[c] || null;
                }
                if (!tok) return "";
                var parts = [];
                if (ev.ctrlKey) parts.push("Ctrl");
                if (ev.altKey) parts.push("Alt");
                if (ev.shiftKey) parts.push("Shift");
                parts.push(tok);
                return parts.join("+");
            }
            st.onKeyDown = function (ev) {
                var code = ev ? (ev.keyCode || ev.which) : 0;
                if (code === 27) {
                    if (st.drag) {
                        stopEv(ev);
                        cancelDrag();
                        return;
                    }
                    if (st.pickMode) {
                        stopEv(ev);
                        setPickMode(false);
                        return;
                    }
                    if (st.panelOpen) {
                        stopEv(ev);
                        closePanel();
                        return;
                    }
                }
                var chord = eventToChord(ev);
                if (!chord) return;
                if (st.keybinds.toggle_picker && chord === st.keybinds.toggle_picker) {
                    stopEv(ev);
                    setPickMode(!st.pickMode);
                } else if (st.keybinds.toggle_panel && chord === st.keybinds.toggle_panel) {
                    stopEv(ev);
                    st.panelOpen = !st.panelOpen;
                    st.rootEl.style.display = st.panelOpen ? "block" : "none";
                    if (!st.panelOpen) {
                        setPickMode(false);
                    }
                }
            };

            document.addEventListener("mousemove", st.onMouseMove, true);
            window.addEventListener("mousemove", st.onMouseMove, true);
            document.addEventListener("mousedown", st.onMouseDown, true);
            document.addEventListener("mouseup", st.onMouseUp, true);
            window.addEventListener("mouseup", st.onMouseUp, true);
            document.addEventListener("click", st.onClick, true);
            document.addEventListener("keydown", st.onKeyDown, true);

            window.__simoderUiInspector = st;
            return st;
        }

        if (op === "destroy") {
            cleanupOldState();
            return JSON.stringify({ ok: true, result: { destroyed: true } });
        }

        var st = ensureState();

        if (op === "init" || op === "keybinds_updated") {
            if (args.keybinds && typeof args.keybinds === "object") {
                st.keybinds.toggle_panel = args.keybinds.toggle_panel || "";
                st.keybinds.toggle_picker = args.keybinds.toggle_picker || "";
                if (!st.selectedData && st.bodyEl) {
                    var hint = st.keybinds.toggle_picker || "Unbound";
                    st.bodyEl.innerHTML = "Click <b>Pick</b> or press <b>" + escapeHtml(hint) + "</b> to inspect any element.";
                }
            }
            return JSON.stringify({ ok: true, result: { initialized: true, keybinds: st.keybinds } });
        }

        if (op === "drag_move") {
            var panelRect = null;
            if (st.rootEl) {
                var dvw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 900;
                var dvh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 576;
                var curR = st.rootEl.getBoundingClientRect();
                var dxPx = (typeof args.dx === "number" ? args.dx : 0) * dvw;
                var dyPx = (typeof args.dy === "number" ? args.dy : 0) * dvh;
                var dnx = Math.max(4, Math.min(dvw - 80, Math.round(curR.left + dxPx)));
                var dny = Math.max(4, Math.min(dvh - 40, Math.round(curR.top + dyPx)));
                st.rootEl.style.setProperty("left", dnx + "px", "important");
                st.rootEl.style.setProperty("top", dny + "px", "important");
                var movedR = st.rootEl.getBoundingClientRect();
                panelRect = { left: Math.round(movedR.left), top: Math.round(movedR.top), width: Math.round(movedR.width), height: Math.round(movedR.height) };
            }
            return JSON.stringify({
                ok: true,
                result: {
                    panelRect: panelRect
                }
            });
        }

        if (op === "poll_clipboard") {
            var clip = st.pendingClipboard;
            st.pendingClipboard = null;
            var overlayRect = null;
            var dragHandleRect = null;
            var ovw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 900;
            var ovh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 576;
            if (st.pickMode || st.drag) {
                overlayRect = { left: 0, top: 0, right: 1, bottom: 1 };
            } else if (st.panelOpen && st.rootEl) {
                var oRect = st.rootEl.getBoundingClientRect();
                if (ovw > 0 && ovh > 0) {
                    overlayRect = {
                        left: oRect.left / ovw,
                        top: oRect.top / ovh,
                        right: oRect.right / ovw,
                        bottom: oRect.bottom / ovh
                    };
                    var hdrNode = document.getElementById("sd-ins-header");
                    var firstBtn = document.getElementById("sd-ins-pick");
                    if (hdrNode && ovw > 0 && ovh > 0) {
                        var hRect = hdrNode.getBoundingClientRect();
                        var rightEdge = firstBtn ? (firstBtn.getBoundingClientRect().left - 4) : hRect.right;
                        if (rightEdge > hRect.left + 16) {
                            dragHandleRect = {
                                left: hRect.left / ovw,
                                top: hRect.top / ovh,
                                right: rightEdge / ovw,
                                bottom: hRect.bottom / ovh
                            };
                        }
                    }
                }
            }
            return JSON.stringify({
                ok: true,
                result: {
                    clipboardText: clip,
                    overlayActive: !!(st.panelOpen || st.pickMode),
                    overlayRect: overlayRect,
                    dragHandleRect: dragHandleRect
                }
            });
        }

        if (op === "toggle") {
            if (typeof args.enabled === "boolean") {
                st.panelOpen = args.enabled;
                st.rootEl.style.display = st.panelOpen ? "block" : "none";
            }
            if (typeof args.pickMode === "boolean") {
                st.setPickMode(args.pickMode);
            }
            var pr = st.rootEl.getBoundingClientRect();
            return JSON.stringify({
                ok: true,
                result: {
                    enabled: st.panelOpen,
                    pickMode: st.pickMode,
                    dragActive: !!st.drag,
                    panelRect: { left: Math.round(pr.left), top: Math.round(pr.top), width: Math.round(pr.width), height: Math.round(pr.height) }
                }
            });
        }

        if (op === "get_selection") {
            if (st.selectedEl && document.body.contains(st.selectedEl)) {
                st.selectedData = serializeElement(st.selectedEl, true);
            }
            var selResult = st.selectedData;
            if (args.copyToClipboard === true && selResult && selResult.aiContextMarkdown) {
                st.pendingClipboard = selResult.aiContextMarkdown;
                selResult.clipboardText = selResult.aiContextMarkdown;
            }
            return JSON.stringify({ ok: true, result: selResult });
        }

        if (op === "query_dom") {
            var qSel = String(args.selector || "").trim();
            if (!qSel || qSel.length > 512) {
                return JSON.stringify({ ok: false, error: "selector must be 1..=512 chars" });
            }
            var lim = typeof args.limit === "number" ? Math.max(1, Math.min(64, Math.floor(args.limit))) : 20;
            var incStyles = args.includeStyles === true;
            var nodes = document.querySelectorAll(qSel);
            var matches = [];
            for (var qi = 0; qi < nodes.length && matches.length < lim; qi++) {
                var item = serializeElement(nodes[qi], incStyles);
                if (item) matches.push(item);
            }
            return JSON.stringify({ ok: true, result: { selector: qSel, count: matches.length, matches: matches } });
        }

        if (op === "get_dom_tree") {
            var rootSel = String(args.rootSelector || "body").trim() || "body";
            var maxD = typeof args.maxDepth === "number" ? Math.max(1, Math.min(8, Math.floor(args.maxDepth))) : 4;
            var maxN = typeof args.maxNodes === "number" ? Math.max(1, Math.min(200, Math.floor(args.maxNodes))) : 120;
            var rootNode = document.querySelector(rootSel);
            if (!rootNode) {
                return JSON.stringify({ ok: false, error: "rootSelector not found: " + rootSel });
            }
            var visited = 0;
            function walkDom(node, depth) {
                if (!node || node.nodeType !== 1 || isInspectorNode(node) || visited >= maxN) return null;
                visited += 1;
                var entry = {
                    tag: String(node.tagName || "").toLowerCase(),
                    id: String(node.id || ""),
                    className: typeof node.className === "string" ? node.className : "",
                    childCount: node.children ? node.children.length : 0,
                    children: []
                };
                if (depth < maxD && node.children) {
                    for (var ci = 0; ci < node.children.length && visited < maxN; ci++) {
                        var child = walkDom(node.children[ci], depth + 1);
                        if (child) entry.children.push(child);
                    }
                }
                return entry;
            }
            return JSON.stringify({ ok: true, result: { rootSelector: rootSel, nodeCount: visited, tree: walkDom(rootNode, 0) } });
        }

        if (op === "highlight") {
            var hSel = String(args.selector || "").trim();
            if (!hSel || hSel.length > 512) {
                return JSON.stringify({ ok: false, error: "selector must be 1..=512 chars" });
            }
            var hEl = document.querySelector(hSel);
            if (!hEl || isInspectorNode(hEl)) {
                return JSON.stringify({ ok: false, error: "element not found for selector: " + hSel });
            }
            st.positionHighlight(hEl);
            if (args.select !== false) {
                st.renderSelection(hEl);
            }
            return JSON.stringify({ ok: true, result: serializeElement(hEl, true) });
        }

        return JSON.stringify({ ok: false, error: "unknown inspector op: " + op });
    } catch (err) {
        return JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) });
    }
})
