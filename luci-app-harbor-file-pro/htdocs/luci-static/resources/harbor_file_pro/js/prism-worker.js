self.Prism = { manual: true, disableWorkerMessageHandler: true };
let loaded = null, cached = null, revision = null;
const names = ['comment', 'string', 'keyword', 'number', 'function', 'property', 'tag', 'operator'];
const groups = { comment: 0, prolog: 0, doctype: 0, cdata: 0, string: 1, 'attr-value': 1, char: 1, regex: 1, keyword: 2, builtin: 2, boolean: 3, number: 3, constant: 3, function: 4, 'class-name': 4, property: 5, 'attr-name': 5, selector: 5, tag: 6, operator: 7, punctuation: 7 };
self.onmessage = event => {
    const { type, id, view, text, language, bundle, segments } = event.data;
    try {
        if (type === 'viewport') {
            if (!cached || id !== revision) return;
            if (!Array.isArray(segments) || segments.length > 2048) throw new Error('viewport');
            const spans = [];
            let previous = 0;
            for (const segment of segments) {
                const [start, end] = segment;
                if (!Number.isInteger(start) || !Number.isInteger(end) || start < previous || end < start) throw new Error('viewport');
                previous = end;
                let lo = 0, hi = cached.length / 3;
                while (lo < hi) {
                    const mid = (lo + hi) >>> 1;
                    if (cached[mid * 3 + 1] <= start) lo = mid + 1;
                    else hi = mid;
                }
                for (let i = lo * 3; i < cached.length && cached[i] < end; i += 3) {
                    if (spans.length >= 12000) { postMessage({ type, id, view, error: 'view-limit' }); return; }
                    spans.push([Math.max(start, cached[i]), Math.min(end, cached[i + 1]), names[cached[i + 2]]]);
                }
            }
            postMessage({ type, id, view, spans });
            return;
        }
        if (type !== 'analyze') return;
        cached = null;
        revision = null;
        if (!loaded) {
            const url = new URL(bundle, self.location.href);
            if (url.origin !== self.location.origin || !/\/prism\/(builtin|releases\/[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{16})\/prism\.js$/.test(url.pathname)) throw new Error('bundle');
            importScripts(url.href);
            Prism.languages.uci = {
                comment: /#.*/,
                string: { pattern: /(["'])(?:\\.|(?!\1)[^\\\r\n])*\1/, greedy: true },
                keyword: /\b(?:config|option|list)\b/,
                number: /\b\d+\b/
            };
            Prism.languages.ucode = Prism.languages.javascript;
            loaded = bundle;
        }
        if (loaded !== bundle || typeof text !== 'string' || text.length > 2097152) throw new Error('input');
        if (!Prism.languages[language]) { postMessage({ type, id, error: 'plain' }); return; }
        const started = performance.now(), spans = [];
        let offset = 0;
        function walk(value, group) {
            if (typeof value === 'string') {
                const end = offset + value.length, size = spans.length;
                if (group !== undefined && end > offset) {
                    if (size && spans[size - 2] === offset && spans[size - 1] === group) spans[size - 2] = end;
                    else {
                        if (size >= 1500000) throw new Error('cache-limit');
                        spans.push(offset, end, group);
                    }
                }
                offset = end;
            } else if (Array.isArray(value)) value.forEach(part => walk(part, group));
            else {
                const alias = Array.isArray(value.alias) ? value.alias.find(name => groups[name] !== undefined) : value.alias;
                walk(value.content, groups[value.type] ?? groups[alias] ?? group);
            }
        }
        walk(Prism.tokenize(text, Prism.languages[language]));
        cached = new Uint32Array(spans);
        revision = id;
        postMessage({ type, id, length: offset, totalRanges: spans.length / 3, ms: performance.now() - started });
    } catch (error) {
        if (type === 'analyze') { cached = null; revision = null; }
        postMessage({ type, id, view, error: error.message === 'cache-limit' ? 'cache-limit' : 'error' });
    }
};
