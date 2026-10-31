(function(HF) {
    let sequence = 0;
    const colors = { comment: ['#57606a','#9da7b1'], string: ['#0a3069','#a5d6ff'], keyword: ['#cf222e','#ff7b72'], number: ['#0550ae','#79c0ff'], function: ['#8250df','#d2a8ff'], property: ['#953800','#ffa657'], tag: ['#116329','#7ee787'], operator: ['#24292f','#e6edf3'] };
    const bufferLines = 50, characterBudget = 2097152;
    HF.prism_language = function(path, text) {
        var language = HF.wm_editor_language(path, text).language;
        return ['javascript', 'json', 'css', 'markup', 'bash', 'lua', 'yaml', 'ini', 'uci', 'ucode', 'nginx'].includes(language) ? language : '';
    };
    HF.apply_prism_to_windows = function() {
        var on = HF.state.preferences.editor_prism === 1;
        (HF.window_manager && HF.window_manager.records || []).forEach(function(record) {
            if (!record.closed && record.options && record.options.applyPrism) record.options.applyPrism(on);
        });
    };
    HF.bind_prism_highlight = function(editor, path) {
        const prefix = 'hf-prism-' + (++sequence) + '-', names = Object.keys(colors);
        const supported = !!(window.CSS && CSS.highlights && window.Highlight);
        let language = HF.prism_language(path), explicitLanguage = null, enabled = HF.state.preferences.editor_prism === 1;
        let composing = false, disposed = false, dirty = true, revision = 0, serial = 0;
        let timer, frame, editFrame, deadline, viewDeadline, worker, mapping, analysisText, analysisLanguage;
        let assets, loading = false, analysisDue = false, workers = 0;
        let painting = null, rangePool = new Map(), highlightSets = new Map();
        let ready = false, analyzing = false, wanted = null, sent = false, key = '', margin = bufferLines;
        let analyses = 0, maps = 0, tokenMs = 0, totalRanges = 0, viewportMs = 0;
        const style = document.createElement('style');
        style.textContent = names.map(name => '.fm-memory-contenteditable::highlight(' + prefix + name + '){color:' + colors[name][0] + '}html[data-harbor-theme="dark"] .fm-memory-contenteditable::highlight(' + prefix + name + '){color:' + colors[name][1] + '}').join('\n');
        document.head.appendChild(style);
        const control = { status: {}, refresh: () => invalidate(0), setLanguage: value => {
            explicitLanguage = value;
            if (language !== value) { language = value; stopWorker(); invalidate(0, true); }
        }, setEnabled: value => { if (enabled !== !!value) { enabled = !!value; invalidate(0); } }, dispose };
        function status(state, detail = {}) {
            control.status = Object.assign({ state, revision, language, supported, analyses, workers, maps, totalRanges, tokenizeMs: tokenMs }, detail);
        }
        function clear() {
            if (supported) names.forEach(name => CSS.highlights.delete(prefix + name));
            painting = null;
            rangePool.clear();
            highlightSets.clear();
        }
        function stopWorker() {
            clearTimeout(deadline);
            clearTimeout(viewDeadline);
            if (worker) worker.terminate();
            worker = null;
            ready = analyzing = sent = false;
            wanted = null;
            analysisText = analysisLanguage = null;
            key = '';
        }
        function invalidate(delay = 80, reset = false) {
            if (disposed) return;
            serial++;
            dirty = true;
            wanted = null;
            key = '';
            margin = bufferLines;
            analysisDue = false;
            clearTimeout(timer);
            if (reset) clear();
            if (!enabled || !supported) {
                stopWorker(); clear(); mapping = null;
                status(!enabled ? 'disabled' : 'unsupported');
                return;
            }
            status(composing ? 'composing' : 'pending', { ranges: rangePool.size, provisional: !!painting });
            if (!editFrame) editFrame = requestAnimationFrame(function() { editFrame = null; refresh(); });
            if (!composing) timer = setTimeout(function() { analysisDue = true; refresh(); }, delay);
        }
        function textMap() {
            maps++;
            const nodes = [];
            let text = '', valid = true, large = false;
            function visit(node, skip) {
                if (!valid || large) return;
                if (node.nodeType === 3) {
                    if (text.length + node.length > characterBudget) { large = true; return; }
                    nodes.push({ node, start: text.length, end: text.length + node.length, skip });
                    text += node.nodeValue;
                } else if (node.nodeType === 1 && node.tagName === 'BR') {
                    if (!node.hasAttribute('data-fm-editor-tail')) text += '\n';
                    if (text.length > characterBudget) large = true;
                } else if (node === editor || node.nodeType === 1 && node.tagName === 'SPAN') {
                    const excluded = skip || node !== editor && node.classList.contains('fm-memory-text-match');
                    for (const child of node.childNodes) { visit(child, excluded); if (!valid || large) break; }
                } else valid = false;
            }
            visit(editor, false);
            if (large) return { large: true };
            if (!valid || text !== HF.wm_editor_text(editor)) return null;
            const lines = [0];
            for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) lines.push(at + 1);
            const anchors = [];
            for (let line = 0; line < lines.length && anchors.length < 2; line++)
                if ((line + 1 < lines.length ? lines[line + 1] - 1 : text.length) > lines[line]) anchors.push(line);
            return { nodes, text, lines, anchors, horizontal: new Map() };
        }
        function rangeKey(group, start, end, index) { return group + ':' + start + ':' + end + ':' + index; }
        function paint(spans, provisional) {
            const nodes = mapping.nodes, next = new Map(), used = new Set();
            let count = 0, reused = 0;
            for (const [start, end, group] of spans) {
                if (!names.includes(group)) continue;
                for (let i = nodeIndex(start); i < nodes.length && nodes[i].start < end; i++) {
                    const n = nodes[i], a = Math.max(start, n.start), b = Math.min(end, n.end);
                    if (n.skip || b <= a) continue;
                    if (++count > 12000) { viewLimit(); return null; }
                    const id = rangeKey(group, a, b, i), previous = rangePool.get(id);
                    let range = previous && previous.range;
                    if (range && range.startContainer === n.node && range.endContainer === n.node &&
                            range.startOffset === a - n.start && range.endOffset === b - n.start) reused++;
                    else {
                        range = document.createRange();
                        range.setStart(n.node, a - n.start);
                        range.setEnd(n.node, b - n.start);
                    }
                    next.set(id, { range, group, start: a, end: b });
                    used.add(range);
                }
            }
            highlightSets.forEach(function(highlight) {
                for (const range of highlight) if (!used.has(range)) highlight.delete(range);
            });
            next.forEach(function(entry) {
                let highlight = highlightSets.get(entry.group);
                if (!highlight) { highlight = new Highlight(); highlightSets.set(entry.group, highlight); CSS.highlights.set(prefix + entry.group, highlight); }
                if (!highlight.has(entry.range)) highlight.add(entry.range);
            });
            highlightSets.forEach(function(highlight, group) {
                if (!highlight.size) { CSS.highlights.delete(prefix + group); highlightSets.delete(group); }
            });
            rangePool = next;
            painting = { text: mapping.text, language, spans };
            return { ranges: count, reusedRanges: reused, createdRanges: count - reused, provisional };
        }
        function rebasePainting() {
            if (!painting) return;
            if (painting.language !== language) { clear(); return; }
            const old = painting.text, text = mapping.text;
            let spans = painting.spans;
            if (old !== text) {
                let first = 0, oldEnd = old.length, newEnd = text.length;
                while (first < oldEnd && first < newEnd && old.charCodeAt(first) === text.charCodeAt(first)) first++;
                while (oldEnd > first && newEnd > first && old.charCodeAt(oldEnd - 1) === text.charCodeAt(newEnd - 1)) { oldEnd--; newEnd--; }
                const delta = newEnd - oldEnd;
                function move(start, end) {
                    if (end <= first) return [start, end];
                    if (start >= oldEnd) return [start + delta, end + delta];
                    if (start < first && end > oldEnd) return [start, end + delta];
                    if (start < first) return [start, first];
                    if (end > oldEnd) return [newEnd, end + delta];
                    return null;
                }
                spans = spans.map(function(span) { const moved = move(span[0], span[1]); return moved && [moved[0], moved[1], span[2]]; }).filter(Boolean);
                const shifted = new Map();
                rangePool.forEach(function(entry) {
                    const moved = move(entry.start, entry.end);
                    if (moved) shifted.set(rangeKey(entry.group, moved[0], moved[1], nodeIndex(moved[0])), entry);
                });
                rangePool = shifted;
            }
            const detail = paint(spans, old !== text || analyzing);
            if (detail) status(composing ? 'composing' : 'pending', detail);
        }
        function refresh() {
            if (disposed || !enabled || !supported || !editor.isConnected) return;
            if (dirty || !mapping) {
                mapping = textMap();
                dirty = false;
                if (!mapping || mapping.large) { stopWorker(); clear(); status(mapping ? 'limit' : 'unmapped'); return; }
                if (!composing) language = explicitLanguage === null ? HF.prism_language(path, mapping.text) : explicitLanguage;
                if (!language && !composing) { stopWorker(); clear(); status('plain'); return; }
                rebasePainting();
            }
            if (!mapping || mapping.large || composing || !language) return;
            if (worker && ready && analysisText === mapping.text && analysisLanguage === language) { schedule(); return; }
            if (analysisDue && !analyzing) analyze();
        }
        function analyze() {
            if (!assets) {
                if (loading) return;
                loading = true;
                status('loading', { ranges: rangePool.size, provisional: !!painting });
                HF.get_prism_assets().then(function(value) { assets = value; loading = false; refresh(); }).catch(function() {
                    loading = false;
                    if (!disposed && enabled) { clear(); status('worker-error'); }
                });
                return;
            }
            try {
                const base = new URL(HF.resource || '/', location.href), bundle = new URL(assets.bundle, base);
                bundle.searchParams.set('v', assets.current);
                if (!worker) {
                    const script = new URL('js/prism-worker.js', base);
                    script.searchParams.set('v', HF.asset_version || '');
                    const instance = new Worker(script.href);
                    worker = instance;
                    workers++;
                    instance.onmessage = event => { if (worker === instance) receive(event); };
                    instance.onerror = event => { event.preventDefault(); if (worker !== instance) return; stopWorker(); clear(); status('worker-error'); };
                }
                clearTimeout(viewDeadline);
                sent = false; wanted = null; key = '';
                analysisDue = false; ready = false; analyzing = true;
                analysisText = mapping.text; analysisLanguage = language;
                revision++; analyses++;
                status('tokenizing', { ranges: rangePool.size, provisional: !!painting });
                deadline = setTimeout(function() {
                    const retry = !composing && (dirty || mapping && (mapping.text !== analysisText || language !== analysisLanguage));
                    stopWorker();
                    if (retry) { analysisDue = true; refresh(); }
                    else { clear(); status('timeout'); }
                }, 5000);
                worker.postMessage({ type: 'analyze', id: revision, text: analysisText, language, bundle: bundle.href });
            } catch (error) { stopWorker(); clear(); status('worker-error'); }
        }
        function nodeIndex(offset) {
            const nodes = mapping.nodes;
            let lo = 0, hi = nodes.length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (nodes[mid].end <= offset) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        }
        function characterBox(offset, probe) {
            const nodes = mapping.nodes;
            let index = nodeIndex(offset);
            if (index === nodes.length) index--;
            while (index >= 0 && nodes[index].end === nodes[index].start) index--;
            if (index < 0) return null;
            const n = nodes[index], local = Math.max(0, Math.min(n.node.length - 1, offset - n.start));
            probe.setStart(n.node, local);
            probe.setEnd(n.node, local + 1);
            return probe.getBoundingClientRect();
        }
        function lowerBound(start, end, predicate) {
            while (start < end) {
                const mid = start + ((end - start) >>> 1);
                if (predicate(mid)) end = mid;
                else start = mid + 1;
            }
            return start;
        }
        function viewport() {
            const text = mapping.text, lines = mapping.lines, length = text.length;
            if (!length || !editor.clientHeight || !editor.clientWidth) return [];
            const cs = getComputedStyle(editor);
            let height = parseFloat(cs.lineHeight) || 21;
            const bounds = editor.getBoundingClientRect(), probe = document.createRange();
            const scaleY = bounds.height / editor.offsetHeight || 1;
            if (editor.classList.contains('is-wrap')) {
                const top = bounds.top - margin * height * scaleY, bottom = bounds.bottom + margin * height * scaleY;
                const first = lowerBound(0, length, at => { const box = characterBox(at, probe); return !box || box.bottom >= top; });
                const end = lowerBound(first, length, at => { const box = characterBox(at, probe); return box && box.top > bottom; });
                return end > first ? [[first, end]] : [];
            }
            let padding = parseFloat(cs.paddingTop) || 0;
            if (mapping.anchors.length) {
                const a = mapping.anchors[0], firstBox = characterBox(lines[a], probe);
                if (mapping.anchors.length > 1) {
                    const b = mapping.anchors[1], secondBox = characterBox(lines[b], probe);
                    const measured = (secondBox.top - firstBox.top) / ((b - a) * scaleY);
                    if (measured > 0) height = measured;
                }
                padding = (firstBox.top - bounds.top) / scaleY + editor.scrollTop - a * height;
            }
            const first = Math.max(0, Math.floor((editor.scrollTop - padding) / height) - margin);
            const end = Math.min(lines.length, Math.ceil((editor.scrollTop + editor.clientHeight - padding) / height) + margin + 1);
            const bufferX = margin ? Math.min(256, bounds.width / 2) : 0;
            const left = bounds.left - bufferX, right = bounds.right + bufferX, segments = [];
            for (let line = first; line < end; line++) {
                let a = lines[line], b = line + 1 < lines.length ? lines[line + 1] - 1 : length;
                if (b - a > 512 && !mapping.horizontal.has(line)) mapping.horizontal.set(line, !/[\u0590-\u08ff]/.test(text.slice(a, b)));
                if (b - a > 512 && mapping.horizontal.get(line)) {
                    a = lowerBound(a, b, at => { const box = characterBox(at, probe); return !box || box.right >= left; });
                    b = lowerBound(a, b, at => { const box = characterBox(at, probe); return box && box.left > right; });
                }
                if (b > a) segments.push([a, b]);
            }
            return segments;
        }
        function schedule() {
            if (disposed || frame) return;
            frame = requestAnimationFrame(function() {
                frame = null;
                if (!enabled || composing || dirty || !ready || !mapping || analysisText !== mapping.text || analysisLanguage !== language || !editor.isConnected) return;
                const started = performance.now(), segments = viewport(), next = JSON.stringify(segments);
                viewportMs = performance.now() - started;
                if (key === next) return;
                key = next;
                wanted = { type: 'viewport', id: revision, view: ++serial, segments };
                sendView();
            });
        }
        function sendView() {
            if (sent || !wanted || !worker || dirty || !ready) return;
            sent = true;
            viewDeadline = setTimeout(() => { stopWorker(); clear(); status('timeout'); }, 3000);
            worker.postMessage(wanted);
        }
        function viewLimit() {
            clear();
            if (margin) { margin = 0; key = ''; schedule(); }
            else status('view-limit', { ranges: 0 });
        }
        function receive(event) {
            const data = event.data;
            if (disposed || !enabled || data.id !== revision || !editor.isConnected) return;
            if (data.type === 'analyze') {
                clearTimeout(deadline);
                analyzing = false;
                if (dirty || !mapping || composing || analysisText !== mapping.text || analysisLanguage !== language) {
                    ready = !data.error && data.length === analysisText.length;
                    refresh();
                    return;
                }
                if (data.error || data.length !== mapping.text.length) { stopWorker(); clear(); status(data.error || 'mismatch'); return; }
                ready = true;
                tokenMs = data.ms;
                totalRanges = data.totalRanges;
                schedule();
                return;
            }
            if (data.type !== 'viewport') return;
            clearTimeout(viewDeadline);
            sent = false;
            if (composing || dirty || !ready || !wanted || analysisText !== mapping.text || analysisLanguage !== language) return;
            if (data.view !== wanted.view) { sendView(); return; }
            if (data.error) {
                if (data.error === 'view-limit') viewLimit();
                else { clear(); status(data.error); }
                return;
            }
            const started = performance.now(), detail = paint(data.spans, false);
            if (!detail) return;
            status('ready', Object.assign(detail, { paintMs: performance.now() - started, characters: mapping.text.length,
                viewportMs, viewRevision: wanted.view, bufferLines: margin, segments: wanted.segments.length, start: wanted.segments[0]?.[0] ?? 0,
                end: wanted.segments[wanted.segments.length - 1]?.[1] ?? 0 }));
        }
        function input() { invalidate(); }
        function startComposition() { composing = true; invalidate(); }
        function endComposition() { composing = false; invalidate(); }
        function layout() { key = ''; schedule(); }
        const observer = new MutationObserver(input), lifetime = new MutationObserver(() => { if (!editor.isConnected) dispose(); });
        const attributes = new MutationObserver(layout);
        const resize = window.ResizeObserver ? new ResizeObserver(layout) : null;
        observer.observe(editor, { childList: true, subtree: true, characterData: true });
        lifetime.observe(document.body, { childList: true });
        attributes.observe(editor, { attributes: true, attributeFilter: ['class', 'style'] });
        attributes.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-harbor-theme'] });
        if (resize) resize.observe(editor);
        editor.addEventListener('input', input);
        editor.addEventListener('scroll', schedule, { passive: true });
        editor.addEventListener('compositionstart', startComposition);
        editor.addEventListener('compositionend', endComposition);
        window.addEventListener('resize', layout);
        if (document.fonts) document.fonts.addEventListener('loadingdone', layout);
        function dispose() {
            if (disposed) return;
            disposed = true;
            clearTimeout(timer);
            if (frame) cancelAnimationFrame(frame);
            if (editFrame) cancelAnimationFrame(editFrame);
            stopWorker();
            clear();
            mapping = null;
            style.remove();
            observer.disconnect();
            lifetime.disconnect();
            attributes.disconnect();
            if (resize) resize.disconnect();
            editor.removeEventListener('input', input);
            editor.removeEventListener('scroll', schedule);
            editor.removeEventListener('compositionstart', startComposition);
            editor.removeEventListener('compositionend', endComposition);
            window.removeEventListener('resize', layout);
            if (document.fonts) document.fonts.removeEventListener('loadingdone', layout);
            status('disposed');
        }
        invalidate(0);
        return control;
    };
})(window.HarborFile);
