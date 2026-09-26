/*
    NMS-Tracker.

    Every page is the same board with a different config: load one JSON file, rank it by the
    sum of its stats, and draw it as cards or as a table that sorts on any column. The config
    names the fields that mean something - the stats that make up the total, the ones that get
    a pick-list, the seeds - and any field it does not name is still shown, so adding one to the
    JSON needs no change here.

    Built from DOM nodes rather than HTML strings. The data is edited by hand, and a stray <
    in a name should appear as a <, not turn into markup.
*/
(function () {
    'use strict';

    // Fields with a fixed place on a card. Anything else in the data is shown generically.
    const PLACED = new Set(['Name', 'ImageUrl', 'Galaxy', 'Address', 'Source', 'Discoverer']);

    const VIEW_KEY = 'nms-tracker:view';
    const DOT = ' · ';

    /* ------------------------------------------------------------------ helpers */

    /** Element, attributes, children. Attributes named on* become listeners; null is skipped. */
    function h(tag, attrs, ...kids) {
        const el = document.createElement(tag);
        for (const [name, value] of Object.entries(attrs || {})) {
            if (value == null || value === false) continue;
            if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
            else el.setAttribute(name, value === true ? '' : value);
        }
        for (const kid of kids.flat(Infinity)) {
            if (kid != null && kid !== false && kid !== '') el.append(kid instanceof Node ? kid : String(kid));
        }
        return el;
    }

    /** FleetCoordination -> Fleet Coordination. */
    const spaced = name => String(name).replace(/([a-z])([A-Z])/g, '$1 $2');

    const number = value => (typeof value === 'number' ? value : Number.parseFloat(value));
    const twoPlaces = value => (Number.isFinite(value) ? value.toFixed(2) : '—');
    const blank = value => value == null || value === '' || Number.isNaN(value);

    /** localStorage, when the browser allows it. A private window may not, and that is fine. */
    function remembered(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            localStorage.setItem(key, value);
        } catch {
            // Not remembered; nothing else is lost.
        }
        return null;
    }

    async function load(path) {
        // no-cache revalidates rather than refetching, so an edited file shows on the next
        // visit instead of whenever the browser's own heuristics decide.
        const response = await fetch(path, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
        return response.json();
    }

    /**
     * An ImageUrl as the two pictures the page uses: the original in img/, which the viewer
     * shows, and the small copy of it in img/thumbs/, which the cards and the list show. The
     * copies are made by tools/thumbnails.py on every deploy. A full URL is used as it is, for
     * both.
     */
    function images(value) {
        const text = String(value ?? '').trim();
        if (!text) return null;
        if (/^https?:\/\//i.test(text)) return { full: text, thumb: text };

        // Tolerate "img/x.png", "/x.png" and backslashes. A leading slash would otherwise
        // escape the project path on GitHub Pages and quietly 404.
        const file = text.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^img\//i, '');
        const path = file.split('/').map(encodeURIComponent).join('/');
        return { full: `img/${path}`, thumb: `img/thumbs/${path}.webp` };
    }

    /**
     * A type as a chip in its own colour. The stylesheet colours the types it lists; any other
     * gets one made from its name, so a new type is coloured too, and always the same.
     */
    function typeChip(type) {
        let hash = 0;
        for (const char of String(type)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
        return h('span', {
            class: 'chip type',
            'data-type': type,
            style: `--type-auto: hsl(${hash % 360} 70% 70%)`,
            title: 'Type',
        }, type);
    }

    // Originals that could not be loaded, so the viewer leaves them out.
    const missing = new Set();

    /**
     * A picture shown by its small copy. With no copy - locally, before tools/thumbnails.py has
     * run - it falls back to the original; with neither, it becomes a placeholder rather than a
     * broken icon.
     */
    function picture({ full, thumb }, alt) {
        const img = h('img', { src: thumb, alt, loading: 'lazy', decoding: 'async' });
        img.addEventListener('error', () => {
            if (img.getAttribute('src') !== full) {
                img.src = full;
                return;
            }
            missing.add(full);
            img.closest('a')?.removeAttribute('href');
            img.replaceWith(h('span', { class: 'none' }, 'Image missing'));
        });
        return img;
    }

    let lightbox;

    /**
     * The one full-page viewer the page shares, made on first use: a carousel through the
     * pictures the board is showing, in the order it shows them. The arrow keys, the buttons at
     * either side and a swipe all step between them, wrapping round at the ends. Built on
     * <dialog>, which brings the backdrop and Escape to close, and keeps focus inside while it
     * is open.
     */
    function viewer() {
        if (lightbox) return lightbox;

        const img = h('img', { alt: '' });
        const title = h('span', { class: 'title' });
        const detail = h('span', { class: 'detail' });
        const count = h('span', { class: 'count' });
        const close = h('button', { type: 'button', class: 'close', 'aria-label': 'Close' }, '×');
        const back = h('button', { type: 'button', class: 'step back', 'aria-label': 'Previous picture' }, '‹');
        const next = h('button', { type: 'button', class: 'step next', 'aria-label': 'Next picture' }, '›');
        const dialog = h('dialog', { class: 'lightbox' },
            close, back, next,
            h('figure', {}, img, h('figcaption', {}, title, detail, count)));

        let slides = [];
        let index = 0;
        let original = null; // the original being shown, or on its way

        /**
         * Shows slide `to`. It starts on the small copy - the card's own when it is already
         * loaded, which gives the picture's shape at once - and the original replaces it when it
         * arrives. The picture is sized by its shape rather than its pixels, so the swap takes
         * exactly the same space.
         */
        function go(to, preview) {
            index = (to + slides.length) % slides.length;
            const slide = slides[index];
            original = slide.full;

            const ready = preview && preview.complete && preview.naturalWidth > 0;
            if (ready) img.style.setProperty('--aspect', preview.naturalWidth / preview.naturalHeight);
            const early = ready ? preview.getAttribute('src') : slide.thumb;
            img.src = early;
            if (early !== slide.full) {
                const full = new Image();
                full.addEventListener('load', () => {
                    if (original === slide.full) img.src = slide.full;
                });
                full.src = slide.full;
            }

            img.alt = slide.name;
            title.textContent = slide.name;
            detail.replaceChildren(...[].concat(slide.note).flatMap((line, i) => (i > 0 ? [h('br'), line] : [line])));
            count.textContent = slides.length > 1 ? `${index + 1} of ${slides.length}` : '';
            dialog.setAttribute('aria-label', slide.name || 'Image');

            // The neighbours' small copies, fetched now so the next step shows at once.
            for (const step of slides.length > 1 ? [-1, 1] : []) {
                new Image().src = slides[(index + step + slides.length) % slides.length].thumb;
            }
        }

        // Whatever arrives, copy or original, carries the picture's shape.
        img.addEventListener('load', () => {
            if (img.naturalWidth > 0) img.style.setProperty('--aspect', img.naturalWidth / img.naturalHeight);
        });
        // A missing copy falls straight back to the original; a missing original, to nothing.
        img.addEventListener('error', () => {
            if (original && img.getAttribute('src') !== original) img.src = original;
            else img.removeAttribute('src');
        });

        back.addEventListener('click', () => go(index - 1));
        next.addEventListener('click', () => go(index + 1));
        dialog.addEventListener('keydown', event => {
            if (slides.length < 2) return;
            if (event.key === 'ArrowLeft') go(index - 1);
            else if (event.key === 'ArrowRight') go(index + 1);
            else return;
            event.preventDefault();
        });

        // A sideways swipe on a touch screen steps too. A swipe ends without a click, so it
        // cannot close the viewer the way a tap on the backdrop does.
        let touch = null;
        dialog.addEventListener('touchstart', event => {
            touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
        }, { passive: true });
        dialog.addEventListener('touchend', event => {
            if (!touch || slides.length < 2) return;
            const dx = event.changedTouches[0].clientX - touch.x;
            const dy = event.changedTouches[0].clientY - touch.y;
            touch = null;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
        });

        // Anywhere but the picture and the arrows closes it - the backdrop, the caption, the ×.
        dialog.addEventListener('click', event => {
            if (event.target !== img && !event.target.closest('.step')) dialog.close();
        });
        // So the next opening never shows the last picture while it loads.
        dialog.addEventListener('close', () => {
            original = null;
            img.removeAttribute('src');
        });
        document.body.append(dialog);

        lightbox = {
            /**
             * Opens on slides[at], each slide { full, thumb, name, note }, where the note is a
             * line of text or a list of them. The preview is the card's own picture, if loaded.
             */
            show(list, at, preview) {
                slides = list;
                dialog.classList.toggle('single', list.length < 2);
                go(at, preview);
                dialog.showModal();
            },
        };
        return lightbox;
    }

    /**
     * A link to an original that opens the viewer, handing it the small copy inside the link.
     * A modified or middle click still opens a tab.
     */
    function viewable(link, open) {
        link.addEventListener('click', event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            // No href means the file failed to load and the picture became a placeholder.
            if (link.hasAttribute('href')) open(link.querySelector('img'));
        });
        return link;
    }

    /** A URL as a short link named for its site; anything else as plain text. */
    function link(value) {
        const text = String(value ?? '').trim();
        if (!/^https?:\/\//i.test(text)) return text;

        let site = text;
        try {
            site = new URL(text).hostname.replace(/^www\./, '');
        } catch {
            // Shown in full.
        }
        return h('a', { href: text, target: '_blank', rel: 'noopener noreferrer', title: text }, site, ' ↗');
    }

    /** A field this file knows nothing about, shown without guessing at what it means. */
    function plain(value) {
        if (value == null) return '';
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
        if (typeof value === 'object') return JSON.stringify(value);
        return link(value);
    }

    function unloadable(path, error) {
        return h('div', { class: 'empty' },
            h('b', {}, `Could not load ${path}.`),
            location.protocol === 'file:'
                ? 'Browsers will not let a page read files straight off the disk. Serve the folder '
                  + 'instead (python -m http.server) and open http://localhost:8000.'
                : String(error?.message ?? error));
    }

    /* ------------------------------------------------------------------ the board */

    async function render(config) {
        const root = document.getElementById('board');
        const stats = config.stats || [];
        const [one, many] = config.noun || ['entry', 'entries'];

        let data;
        let galaxies;
        let ranges;
        try {
            [data, galaxies, ranges] = await Promise.all([
                load(config.data),
                // Both niceties: without names the numbers still work, and without ranges the
                // meters are drawn against the best on the board.
                load('data/galaxies.json').catch(() => ({})),
                load('data/ranges.json').catch(() => ({})),
            ]);
            if (!Array.isArray(data)) throw new Error('Expected a list of entries.');
        } catch (error) {
            root.replaceChildren(unloadable(config.data, error));
            return;
        }

        const entries = data.filter(entry => entry && typeof entry === 'object');
        const galaxyName = n => (galaxies && galaxies[String(n)]) || '';
        const galaxyLabel = n => (blank(n) ? '' : galaxyName(n) ? `${n}${DOT}${galaxyName(n)}` : String(n));

        // Every field any entry has, in the order first seen. Configured fields nobody has yet
        // are left out rather than drawn as empty columns.
        const fields = [...new Set(entries.flatMap(entry => Object.keys(entry)))];
        const present = name => fields.includes(name);
        const facets = (config.facets || []).filter(present);
        const seeds = (config.seeds || []).filter(present);
        const tags = facets.filter(name => !PLACED.has(name));
        const extras = fields.filter(name =>
            !PLACED.has(name) && !stats.includes(name) && !facets.includes(name) && !seeds.includes(name));

        // What the stats can be, from data/ranges.json under this board's file name - "starships"
        // for data/starships.json. The board's own figures are the most a stat, and the total,
        // can be across every type. Under Types, each type's S-class floor and limit per stat.
        const board = config.data.split('/').pop().replace(/\.json$/i, '');
        const limits = (ranges && ranges[board]) || {};
        const types = limits.Types || {};
        const typed = stats.length > 0 && Object.keys(types).length > 0;
        const pair = value => (Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) ? value : null);

        const rows = entries.map((raw, index) => {
            const total = stats.length > 0
                ? stats.reduce((sum, name) => sum + (Number.isFinite(number(raw[name])) ? number(raw[name]) : 0), 0)
                : null;

            // The type's own S-class ranges, or failing that the ones every type shares, filed
            // under "*" - freighters, whose types all roll alike. Then the worst and best totals
            // those ranges allow, when every stat has one.
            const own = typed && !blank(raw.Type) ? types[raw.Type] : undefined;
            const range = own || (typed ? types['*'] : undefined) || null;
            const ends = range ? stats.map(name => pair(range[name])) : [];
            const whole = ends.length > 0 && ends.every(Boolean);
            const floor = whole ? ends.reduce((sum, [low]) => sum + low, 0) : null;
            const limit = whole ? ends.reduce((sum, [, high]) => sum + high, 0) : null;

            return {
                raw,
                index,
                total,
                rank: null,
                typeRank: null,
                range,
                floor,
                limit,
                // Where the total sits between the worst S-class roll of its type and the best:
                // 0 is the floor, 1 a perfect roll. Only for a type with ranges of its own - on
                // ranges every type shares, it would just repeat the overall score.
                typeScore: own && whole && limit > floor ? (total - floor) / (limit - floor) : null,
                text: [...fields.map(name => raw[name]), galaxyName(raw.Galaxy)]
                    .filter(value => typeof value === 'string')
                    .join('\n')
                    .toLowerCase(),
            };
        });

        // Competition ranking: equal totals share a place and the next place is skipped, so two
        // ships tied for first are both #1 and the one after them is #3.
        function rankBy(list, key) {
            const order = [...list].sort((a, b) => b.total - a.total);
            order.forEach((row, i) => {
                row[key] = i > 0 && row.total === order[i - 1].total ? order[i - 1][key] : i + 1;
            });
        }

        if (stats.length > 0) rankBy(rows, 'rank');

        // The same again within each type, on a board whose types have ranges.
        if (typed) {
            const groups = new Map();
            for (const row of rows.filter(r => !blank(r.raw.Type))) {
                const key = String(row.raw.Type);
                groups.set(key, [...(groups.get(key) || []), row]);
            }
            groups.forEach(group => {
                rankBy(group, 'typeRank');
                group.forEach(row => { row.typeCount = group.length; });
            });
        }

        // The highest of each stat. When there is more than one entry to compare, whoever holds
        // it is picked out - and with no range to draw against, the meters use it instead.
        const highest = {};
        for (const name of stats) {
            const values = rows.map(row => number(row.raw[name])).filter(Number.isFinite);
            highest[name] = values.length > 0 ? Math.max(...values) : 0;
        }
        const leads = (name, value) => rows.length > 1 && Number.isFinite(value) && value === highest[name];

        /**
         * The top of a stat's bar: the most any type can roll, so bars compare across types. It
         * is the board's own figure, or failing that the highest type limit, or failing that the
         * best on the board.
         */
        function ceiling(name) {
            const stated = number(limits[name]);
            if (Number.isFinite(stated) && stated > 0) return { most: stated, known: true };

            const reach = Object.values(types).map(spans => pair(spans[name])?.[1]).filter(Number.isFinite);
            if (reach.length > 0 && Math.max(...reach) > 0) return { most: Math.max(...reach), known: true };
            return { most: highest[name], known: false };
        }

        /** The S-class [floor, limit] an entry's type can roll for a stat, when known. */
        const bounds = (row, name) => (row.range ? pair(row.range[name]) : null);

        /** A value its type cannot roll at S-class: a typo, or an entry that is not S-class. */
        function outside(row, name, value) {
            const known = bounds(row, name);
            return Boolean(known) && Number.isFinite(value) && (value < known[0] || value > known[1]);
        }

        /** How one stat reads, in words, for a tooltip. */
        function statTitle(row, name) {
            const value = number(row.raw[name]);
            const { most, known } = ceiling(name);
            const head = known
                ? `${spaced(name)} ${twoPlaces(value)}, of a possible ${figure(most)}.`
                : `${spaced(name)} ${twoPlaces(value)}. The best on the board is ${twoPlaces(most)}.`;

            const range = bounds(row, name);
            if (!range) return head;

            // Named for the type when the range is its own; for a range every type shares, for
            // the board - "an S-class freighter".
            const who = row.range === types[row.raw.Type] ? row.raw.Type : one;
            if (range[0] === range[1]) return `${head} Always ${figure(range[0])} on an S-class ${who}.`;
            return `${head} An S-class ${who} rolls ${figure(range[0])} to ${figure(range[1])}`
                + (outside(row, name, value) ? ' - and this is outside that, so a typo or not S-class.' : '.');
        }

        // The score runs from the least a total can be to the most. The most is stated as "Total"
        // in the same file: its own number rather than the sum of the stat maximums, which for
        // starships and multi-tools add up to more. The least is the lowest total any type can
        // roll, worked out from the types so the two cannot drift apart; a board without types
        // counts from nothing. With no "Total" at all, the raw sum is shown instead.
        const possible = number(limits.Total);
        const floors = !typed ? [] : Object.values(types)
            .map(spans => stats.map(name => pair(spans[name])))
            .filter(ends => ends.every(Boolean))
            .map(ends => ends.reduce((sum, [low]) => sum + low, 0));
        const least = floors.length > 0 ? Math.min(...floors) : 0;
        const outOf = Number.isFinite(possible) && possible > least ? possible : null;

        const percent = share => `${(share * 100).toFixed(1)}%`;
        const figure = value => (Number.isInteger(value) ? String(value) : twoPlaces(value));
        const score = total => (outOf ? percent((total - least) / (outOf - least)) : twoPlaces(total));
        const scoreTitle = total => (!outOf ? null
            : least > 0
                ? `${twoPlaces(total)}: ${score(total)} of the way from ${figure(least)}, the lowest total any `
                  + `S-class ${one} can have, to ${figure(outOf)}, the highest`
                : `${twoPlaces(total)} of a possible ${figure(outOf)}`);
        const typeTitle = row => (row.typeScore == null ? null
            : `An S-class ${row.raw.Type} totals ${figure(row.floor)} at worst and ${figure(row.limit)} at best. `
              + `At ${twoPlaces(row.total)}, this one is ${percent(row.typeScore)} of the way.`);

        // Beneath a picture in the viewer: where it stands among every entry - "#4 Starship" - and
        // then among its own type, "#1 Explorer".
        const singular = one.charAt(0).toUpperCase() + one.slice(1);
        const caption = row => [
            row.rank != null ? `#${row.rank} ${singular}${DOT}${score(row.total)}` : '',
            row.typeRank != null
                ? `#${row.typeRank} ${row.raw.Type}${row.typeScore != null ? DOT + percent(row.typeScore) : ''}`
                : '',
        ].filter(Boolean);

        /* -------------------------------------------------------------- columns */

        const field = name => row => row.raw[name];
        const columns = [
            stats.length > 0 && { id: 'rank', label: '#', cls: 'pos', sortsAs: 'total', cell: row => row.rank },
            { id: 'image', label: 'Image', hideLabel: true, cls: 'shot-cell', cell: thumb },
            { id: 'Name', label: 'Name', cls: 'name', sort: field('Name'), cell: row => row.raw.Name },
            // The place within its type follows straight after the type itself.
            ...tags.flatMap(name => [
                { id: name, label: spaced(name), sort: field(name), cell: row => plain(row.raw[name]) },
                name === 'Type' && typed && {
                    id: 'typeRank', label: 'Type #', numeric: true, cls: 'num',
                    sort: row => row.typeRank, cell: row => row.typeRank,
                },
            ]),
            ...stats.map(name => ({
                id: name,
                label: spaced(name),
                numeric: true,
                desc: true,
                sort: row => number(row.raw[name]),
                cell: row => twoPlaces(number(row.raw[name])),
                cls: row => {
                    const value = number(row.raw[name]);
                    return ['num', leads(name, value) && 'best', outside(row, name, value) && 'out'].filter(Boolean).join(' ');
                },
                title: row => statTitle(row, name),
            })),
            stats.length > 0 && {
                id: 'total', label: 'Total', numeric: true, desc: true, cls: 'num tot',
                sort: row => row.total, cell: row => score(row.total), title: row => scoreTitle(row.total),
            },
            rows.some(row => row.typeScore != null) && {
                id: 'typeScore', label: 'Type score', numeric: true, desc: true, cls: 'num',
                sort: row => row.typeScore,
                cell: row => (row.typeScore == null ? '' : percent(row.typeScore)),
                title: typeTitle,
            },
            present('Galaxy') && {
                id: 'Galaxy', label: 'Galaxy', numeric: true,
                sort: row => number(row.raw.Galaxy), cell: row => galaxyLabel(row.raw.Galaxy),
            },
            present('Address') && {
                id: 'Address', label: 'Address', cls: 'addr-cell',
                sort: field('Address'), cell: row => address(row.raw, false),
            },
            present('Discoverer') && { id: 'Discoverer', label: 'Discoverer', sort: field('Discoverer'), cell: row => row.raw.Discoverer },
            ...seeds.map(name => ({ id: name, label: spaced(name), cls: 'seed', sort: field(name), cell: row => row.raw[name] })),
            ...extras.map(name => ({ id: name, label: spaced(name), cls: 'extra', sort: field(name), cell: row => plain(row.raw[name]) })),
            present('Source') && { id: 'Source', label: 'Source', cell: row => link(row.raw.Source) },
        ].filter(Boolean);

        const byId = Object.fromEntries(columns.map(column => [column.id, column]));

        /* -------------------------------------------------------------- state */

        const state = {
            view: remembered(VIEW_KEY) === 'list' ? 'list' : 'cards',
            sort: stats.length > 0 ? { key: 'total', desc: true } : { key: 'Name', desc: false },
            query: '',
            picks: new Map(), // field -> the values ticked in its pick-list
        };

        function matches(row) {
            const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
            if (!terms.every(term => row.text.includes(term))) return false;

            for (const [name, chosen] of state.picks) {
                if (chosen.size > 0 && !chosen.has(String(row.raw[name] ?? ''))) return false;
            }
            return true;
        }

        // Ties fall back to the leaderboard, then the name, then the order in the file, so the
        // same data always draws the same way.
        const settle = (a, b) =>
            (b.total ?? 0) - (a.total ?? 0)
            || String(a.raw.Name ?? '').localeCompare(String(b.raw.Name ?? ''))
            || a.index - b.index;

        function compare(a, b) {
            const column = byId[state.sort.key];
            const x = column.sort(a);
            const y = column.sort(b);

            // Missing values sink to the bottom whichever way the column is sorted.
            if (blank(x) || blank(y)) {
                if (blank(x) !== blank(y)) return blank(x) ? 1 : -1;
                return settle(a, b);
            }

            const order = typeof x === 'number' && typeof y === 'number'
                ? x - y
                : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
            return (state.sort.desc ? -order : order) || settle(a, b);
        }

        function sortBy(key) {
            if (state.sort.key === key) state.sort.desc = !state.sort.desc;
            else state.sort = { key, desc: Boolean(byId[key].desc) };
            draw();
        }

        const filtering = () => state.query.trim() !== '' || [...state.picks.values()].some(set => set.size > 0);

        /* -------------------------------------------------------------- nothing to show */

        if (rows.length === 0) {
            root.replaceChildren(h('div', { class: 'empty' },
                h('b', {}, `No ${many} tracked yet.`),
                config.pending || ''));
            return;
        }

        /* -------------------------------------------------------------- controls */

        const search = h('input', {
            type: 'search',
            placeholder: `Search ${many}…`,
            'aria-label': `Search ${many}`,
            oninput: () => {
                state.query = search.value;
                draw();
            },
        });

        const picks = facets.map(pickList);

        /** A button that opens a panel of checkboxes, one per value actually present, with counts. */
        function pickList(name) {
            const counts = new Map();
            for (const row of rows) {
                const value = row.raw[name];
                if (!blank(value)) counts.set(String(value), (counts.get(String(value)) || 0) + 1);
            }

            const options = [...counts]
                .map(([value, count]) => ({ value, count, label: name === 'Galaxy' ? galaxyLabel(value) : value }))
                .sort((a, b) => (name === 'Galaxy'
                    ? number(a.value) - number(b.value)
                    : a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })));

            const chosen = new Set();
            state.picks.set(name, chosen);

            const badge = h('span', { class: 'count hidden' });
            const button = h('button', { type: 'button', 'aria-expanded': 'false', 'aria-haspopup': 'true' }, spaced(name), badge);
            const panel = h('div', { class: 'panel hidden', role: 'group', 'aria-label': spaced(name) },
                options.map(option => h('label', {},
                    h('input', {
                        type: 'checkbox',
                        value: option.value,
                        onchange: event => {
                            if (event.target.checked) chosen.add(option.value);
                            else chosen.delete(option.value);
                            update();
                            draw();
                        },
                    }),
                    option.label,
                    h('span', { class: 'n' }, option.count))));

            function update() {
                badge.textContent = chosen.size;
                badge.classList.toggle('hidden', chosen.size === 0);
            }

            function show(open) {
                panel.classList.toggle('hidden', !open);
                button.setAttribute('aria-expanded', String(open));
            }

            button.addEventListener('click', () => {
                const open = panel.classList.contains('hidden');
                picks.forEach(pick => pick.show(false));
                show(open);
            });

            return {
                node: h('div', { class: 'pick' }, button, panel),
                show,
                clear() {
                    chosen.clear();
                    panel.querySelectorAll('input').forEach(box => { box.checked = false; });
                    update();
                },
            };
        }

        const closeAll = () => picks.forEach(pick => pick.show(false));
        document.addEventListener('click', event => {
            if (!event.target.closest('.pick')) closeAll();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeAll();
        });

        function reset() {
            state.query = '';
            search.value = '';
            picks.forEach(pick => pick.clear());
            draw();
        }

        const clear = h('button', { type: 'button', class: 'hidden', onclick: reset }, 'Clear filters');

        const sortSelect = h('select', { onchange: () => sortBy(sortSelect.value) },
            columns.filter(column => column.sort)
                .sort((a, b) => (b.id === 'total') - (a.id === 'total'))
                .map(column => h('option', { value: column.id }, column.label)));

        const direction = h('button', {
            type: 'button',
            onclick: () => {
                state.sort.desc = !state.sort.desc;
                draw();
            },
        });

        const viewButtons = [['cards', 'Cards'], ['list', 'List']].map(([view, label]) => h('button', {
            type: 'button',
            'data-view': view,
            onclick: () => {
                state.view = view;
                remembered(VIEW_KEY, view);
                draw();
            },
        }, label));

        const tally = h('p', { class: 'tally', 'aria-live': 'polite' });
        const results = h('div');

        root.replaceChildren(
            h('div', { class: 'bar' },
                search,
                picks.map(pick => pick.node),
                clear,
                h('label', { class: 'sortby' }, 'Sort', sortSelect),
                direction,
                h('div', { class: 'views', role: 'group', 'aria-label': 'Layout' }, viewButtons)),
            tally,
            results);

        /* -------------------------------------------------------------- drawing */

        // What the board is showing, in the order it shows it: the viewer steps through this.
        let visible = [];

        /** Opens the viewer on a row's picture, able to step through every other one on show. */
        function open(row, preview) {
            const pictured = visible.filter(other => {
                const pictures = images(other.raw.ImageUrl);
                return pictures && !missing.has(pictures.full);
            });
            const slides = pictured.map(other => ({
                ...images(other.raw.ImageUrl),
                name: other.raw.Name || '',
                note: caption(other),
            }));
            viewer().show(slides, Math.max(0, pictured.indexOf(row)), preview);
        }

        function draw() {
            const list = rows.filter(matches).sort(compare);
            const column = byId[state.sort.key];
            visible = list;

            tally.textContent = list.length === rows.length
                ? `${rows.length} ${rows.length === 1 ? one : many}`
                : `${list.length} of ${rows.length} ${many}`;

            clear.classList.toggle('hidden', !filtering());
            sortSelect.value = state.sort.key;
            direction.textContent = column.numeric
                ? (state.sort.desc ? 'Highest first' : 'Lowest first')
                : (state.sort.desc ? 'Z to A' : 'A to Z');
            viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)));

            if (list.length === 0) {
                results.replaceChildren(h('div', { class: 'empty' },
                    h('b', {}, 'Nothing matches.'),
                    h('button', { type: 'button', class: 'linkish', onclick: reset }, 'Clear the filters')));
            } else if (state.view === 'list') {
                results.replaceChildren(table(list));
            } else {
                results.replaceChildren(h('div', { class: 'cards' }, list.map(card)));
            }
        }

        /**
         * Glyphs to read off and type into a portal, then a line beneath with the galaxy on the
         * left and the hex on the right, to copy and to check the glyphs against.
         */
        function address(raw, withGalaxy) {
            const hex = String(raw.Address ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
            const galaxy = withGalaxy && !blank(raw.Galaxy) && h('span', { class: 'galaxy' },
                'Galaxy ', h('b', {}, raw.Galaxy), galaxyName(raw.Galaxy) && DOT + galaxyName(raw.Galaxy));
            return h('div', { class: 'addr' },
                hex && h('span', { class: 'glyphs', 'aria-hidden': 'true' }, hex),
                (galaxy || hex) && h('div', { class: 'addr-line' },
                    galaxy,
                    hex && h('span', { class: 'hex', title: 'Portal address' }, hex)));
        }

        /**
         * One stat on a card: its name, a bar and its value. Every bar runs from nothing to the
         * most any type can roll, so bars compare across types, and two ticks on it mark the
         * floor and the limit of this entry's own type. The fill is paler up to the floor, since
         * every roll of that type gets that far; only the part past it was won.
         */
        function meter(row, name) {
            const value = number(row.raw[name]);
            const { most } = ceiling(name);
            const at = v => (most > 0 && Number.isFinite(v) ? Math.max(0, Math.min(100, (v / most) * 100)) : 0);
            const range = bounds(row, name);

            // Where the floor falls along the fill itself, which is what the gradient is drawn on.
            const fill = at(value);
            const floor = range && fill > 0 ? Math.min(100, (at(range[0]) / fill) * 100) : 0;

            return h('div', { class: 'stat', title: statTitle(row, name) },
                h('span', { class: 'k' }, spaced(name)),
                h('span', { class: 'meter', 'aria-hidden': 'true' },
                    h('i', { style: `width: ${fill.toFixed(1)}%; --floor: ${floor.toFixed(1)}%` }),
                    range && range.map(end => h('span', { class: 'tick', style: `left: ${at(end).toFixed(1)}%` }))),
                h('span', { class: ['v', leads(name, value) && 'best', outside(row, name, value) && 'out'].filter(Boolean).join(' ') },
                    twoPlaces(value)));
        }

        /**
         * On the right of the seeds: the place within its type, the type and the score, "#4",
         * "Explorer", "92.9%". The place is coloured like the overall one, the type by type.
         */
        function standing(row) {
            const { raw } = row;
            return row.typeRank != null && h('span', {
                class: 'standing',
                title: [`#${row.typeRank} of ${row.typeCount} ${raw.Type} entries.`, typeTitle(row)].filter(Boolean).join(' '),
            },
            h('span', { class: row.typeRank <= 3 ? `place p${row.typeRank}` : 'place' }, `#${row.typeRank}`),
            typeChip(raw.Type),
            row.typeScore != null && h('b', {}, percent(row.typeScore)));
        }

        /** Tags under the name. The type is left out when the standing beside the seeds shows it. */
        function chips(row) {
            const { raw } = row;
            const shown = name => !blank(raw[name]) && !(name === 'Type' && row.typeRank != null);
            const items = [
                ...tags.filter(shown).map(name => (name === 'Type'
                    ? typeChip(raw[name])
                    : h('span', { class: 'chip', title: spaced(name) }, raw[name]))),
                ...extras.filter(shown).map(name => h('span', { class: 'chip' }, `${spaced(name)}: `, plain(raw[name]))),
            ];
            return items.length > 0 && h('div', { class: 'chips' }, items);
        }

        function card(row) {
            const { raw } = row;
            const pictures = images(raw.ImageUrl);
            const seeded = seeds.filter(name => !blank(raw[name]));

            // On the picture, kept small: the overall place top left and the overall score top
            // right. The standing within its type sits beside the name.
            const shot = h(pictures ? 'a' : 'div', { class: 'shot', href: pictures?.full, title: pictures && 'View full size' },
                pictures ? picture(pictures, raw.Name || '') : h('span', { class: 'none' }, 'No image yet'),
                row.rank != null && h('span', {
                    class: row.rank <= 3 ? `badge place p${row.rank}` : 'badge place',
                    title: `#${row.rank} of ${rows.length} on the board`,
                }, `#${row.rank}`),
                row.total != null && h('span', { class: 'badge score', title: scoreTitle(row.total) }, score(row.total)));
            if (pictures) viewable(shot, preview => open(row, preview));

            return h('article', { class: 'card' },
                shot,

                h('div', { class: 'card-body' },
                    h('h2', {}, raw.Name || 'Unnamed'),
                    chips(row),
                    stats.length > 0 && h('div', { class: 'stats' }, stats.map(name => meter(row, name))),
                    (present('Address') || present('Galaxy')) && address(raw, true),
                    (seeded.length > 0 || row.typeRank != null) && h('div', { class: 'seed-line' },
                        seeded.length > 0 && h('div', { class: 'seeds' },
                            seeded.map(name => h('span', { class: 'seed' }, h('b', {}, spaced(name)), ' ', raw[name]))),
                        standing(row))),

                h('div', { class: 'foot' },
                    !blank(raw.Discoverer) && h('span', {}, 'Found by ', h('span', { class: 'who' }, raw.Discoverer)),
                    link(raw.Source)));
        }

        function thumb(row) {
            const pictures = images(row.raw.ImageUrl);
            if (!pictures) return h('span', { class: 'none', title: 'No image yet' });
            return viewable(h('a', { href: pictures.full, title: 'View full size' }, picture(pictures, row.raw.Name || '')),
                preview => open(row, preview));
        }

        function table(list) {
            const head = h('tr', {}, columns.map(column => {
                const key = column.sortsAs || (column.sort ? column.id : null);
                const active = column.id === state.sort.key;
                const label = column.hideLabel ? h('span', { class: 'visually-hidden' }, column.label) : column.label;

                return h('th', { scope: 'col', 'aria-sort': active ? (state.sort.desc ? 'descending' : 'ascending') : null },
                    key
                        ? h('button', { type: 'button', onclick: () => sortBy(key) },
                            label,
                            active && h('span', { class: 'dir' }, state.sort.desc ? ' ▾' : ' ▴'))
                        : h('span', { class: 'th' }, label));
            }));

            const body = list.map(row => h('tr', { class: row.rank != null && row.rank <= 3 ? `p${row.rank}` : null },
                columns.map(column => h('td', {
                    class: typeof column.cls === 'function' ? column.cls(row) : column.cls,
                    title: column.title ? column.title(row) : null,
                }, column.cell(row)))));

            return h('div', { class: 'wrap' },
                h('table', {}, h('thead', {}, head), h('tbody', {}, body)));
        }

        draw();
    }

    window.Tracker = { render };
})();
