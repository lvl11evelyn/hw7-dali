// ==UserScript==
// @name         HW Dynamically Adapted Legacy Images
// @namespace    https://www.hobowars.com/
// @version      1.91
// @description  DALI seeks out native, legacy images in the Hobowars domain and substitutes them while retaining their dimensions for a crisper, more contemporary aesthetic.
// @author       lvl11evelyn / HW1 (2924238)
// @match        *://hobowars.com/*
// @match        *://*.hobowars.com/*
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/lvl11evelyn/hw7-dali/main/HW%20Dynamically%20Adapted%20Legacy%20Images.user.js
// @downloadURL  https://raw.githubusercontent.com/lvl11evelyn/hw7-dali/main/HW%20Dynamically%20Adapted%20Legacy%20Images.user.js
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

// ============================================================================
// DALI - DYNAMICALLY ADAPTED LEGACY IMAGES
// ============================================================================

(() => {
    'use strict';


// ------------------------------------------------------------------------
// REMOTE ASSET MAP / AUTHORITATIVE CATALOG
// ------------------------------------------------------------------------

    const ASSET_MAP_URL =
        'https://raw.githubusercontent.com/lvl11evelyn/hw7-dali/main/assets/dali-assets.json';

    const ASSET_MAP_CACHE_KEY =
        'hw-dali-asset-map-cache-v1';

    let REPLACEMENTS = null;
    let ASSET_MAP_SIGNATURE = '';
    let CATALOG_GENERATION = 0;

    let EQUIPMENT_NAMES = [];
    let NORMALIZED_EQUIPMENT_NAMES = new Map();
    let DALI_OBSERVER = null;

    /*
     * The authoritative identity index contains every named leaf in the
     * external asset map, including entries whose replacement URL is null.
     *
     * DALI is deliberately fail-closed: an image must resolve to exactly one
     * known catalog identity before ordinary catalog replacement is allowed.
     * Unknown or ambiguous imagery is left untouched.
     */
    let CATALOG_IDENTITY_INDEX = new Map();

    const cachedAssetMap = readCachedAssetMap();

    if (cachedAssetMap) {
        applyAssetMap(cachedAssetMap);
    }

    /*
     * DALI starts immediately. The network is never on the critical path.
     * A cached catalog is usable synchronously; a first-run install can still
     * process self-contained SVG families while the remote map is arriving.
     */
    initializeDali();
    refreshRemoteAssetMap();

    async function refreshRemoteAssetMap() {
        try {
            const assetMap = await fetchRemoteAssetMap();

            cacheAssetMap(assetMap);

            if (applyAssetMap(assetMap)) {
                /*
                 * Only unresolved / known-unmapped / ambiguous images from an
                 * older catalog generation are reconsidered. Replaced images
                 * remain final and are not churned through the resolver again.
                 */
                scan(document);
            }
        } catch (error) {
            if (REPLACEMENTS) {
                console.warn(
                    '[DALI] Remote asset map unavailable; continuing with cached copy.',
                    error
                );
                return;
            }

            console.error(
                '[DALI] Remote asset map unavailable and no cached copy exists.',
                error
            );
        }
    }

    function fetchRemoteAssetMap() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${ASSET_MAP_URL}?dali=${Date.now()}`,
                timeout: 10000,

                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(
                            new Error(
                                `Asset map request returned HTTP ${response.status}.`
                            )
                        );
                        return;
                    }

                    try {
                        const assetMap = JSON.parse(response.responseText);
                        validateAssetMap(assetMap);
                        resolve(assetMap);
                    } catch (error) {
                        reject(error);
                    }
                },

                onerror() {
                    reject(new Error('Asset map network request failed.'));
                },

                ontimeout() {
                    reject(new Error('Asset map network request timed out.'));
                }
            });
        });
    }

    function validateAssetMap(assetMap) {
        if (!assetMap || typeof assetMap !== 'object' || Array.isArray(assetMap)) {
            throw new Error('Asset map root is not a JSON object.');
        }

        const requiredCatalogs = [
            'equipment',
            'tattoos',
            'bernardsSpecialItems',
            'backpackItems',
            'currencies'
        ];

        for (const catalogName of requiredCatalogs) {
            const catalog = assetMap[catalogName];

            if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
                throw new Error(
                    `Asset map is missing the "${catalogName}" catalog.`
                );
            }
        }

        return assetMap;
    }

    function applyAssetMap(assetMap) {
        validateAssetMap(assetMap);

        const signature = JSON.stringify(assetMap);

        if (signature === ASSET_MAP_SIGNATURE) {
            return false;
        }

        REPLACEMENTS = assetMap;
        ASSET_MAP_SIGNATURE = signature;
        CATALOG_GENERATION += 1;

        buildLookupTables();
        return true;
    }

    function cacheAssetMap(assetMap) {
        try {
            localStorage.setItem(
                ASSET_MAP_CACHE_KEY,
                JSON.stringify(assetMap)
            );
        } catch (error) {
            console.warn('[DALI] Unable to cache asset map.', error);
        }
    }

    function readCachedAssetMap() {
        try {
            const raw = localStorage.getItem(ASSET_MAP_CACHE_KEY);

            if (!raw) {
                return null;
            }

            const assetMap = JSON.parse(raw);
            validateAssetMap(assetMap);
            return assetMap;
        } catch (error) {
            console.warn('[DALI] Cached asset map is invalid.', error);
            return null;
        }
    }

    function buildLookupTables() {
        const equipment = REPLACEMENTS?.equipment || {};

        EQUIPMENT_NAMES = Object.keys(equipment);

        NORMALIZED_EQUIPMENT_NAMES = new Map(
            EQUIPMENT_NAMES.map(name => [
                normalizeEquipmentName(name).toLowerCase(),
                name
            ])
        );

        CATALOG_IDENTITY_INDEX = buildCatalogIdentityIndex(REPLACEMENTS);
    }

    function buildCatalogIdentityIndex(assetMap) {
        const index = new Map();

        for (const [catalogName, catalog] of Object.entries(assetMap || {})) {
            if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
                continue;
            }

            walkCatalogLeaves(
                catalogName,
                catalog,
                [],
                (name, url, path) => {
                    const key = normalizeIdentityKey(name);

                    if (!key) {
                        return;
                    }

                    const entry = {
                        name,
                        catalog: catalogName,
                        path: [catalogName, ...path, name],
                        url: typeof url === 'string' && url.trim()
                            ? url.trim()
                            : null
                    };

                    const bucket = index.get(key) || [];
                    bucket.push(entry);
                    index.set(key, bucket);
                }
            );
        }

        return index;
    }

    function walkCatalogLeaves(catalogName, node, path, visit) {
        for (const [key, value] of Object.entries(node || {})) {
            if (
                value === null ||
                typeof value === 'string'
            ) {
                visit(key, value, path);
                continue;
            }

            if (
                value &&
                typeof value === 'object' &&
                !Array.isArray(value)
            ) {
                walkCatalogLeaves(
                    catalogName,
                    value,
                    [...path, key],
                    visit
                );
            }
        }
    }

    /*
     * Currency aliases normalize native HoboWars terminology back to the
     * canonical DALI currency identity. DP and DPs are intentionally
     * case-sensitive so ordinary lowercase text cannot accidentally resolve
     * as Donator Packs.
     */
    const CURRENCY_ALIASES = {
        'Donator': 'Donator Packs',
        'Donator Pack': 'Donator Packs',
        'Donator Packs': 'Donator Packs',
        'DP': 'Donator Packs',
        'DPs': 'Donator Packs'
    };

    const TATTOO_OPACITY = {
        3: 1,
        2: 0.6,
        1: 0.35
    };

// ------------------------------------------------------------------------
// NAME / CATALOG HELPERS
// ------------------------------------------------------------------------

    function normalizeAssetName(value) {
        if (!value) {
            return '';
        }

        let text = String(value).trim();

        if (text.includes('/')) {
            text = text.split('/').pop() || text;
        }

        try {
            text = decodeURIComponent(text);
        } catch (err) {
            // Ignore malformed escape sequences and keep raw text.
        }

        text = text.split('?')[0].split('#')[0];

        /*
         * Strip a PageSpeed rewrite tail before stripping the underlying
         * native image extension.
         */
        text = text.replace(
            /\.pagespeed\.[^.?#]+(?:\.[^?#]+)*$/i,
            ''
        );

        text = text.replace(/\.(gif|png|jpe?g|webp)$/i, '');
        text = text.replace(/[_-]+/g, ' ');
        text = text.replace(/\s+/g, ' ').trim();

        return text;
    }

    function normalizeIdentityKey(value) {
        return normalizeAssetName(value).toLowerCase();
    }

    function findCatalogMatch(rawValue, catalog) {
        const normalizedNeedle = normalizeIdentityKey(rawValue);

        if (!normalizedNeedle || !catalog) {
            return null;
        }

        for (const key of Object.keys(catalog)) {
            if (normalizeIdentityKey(key) === normalizedNeedle) {
                return key;
            }
        }

        return null;
    }

    function getCatalogEntry(catalogName, identity) {
        const catalog = REPLACEMENTS?.[catalogName];

        if (!catalog || !Object.prototype.hasOwnProperty.call(catalog, identity)) {
            return null;
        }

        const value = catalog[identity];

        if (
            value !== null &&
            typeof value !== 'string'
        ) {
            return null;
        }

        return {
            name: identity,
            catalog: catalogName,
            path: [catalogName, identity],
            url: typeof value === 'string' && value.trim()
                ? value.trim()
                : null
        };
    }

    function lookupCatalogIdentity(rawValue) {
        const key = normalizeIdentityKey(rawValue);

        if (!key) {
            return { status: 'none', entries: [] };
        }

        const entries = CATALOG_IDENTITY_INDEX.get(key) || [];

        if (entries.length === 0) {
            return { status: 'none', entries: [] };
        }

        if (entries.length > 1) {
            return { status: 'ambiguous', entries };
        }

        return {
            status: 'resolved',
            entry: entries[0],
            entries
        };
    }

    function getSourceIdentityCandidates(src) {
        if (!src || src.startsWith('data:')) {
            return [];
        }

        let filename = String(src)
            .split(/[?#]/)[0]
            .split('/')
            .pop() || '';

        try {
            filename = decodeURIComponent(filename);
        } catch (error) {
            // Keep raw filename.
        }

        const out = [filename];

        if (/\.pagespeed\./i.test(filename)) {
            let nativeFilename = filename.replace(
                /\.pagespeed\..*$/i,
                ''
            );

            out.push(nativeFilename);

            /*
             * PageSpeed commonly prefixes rewritten native item filenames
             * with "x". Try the unprefixed native identity as an additional
             * exact catalog candidate; special xmove/xslot families are
             * intercepted before ordinary catalog resolution.
             */
            if (/^x/i.test(nativeFilename)) {
                out.push(nativeFilename.slice(1));
            }
        }

        return out;
    }

    function resolveDirectCatalogImage(image) {
        const rawCandidates = [
            image.getAttribute('alt'),
            image.getAttribute('title'),
            image.getAttribute('aria-label'),
            ...getSourceIdentityCandidates(
                image.getAttribute('src') || ''
            )
        ];

        const tattooAlt = image.getAttribute('alt') || '';
        const tattooCandidate = tattooAlt.replace(
            /-(1|2|3)(?:\.(?:gif|png|jpe?g|webp))?$/i,
            ''
        );

        if (tattooCandidate !== tattooAlt) {
            rawCandidates.push(tattooCandidate);
        }

        const currencyCandidates = [
            image.getAttribute('alt'),
            image.getAttribute('title')
        ];

        for (const raw of currencyCandidates) {
            const currencyIdentity = findCurrencyMatch(raw);

            if (currencyIdentity) {
                rawCandidates.push(currencyIdentity);
            }
        }

        const resolved = new Map();
        const ambiguous = [];

        for (const raw of rawCandidates) {
            const result = lookupCatalogIdentity(raw);

            if (result.status === 'ambiguous') {
                ambiguous.push(...result.entries);
                continue;
            }

            if (result.status !== 'resolved') {
                continue;
            }

            const entry = result.entry;
            const key = `${entry.catalog}\u0000${entry.path.join('\u0000')}`;
            resolved.set(key, entry);
        }

        if (ambiguous.length > 0) {
            return {
                status: 'ambiguous',
                entries: ambiguous
            };
        }

        const entries = [...resolved.values()];

        if (entries.length === 0) {
            return { status: 'none' };
        }

        if (entries.length > 1) {
            return {
                status: 'ambiguous',
                entries
            };
        }

        return {
            status: 'resolved',
            entry: entries[0]
        };
    }

    function applyResolvedCatalogEntry(image, entry) {
        if (!entry) {
            return false;
        }

        if (!entry.url) {
            markKnownUnmapped(
                image,
                entry.name,
                entry.catalog,
                entry.path
            );
            return true;
        }

        const replacementUrl = resolveReplacementPointer(entry.url);

        if (!replacementUrl) {
            markKnownUnmapped(
                image,
                entry.name,
                entry.catalog,
                entry.path
            );
            return true;
        }

        const fade = entry.catalog === 'tattoos'
            ? getTattooFade(image)
            : null;

        replaceImage(
            image,
            entry.name,
            replacementUrl,
            catalogCategoryLabel(entry.catalog),
            entry.path
        );

        if (fade !== null) {
            image.style.opacity = String(
                TATTOO_OPACITY[fade]
            );
        }

        return true;
    }

    function catalogCategoryLabel(catalogName) {
        const aliases = {
            tattoos: 'tattoo',
            bernardsSpecialItems: 'bernards-special-item',
            backpackItems: 'backpack-item',
            currencies: 'currency',
            foodItems: 'food-item',
            foodStorageItems: 'food-storage-item',
            statusEffects: 'status-effect'
        };

        return aliases[catalogName] ||
            String(catalogName || 'catalog-item')
                .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
                .toLowerCase();
    }

    function markKnownUnmapped(image, name, catalog, path = null) {
        image.dataset.daliState = 'known-unmapped';
        image.dataset.daliGeneration = String(CATALOG_GENERATION);
        image.dataset.daliName = name;
        image.dataset.daliCategory = catalogCategoryLabel(catalog);

        if (Array.isArray(path)) {
            image.dataset.daliPath = path.join('/');
        }
    }

    function markAmbiguous(image) {
        image.dataset.daliState = 'ambiguous';
        image.dataset.daliGeneration = String(CATALOG_GENERATION);
    }

    function markUnresolved(image) {
        image.dataset.daliState = 'unresolved';
        image.dataset.daliGeneration = String(CATALOG_GENERATION);
    }

// ------------------------------------------------------------------------
// INITIALIZATION / DYNAMIC CONTENT
// ------------------------------------------------------------------------

    function initializeDali() {
        if (DALI_OBSERVER) {
            return;
        }
    
        DALI_OBSERVER = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) {
                        continue;
                    }
    
                    if (node.matches('img')) {
                        processImage(node);
                    }
    
                    scan(node);
                }
            }
        });
    
        DALI_OBSERVER.observe(document, {
            childList: true,
            subtree: true
        });

        scan(document);

        /*
         * Parser-built / cached imagery can occasionally complete between a
         * document-start mutation and the image retry listener being attached.
         * A single DOMContentLoaded sweep closes that timing gap without
         * putting the network back on DALI's critical path.
         */
        if (document.readyState === 'loading') {
            document.addEventListener(
                'DOMContentLoaded',
                () => scan(document),
                { once: true }
            );
        }
    }


// ------------------------------------------------------------------------
// SCANNING
// ------------------------------------------------------------------------

    function scan(root) {
        if (!root?.querySelectorAll) {
            return;
        }

        replaceBmenuIcons(root);

        for (const image of root.querySelectorAll('img')) {
            processImage(image);
        }
    }

    function replaceBmenuIcons(root) {
        if (!REPLACEMENTS) {
            return;
        }

        const menuAssets = {
            home: ['backpackItems', 'Cardboard Box'],
            backpack: ['backpackItems', 'Unusually Large Backpack'],
            food: ['foodItems', 'Single-Single'],
            city: ['backpackItems', 'School ID'],
            cans: ['currencies', 'Cans']
        };

        for (const [className, [catalogName, identity]] of Object.entries(menuAssets)) {
            const replacementUrl = REPLACEMENTS[catalogName]?.[identity];

            if (!replacementUrl) {
                continue;
            }

            const selector = `.section.bmenu .img.${className}`;
            const icons = [];

            if (root instanceof Element && root.matches(selector)) {
                icons.push(root);
            }

            icons.push(...root.querySelectorAll(selector));

            for (const icon of icons) {
                if (icon.dataset.daliMenuAsset === identity) {
                    continue;
                }

                icon.dataset.daliMenuAsset = identity;

                icon.style.setProperty(
                    'background-image',
                    `url("${replacementUrl}")`,
                    'important'
                );
                icon.style.setProperty('background-position', 'center', 'important');
                icon.style.setProperty('background-repeat', 'no-repeat', 'important');
                icon.style.setProperty('background-size', 'contain', 'important');
            }
        }
    }

        function processImage(image) {
            if (
                !image ||
                image.nodeType !== 1 ||
                String(image.localName).toLowerCase() !== 'img'
            ) {
                return;
            }

        const state = image.dataset.daliState || '';
        const generation = Number.parseInt(
            image.dataset.daliGeneration || '-1',
            10
        );

        if (state === 'replaced') {
            return;
        }

        if (
            generation === CATALOG_GENERATION &&
            (
                state === 'known-unmapped' ||
                state === 'ambiguous' ||
                state === 'unresolved'
            )
        ) {
            return;
        }

        /*
         * Self-contained legacy families with authoritative native identity
         * run even on a first install before the remote catalog has arrived.
         */
        if (processNavigationArrow(image)) {
            return;
        }

        if (processSlotSymbol(image)) {
            return;
        }

        if (!REPLACEMENTS) {
            markUnresolved(image);
            return;
        }

        /*
         * KKC+/Grail variants need payload/state logic that is stronger than
         * their ordinary displayed name. Resolve these before the global
         * catalog index so a KKC+ cannot be downgraded to the base cup by alt.
         */
        if (processSpecialItem(image)) {
            return;
        }

        /*
         * Primary v1 resolver: exact, allowlisted identity across the complete
         * catalog. Unknown imagery is not guessed at.
         */
        const direct = resolveDirectCatalogImage(image);

        if (direct.status === 'ambiguous') {
            markAmbiguous(image);
            return;
        }

        if (
            direct.status === 'resolved' &&
            applyResolvedCatalogEntry(image, direct.entry)
        ) {
            return;
        }

        /*
         * Scoped semantic fallbacks are retained only where HoboWars itself
         * withholds usable image identity (base64 item art, record tables,
         * currency counters). Each fallback is confined to its own known
         * catalog and requires one unambiguous catalog result.
         */
        if (processTattoo(image)) {
            return;
        }

        if (processBernardsSpecialItem(image)) {
            return;
        }

        if (processBackpackItem(image)) {
            return;
        }

        if (processCurrency(image)) {
            return;
        }

        if (processEquipment(image)) {
            return;
        }

        markUnresolved(image);
    }

    function processSpecialItem(image) {
        const identity = identifySpecialItem(image);

        if (!identity) {
            return false;
        }

        const entry = getCatalogEntry(
            'backpackItems',
            identity
        );

        if (!entry) {
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry
        );
    }

    function identifySpecialItem(image) {
        const src = image.getAttribute('src') || '';
        const alt = image.getAttribute('alt') || '';
        const hash = dataSrcHash(src);

    // ------------------------------------------------------------
    // Hobo Grail — depleted
    // ------------------------------------------------------------

        if (
            /Hobo-Grail-Dark/i.test(src) ||
            hash === '23e145b2'
        ) {
            return 'Hobo Grail (Depleted)';
        }

    // ------------------------------------------------------------
    // Hobo Grail — full
    // ------------------------------------------------------------

        if (
            /Hobo-Grail(?!-Dark)/i.test(src) ||
            hash === 'be956455'
        ) {
            return 'Hobo Grail (Full)';
        }

    // ------------------------------------------------------------
    // King's Kiddie Cup+
    // ------------------------------------------------------------

        const KKC_PLUS_HASHES = new Set([
            '43f62fec',
            '69db8c2a',
            '9ab0cb50',
            '4217fcb3',
            '32fea929',
            '207191e6'
        ]);

        if (KKC_PLUS_HASHES.has(hash)) {
            return "King's Kiddie Cup+";
        }

    // ------------------------------------------------------------
    // King's Kiddie Cup
    // ------------------------------------------------------------

        if (
            alt === "King's Kiddie Cup" ||
            /Kings-Kiddie-Cup/i.test(src)
        ) {
            return "King's Kiddie Cup";
        }

        return null;
    }

    function dataSrcHash(src) {
        if (!src.startsWith('data:image/')) {
            return null;
        }

        /*
         * FNV-1a 32-bit.
         *
         * Used only as a compact fingerprint for known native base64
         * image payloads.
         */
        let hash = 0x811c9dc5;

        for (let i = 0; i < src.length; i++) {
            hash ^= src.charCodeAt(i);

            hash = Math.imul(
                hash,
                0x01000193
            );
        }

        return (hash >>> 0)
            .toString(16)
            .padStart(8, '0');
    }

    // ------------------------------------------------------------------------
// INLINE SLOT SVG ARTWORK
// ------------------------------------------------------------------------

function svgDataUrl(svg) {
    return (
        'data:image/svg+xml;charset=UTF-8,' +
        encodeURIComponent(
            svg
                .replace(/\s+/g, ' ')
                .trim()
        )
    );
}


// ------------------------------------------------------------------------
// ASSET-MAP INLINE SVG POINTERS
// ------------------------------------------------------------------------

const DALI_SVG_POINTER_PREFIX = 'dali-svg://';

function resolveReplacementPointer(pointer) {
    if (typeof pointer !== 'string') {
        return null;
    }

    const value = pointer.trim();

    if (!value.startsWith(DALI_SVG_POINTER_PREFIX)) {
        return value || null;
    }

    const identity = value
        .slice(DALI_SVG_POINTER_PREFIX.length)
        .trim()
        .toLowerCase();

    const svg = renderInlineAssetSvg(identity);

    if (!svg) {
        console.warn(
            `[DALI] Unknown inline SVG pointer: ${value}`
        );
        return null;
    }

    return svgDataUrl(svg);
}

function renderInlineAssetSvg(identity) {
    switch (identity) {
        case 'dynamite-stick':
            return makeDynamiteStickSvg();

        case 'bundle-of-dynamite':
            return makeBundleOfDynamiteSvg();

        case 'bomb':
            return makeBombSvg();

        case 'tnt':
            return makeTntSvg();

        case 'plastic-explosives':
            return makePlasticExplosivesSvg();

        default:
            return null;
    }
}

function makeMiningToolSvg(body) {
    return `
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 100 100"
            width="100"
            height="100"
        >
            ${body}
        </svg>
    `;
}

function fuseSvg(path, sparkX, sparkY) {
    return `
        <path
            d="${path}"
            fill="none"
            stroke="#363636"
            stroke-width="7"
            stroke-linecap="round"
        />
        <path
            d="${path}"
            fill="none"
            stroke="#b18b4f"
            stroke-width="3.2"
            stroke-linecap="round"
        />
        <g transform="translate(${sparkX} ${sparkY})">
            <path
                d="M0 -8 L0 -14 M6 -5 L11 -10 M8 1 L15 1 M-6 -5 L-11 -10"
                fill="none"
                stroke="#f3b632"
                stroke-width="3"
                stroke-linecap="round"
            />
            <circle cx="0" cy="0" r="4.3" fill="#ff7a19"/>
            <circle cx="0" cy="0" r="1.8" fill="#fff4aa"/>
        </g>
    `;
}

function makeDynamiteStickSvg() {
    return makeMiningToolSvg(`
        ${fuseSvg('M57 24 C61 13 72 13 76 6', 76, 6)}
        <rect
            x="34"
            y="21"
            width="32"
            height="69"
            rx="8"
            fill="#c9312f"
            stroke="#6e1718"
            stroke-width="4"
        />
        <ellipse
            cx="50"
            cy="22"
            rx="15"
            ry="5"
            fill="#e7524e"
            stroke="#6e1718"
            stroke-width="3"
        />
        <rect x="37" y="39" width="26" height="7" rx="2" fill="#382b29"/>
        <rect x="37" y="65" width="26" height="7" rx="2" fill="#382b29"/>
        <path
            d="M40 30 C43 27 47 27 50 27"
            fill="none"
            stroke="#f17a70"
            stroke-width="3"
            stroke-linecap="round"
            opacity=".65"
        />
    `);
}

function makeBundleOfDynamiteSvg() {
    return makeMiningToolSvg(`
        ${fuseSvg('M54 23 C58 14 68 13 72 5', 72, 5)}
        <g stroke="#6e1718" stroke-width="3.5">
            <rect x="20" y="26" width="24" height="59" rx="7" fill="#ba2a2a"/>
            <rect x="38" y="19" width="25" height="69" rx="7" fill="#d33a36"/>
            <rect x="57" y="27" width="24" height="58" rx="7" fill="#b92727"/>
        </g>
        <rect x="17" y="43" width="67" height="10" rx="3" fill="#2d2927"/>
        <rect x="18" y="66" width="65" height="10" rx="3" fill="#2d2927"/>
        <path
            d="M43 27 C47 24 52 24 55 25"
            fill="none"
            stroke="#f17a70"
            stroke-width="3"
            stroke-linecap="round"
            opacity=".7"
        />
    `);
}

function makeBombSvg() {
    return makeMiningToolSvg(`
        ${fuseSvg('M62 28 C66 17 76 15 80 7', 80, 7)}
        <path
            d="M44 31 L56 31 L60 39 L40 39 Z"
            fill="#656565"
            stroke="#282828"
            stroke-width="4"
            stroke-linejoin="round"
        />
        <circle
            cx="50"
            cy="61"
            r="30"
            fill="#777a7c"
            stroke="#262626"
            stroke-width="5"
        />
        <path
            d="M31 45 C37 37 48 33 57 34"
            fill="none"
            stroke="#b7b9ba"
            stroke-width="5"
            stroke-linecap="round"
            opacity=".7"
        />
        <ellipse cx="55" cy="81" rx="17" ry="5" fill="#505355" opacity=".4"/>
    `);
}

function makeTntSvg() {
    return makeMiningToolSvg(`
        ${fuseSvg('M55 20 C60 11 70 11 74 4', 74, 4)}
        <rect
            x="27"
            y="20"
            width="46"
            height="70"
            rx="9"
            fill="#c92f2c"
            stroke="#681718"
            stroke-width="4"
        />
        <ellipse
            cx="50"
            cy="21"
            rx="21"
            ry="6"
            fill="#e34a45"
            stroke="#681718"
            stroke-width="3"
        />
        <rect x="28" y="42" width="44" height="24" fill="#f2e3c7"/>
        <text
            x="50"
            y="60"
            text-anchor="middle"
            font-family="Arial, sans-serif"
            font-size="22"
            font-weight="900"
            fill="#2b2522"
        >TNT</text>
        <path d="M34 31 L34 38" stroke="#f16d66" stroke-width="4" stroke-linecap="round"/>
    `);
}

function makePlasticExplosivesSvg() {
    return makeMiningToolSvg(`
        <path
            d="M18 35 L27 23 L77 20 L86 31 L82 78 L70 87 L24 84 L14 73 Z"
            fill="#879566"
            stroke="#343a2c"
            stroke-width="4"
            stroke-linejoin="round"
        />
        <path
            d="M27 31 L72 28 L76 34 L72 75 L29 77 L23 69 Z"
            fill="#aab68a"
            opacity=".72"
        />
        <rect
            x="37"
            y="45"
            width="28"
            height="20"
            rx="2"
            fill="#52594a"
            stroke="#292d26"
            stroke-width="3"
        />
        <circle cx="44" cy="55" r="3" fill="#d8cf65"/>
        <circle cx="58" cy="55" r="3" fill="#b44a42"/>
        <path
            d="M45 45 C38 33 37 23 42 15"
            fill="none"
            stroke="#a82f2c"
            stroke-width="3.5"
            stroke-linecap="round"
        />
        <path
            d="M57 45 C64 34 69 24 66 14"
            fill="none"
            stroke="#2f383b"
            stroke-width="3.5"
            stroke-linecap="round"
        />
    `);
}

// ------------------------------------------------------------------------
// INLINE NAVIGATION SVG ARTWORK
// ------------------------------------------------------------------------

const NAV_ARROW_HASHES = new Map([
    /* Authoritatively mapped diagonal base64 payloads. */
    ['1563e943', 'NE'],
    ['ebe24f2e', 'SE'],
    ['fa4475fa', 'SW'],
    ['44255e60', 'NW']
]);

const NAV_ARROW_FILENAMES = new Map([
    ['1', 'N'],
    ['2', 'E'],
    ['3', 'S'],
    ['4', 'W'],
    ['5', 'NE'],
    ['6', 'SE'],
    ['7', 'SW'],
    ['8', 'NW']
]);

const NAV_ARROW_ROTATIONS = Object.freeze({
    N: 0,
    NE: 45,
    E: 90,
    SE: 135,
    S: 180,
    SW: 225,
    W: 270,
    NW: 315
});

function processNavigationArrow(image) {
    const direction = identifyNavigationArrow(image);

    if (!direction) {
        return false;
    }

    const dimensions = getRenderedDimensions(image);

    if (!dimensions) {
        queueImageRetry(image);
        return true;
    }

    const svg = makeNavigationArrowSvg(
        direction,
        dimensions.width,
        dimensions.height
    );

    const originalSrc = image.getAttribute('src') || '';

    image.dataset.daliName = `Navigation ${direction}`;
    image.dataset.daliCategory = 'navigation';
    image.dataset.daliOriginalSrc = originalSrc;
    image.dataset.daliDirection = direction;
    image.dataset.daliState = 'replaced';
    image.dataset.daliGeneration = String(CATALOG_GENERATION);

    image.style.width = `${dimensions.width}px`;
    image.style.height = `${dimensions.height}px`;
    image.style.objectFit = 'contain';
    image.style.objectPosition = 'center';
    image.style.background = 'transparent';

    image.removeAttribute('srcset');
    image.removeAttribute('sizes');

    image.src = svgDataUrl(svg);

    return true;
}

function identifyNavigationArrow(image) {
    const src = image.getAttribute('src') || '';
    const hash = dataSrcHash(src);

    if (hash && NAV_ARROW_HASHES.has(hash)) {
        return NAV_ARROW_HASHES.get(hash);
    }

    const filenameMatch = src.match(
        /\/images\/xmove_([1-8])\.gif(?:\.pagespeed\.[^?#]+)?/i
    );

    if (!filenameMatch) {
        return null;
    }

    return NAV_ARROW_FILENAMES.get(filenameMatch[1]) || null;
}

function makeNavigationArrowSvg(direction, width, height) {
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    const cx = w / 2;
    const cy = h / 2;
    const rotation = NAV_ARROW_ROTATIONS[direction] || 0;

    const margin = Math.max(2, Math.min(w, h) * 0.08);
    const headY = margin;
    const shoulderY = h * 0.46;
    const tailY = h - margin;
    const halfHead = Math.min(w * 0.43, h * 0.43);
    const halfStem = Math.max(2, Math.min(w, h) * 0.13);
    const strokeWidth = Math.max(2, Math.min(w, h) * 0.095);

    const path = [
        `M ${cx} ${headY}`,
        `L ${cx + halfHead} ${shoulderY}`,
        `L ${cx + halfStem} ${shoulderY}`,
        `L ${cx + halfStem} ${tailY}`,
        `L ${cx - halfStem} ${tailY}`,
        `L ${cx - halfStem} ${shoulderY}`,
        `L ${cx - halfHead} ${shoulderY}`,
        'Z'
    ].join(' ');

    return `
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 ${w} ${h}"
            width="${w}"
            height="${h}"
        >
            <g transform="rotate(${rotation} ${cx} ${cy})">
                <path
                    d="${path}"
                    fill="#d00"
                    stroke="#000"
                    stroke-width="${strokeWidth}"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                />
            </g>
        </svg>
    `;
}

function makeSlotSvg(body) {
    return `
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 100 100"
            width="100"
            height="100"
        >
            <rect
                x="2"
                y="2"
                width="96"
                height="96"
                fill="#000000"
            />
            ${body}
        </svg>
    `;
}

// ------------------------------------------------------------------------
// SYMBOL PRIMITIVES
// ------------------------------------------------------------------------

function cherrySvg(x, y, scale = 1) {
    return `
        <g transform="translate(${x} ${y}) scale(${scale})">
            <!-- stem -->
            <path
                d="M0 -15
                   C-7 -28 12 -37 -5 -47"
                fill="none"
                stroke="#08a83d"
                stroke-width="2.2"
                stroke-linecap="round"
            />

            <!-- cherry -->
            <circle
                cx="0"
                cy="0"
                r="14"
                fill="#f51c29"
                stroke="#9d0010"
                stroke-width="1.4"
            />

            <!-- highlight -->
            <path
                d="M-8 -7
                   C-7 -14 -1 -14 4 -13"
                fill="none"
                stroke="#ff6e78"
                stroke-width="2.1"
                stroke-linecap="round"
            />
        </g>
    `;
}

function coinSvg(x, y, scale = 1) {
    return `
        <g transform="translate(${x} ${y}) scale(${scale})">
            <circle
                cx="0"
                cy="0"
                r="15"
                fill="#ffd124"
                stroke="#c79b00"
                stroke-width="1.6"
            />

            <path
                d="M-10 -9
                   C-13 -3 -13 5 -9 10"
                fill="none"
                stroke="#fff071"
                stroke-width="1.8"
                stroke-linecap="round"
            />

            <!-- dollar symbol -->
            <path
                d="M2 -12
                   L2 12

                   M8 -8
                   C5 -11 -5 -11 -7 -6
                   C-9 -1 -4 2 2 3
                   C8 4 10 7 7 11
                   C3 15 -6 13 -9 9"
                fill="none"
                stroke="#d5a800"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </g>
    `;
}

function canSvg(x, y, scale = 1) {
    return `
        <g transform="translate(${x} ${y}) scale(${scale})">
            <!-- body -->
            <path
                d="M-13 -15
                   L-13 14
                   C-13 18 13 18 13 14
                   L13 -15
                   Z"
                fill="#1d9845"
                stroke="#08702e"
                stroke-width="1"
            />

            <!-- top -->
            <ellipse
                cx="0"
                cy="-15"
                rx="13"
                ry="4.5"
                fill="#c7c7c7"
                stroke="#666"
                stroke-width="1"
            />

            <!-- pull tab -->
            <path
                d="M1 -17
                   L7 -16
                   L9 -14
                   L5 -13
                   L0 -15
                   Z"
                fill="#b2a77c"
                stroke="#555"
                stroke-width=".7"
            />

            <path
                d="M0 -16
                   L-5 -17"
                fill="none"
                stroke="#555"
                stroke-width=".8"
            />

            <!-- bottom rim -->
            <path
                d="M-12.5 14
                   C-6 17 6 17 12.5 14"
                fill="none"
                stroke="#77d194"
                stroke-width=".8"
            />
        </g>
    `;
}

function sevenSvg(x, y, scale = 1) {
    /*
     * Three-tone Seven:
     * red outer edge -> white inner edge -> gray body.
     */
    const sevenPath = `
        M-13 -18
        L14 -18
        L14 -12
        C6 -4 0 5 -4 18
        L-11 21
        C-8 7 -2 -4 6 -11
        L-13 -11
        Z
    `;

    return `
        <g transform="translate(${x} ${y}) scale(${scale})">
            <path
                d="${sevenPath}"
                fill="#c5c5c5"
                stroke="#ed1c24"
                stroke-width="3.4"
                stroke-linejoin="miter"
            />

            <path
                d="${sevenPath}"
                fill="#c5c5c5"
                stroke="#ffffff"
                stroke-width="1.5"
                stroke-linejoin="miter"
            />
        </g>
    `;
}

function barSvg(x, y, scale = 1) {
    return `
        <g transform="translate(${x} ${y}) scale(${scale})">

            <!-- plate -->
            <rect
                x="-27"
                y="-8"
                width="54"
                height="16"
                fill="#9e9e9e"
                stroke="#ffffff"
                stroke-width=".8"
            />

            <!--
                Stylized BAR lettering.
                These are shapes rather than dependent on a browser font.
            -->

            <!-- B -->
            <path
                d="M-22 5
                   L-18 -5
                   L-11 -5
                   C-6 -5 -5 -1 -9 1
                   C-5 2 -6 6 -12 6
                   Z

                   M-16 -2
                   L-12 -2
                   C-10 -2 -10 0 -12 0
                   L-17 0
                   Z

                   M-17 2
                   L-12 2
                   C-9 2 -10 4 -13 4
                   L-18 4
                   Z"
                fill="#000000"
                stroke="#ffffff"
                stroke-width=".7"
                stroke-linejoin="round"
            />

            <!-- A -->
            <path
                d="M-5 6
                   L2 -6
                   L7 -6
                   L11 6
                   L7 6
                   L6 2
                   L0 2
                   L-2 6
                   Z

                   M2 -1
                   L5 -1
                   L4 -4
                   Z"
                fill="#000000"
                stroke="#ffffff"
                stroke-width=".7"
                stroke-linejoin="round"
            />

            <!-- R -->
            <path
                d="M13 6
                   L16 -6
                   L23 -6
                   C29 -6 29 -1 24 1
                   L28 6
                   L23 6
                   L20 2
                   L18 2
                   L17 6
                   Z

                   M19 -3
                   L22 -3
                   C25 -3 25 -1 22 0
                   L18 0
                   Z"
                fill="#000000"
                stroke="#ffffff"
                stroke-width=".7"
                stroke-linejoin="round"
            />
        </g>
    `;
}

// ------------------------------------------------------------------------
// SLOT COMPOSITIONS
// ------------------------------------------------------------------------

    function renderSlotSymbol(identity) {
        switch (identity) {

            // ------------------------------------------------------------
            // CHERRIES
            // ------------------------------------------------------------

            case '1 Cherry':
                return makeSlotSvg(
                    cherrySvg(50, 58, 1.25)
                );

            case '2 Cherries':
                return makeSlotSvg(
                    cherrySvg(34, 60, 1.05) +
                    cherrySvg(67, 60, 1.05)
                );

            case '3 Cherries':
                return makeSlotSvg(
                    cherrySvg(50, 38, 0.92) +
                    cherrySvg(27, 67, 0.92) +
                    cherrySvg(73, 67, 0.92)
                );

            // ------------------------------------------------------------
            // COINS
            // ------------------------------------------------------------

            case '1 Coin':
                return makeSlotSvg(
                    coinSvg(50, 50, 1.35)
                );

            case '2 Coins':
                return makeSlotSvg(
                    coinSvg(32, 36, 1.05) +
                    coinSvg(68, 64, 1.05)
                );

            case '3 Coins':
                return makeSlotSvg(
                    coinSvg(29, 34, 0.96) +
                    coinSvg(71, 34, 0.96) +
                    coinSvg(50, 70, 0.96)
                );

            // ------------------------------------------------------------
            // CANS
            // ------------------------------------------------------------

            case '1 Can':
                return makeSlotSvg(
                    canSvg(50, 51, 1.35)
                );

            case '2 Cans':
                return makeSlotSvg(
                    canSvg(34, 52, 1.12) +
                    canSvg(67, 52, 1.12)
                );

            case '3 Cans':
                return makeSlotSvg(
                    canSvg(50, 34, 0.98) +
                    canSvg(27, 66, 0.98) +
                    canSvg(73, 66, 0.98)
                );

            // ------------------------------------------------------------
            // BARS
            // ------------------------------------------------------------

            case '1 Bar':
                return makeSlotSvg(
                    barSvg(50, 50, 1.32)
                );

            case '2 Bars':
                return makeSlotSvg(
                    barSvg(50, 39, 1.18) +
                    barSvg(50, 62, 1.18)
                );

            case '3 Bars':
                return makeSlotSvg(
                    barSvg(50, 27, 1.08) +
                    barSvg(50, 50, 1.08) +
                    barSvg(50, 73, 1.08)
                );

            // ------------------------------------------------------------
            // SEVENS
            // ------------------------------------------------------------

            case '7':
                return makeSlotSvg(
                    sevenSvg(50, 50, 1.55)
                );

            case '77':
                return makeSlotSvg(
                    sevenSvg(32, 53, 1.18) +
                    sevenSvg(68, 53, 1.18)
                );

            case '777':
                return makeSlotSvg(
                    sevenSvg(50, 31, 1.10) +
                    sevenSvg(29, 65, 1.10) +
                    sevenSvg(71, 65, 1.10)
                );

            default:
                return null;
        }
    }
// ------------------------------------------------------------------------
// TATTOOS
// ------------------------------------------------------------------------

    function processTattoo(image) {
        const rawAlt = image.getAttribute('alt') || '';
        const name = canonicalizeTattooName(rawAlt);

        if (!name) {
            return false;
        }

        const entry = getCatalogEntry(
            'tattoos',
            name
        );

        if (!entry) {
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry
        );
    }

    function canonicalizeTattooName(value) {
        if (!value) {
            return null;
        }

        const normalized = String(value)
            .replace(/\.(?:gif|png|jpe?g|webp)$/i, '')
            .replace(/-(1|2|3)$/i, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const entry = Object.keys(REPLACEMENTS.tattoos)
            .find(name =>
                normalizeTattooName(name) === normalized
            );

        return entry || null;
    }

    function normalizeTattooName(value) {
        return String(value || '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getTattooFade(image) {
        const src = image.getAttribute('src') || '';

        // Primary source of truth: native tattoo filename.
        const srcMatch = src.match(
            /-(1|2|3)\.gif(?:[?#].*)?$/i
        );

        if (srcMatch) {
            return Number.parseInt(
                srcMatch[1],
                10
            );
        }

        /*
         * Fallback for data/base64 native imagery:
         *
         * 30–21 days = stage 3
         * 20–11 days = stage 2
         * 10–1 days  = stage 1
         */
        const title = image.getAttribute('title') || '';

        const titleMatch = title.match(
            /\((\d+)\s+days?\s+left\)/i
        );

        if (!titleMatch) {
            return null;
        }

        const days = Number.parseInt(
            titleMatch[1],
            10
        );

        if (days >= 21 && days <= 30) {
            return 3;
        }

        if (days >= 11 && days <= 20) {
            return 2;
        }

        if (days >= 1 && days <= 10) {
            return 1;
        }

        return null;
    }

// ------------------------------------------------------------------------
// BERNARD'S SPECIAL ITEMS
// ------------------------------------------------------------------------

    function processBernardsSpecialItem(image) {
        const identity = identifyBernardsSpecialItem(image);

        if (!identity) {
            return false;
        }

        const entry = getCatalogEntry(
            'bernardsSpecialItems',
            identity
        );

        if (!entry) {
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry
        );
    }

    function identifyBernardsSpecialItem(image) {
        const candidates = [
            image.getAttribute('alt'),
            image.getAttribute('title'),
            image.getAttribute('src')
        ];

        for (const candidate of candidates) {
            const identity = findCatalogMatch(
                candidate,
                REPLACEMENTS.bernardsSpecialItems
            );

            if (identity) {
                return identity;
            }
        }

        /*
         * Some Bernard's Special Items are served as base64 imagery
         * with no useful filename/alt identity. Their immediate <center>
         * container contains the canonical displayed item name.
         */
        const itemContainer = image.closest('center');

        if (itemContainer) {
            const containerText =
                itemContainer.textContent || '';

            for (
                const name of
                Object.keys(REPLACEMENTS.bernardsSpecialItems)
            ) {
                const normalizedContainer =
                    normalizeAssetName(containerText);

                const normalizedName =
                    normalizeAssetName(name);

                if (
                    normalizedContainer === normalizedName ||
                    normalizedContainer.startsWith(
                        `${normalizedName} `
                    )
                ) {
                    return name;
                }
            }
        }

        return null;
    }

// ------------------------------------------------------------------------
// BACKPACK ITEMS
// ------------------------------------------------------------------------

    function processBackpackItem(image) {
        const identity = identifyBackpackItem(image);

        if (!identity) {
            return false;
        }

        const entry = getCatalogEntry(
            'backpackItems',
            identity
        );

        if (!entry) {
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry
        );
    }

    function identifyBackpackItem(image) {
        const candidates = [
            image.getAttribute('alt'),
            image.getAttribute('title'),
            image.getAttribute('src')
        ];

        /*
         * Prefer identity attached directly to the image.
         */
        for (const candidate of candidates) {
            const identity = findCatalogMatch(
                candidate,
                REPLACEMENTS.backpackItems
            );

            if (identity) {
                return identity;
            }
        }

        /*
         * Some Backpack items can be base64 images with no useful
         * filename or alt text.
         *
         * Only inspect the item's immediate semantic container, and
         * require its displayed text to BEGIN with the item name.
         *
         * This prevents:
         *
         * "Championship Belt + Care Package"
         *
         * from causing the Championship Belt image to be identified
         * as a Care Package.
         */
        const container = image.closest('center, td');

        if (!container) {
            return null;
        }

        const containerText =
            normalizeAssetName(container.textContent || '');

        for (
            const name of
            Object.keys(REPLACEMENTS.backpackItems)
        ) {
            const normalizedName =
                normalizeAssetName(name);

            if (
                containerText === normalizedName ||
                containerText.startsWith(
                    `${normalizedName} `
                )
            ) {
                return name;
            }
        }

        return null;
    }

// ------------------------------------------------------------------------
// CURRENCY
// ------------------------------------------------------------------------

    function processCurrency(image) {
        const identity = identifyCurrency(image);

        if (!identity) {
            return false;
        }

        const entry = getCatalogEntry(
            'currencies',
            identity
        );

        if (!entry) {
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry
        );
    }

    function findCurrencyMatch(rawValue) {
        const normalized = normalizeAssetName(rawValue);

        if (!normalized) {
            return null;
        }

        /*
         * Native Donator imagery may append a remaining-time suffix such as:
         *
         *     Donator (36 days)
         *
         * Strip only that trailing parenthetical day-count for alias matching.
         */
        const aliasCandidate = normalized.replace(
            /\s*\(\d+\s+days?\)\s*$/i,
            ''
        );

        /*
         * DP and DPs are deliberately case-sensitive.
         */
        if (
            aliasCandidate === 'DP' ||
            aliasCandidate === 'DPs'
        ) {
            return 'Donator Packs';
        }

        /*
         * The written-out Donator aliases are case-insensitive because native
         * pages are not required to preserve one exact capitalization.
         */
        for (const [alias, canonical] of Object.entries(CURRENCY_ALIASES)) {
            if (
                alias === 'DP' ||
                alias === 'DPs'
            ) {
                continue;
            }

            if (
                normalizeAssetName(alias).toLowerCase() ===
                aliasCandidate.toLowerCase()
            ) {
                return canonical;
            }
        }

        return findCatalogMatch(
            rawValue,
            REPLACEMENTS.currencies
        );
    }

    function identifyCurrency(image) {
        const candidates = [
            image.getAttribute('alt'),
            image.getAttribute('title'),
            image.getAttribute('src')
        ];

        for (const candidate of candidates) {
            const match = findCurrencyMatch(candidate);

            if (match) {
                return match;
            }
        }

        const cell = image.closest('td, div, a');
        const text = normalizeAssetName(cell?.textContent || '');

        for (const name of Object.keys(REPLACEMENTS.currencies)) {
            const normalizedName = normalizeAssetName(name);

            const escapedName = normalizedName.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

            const pattern = new RegExp(
                `^(?:\\d[\\d,]*\\s+)?${escapedName}(?:\\s|$)`,
                'i'
            );

            if (pattern.test(text)) {
                return name;
            }
        }

        return null;
    }

// ------------------------------------------------------------------------
// SLOT MACHINE SYMBOLS
// ------------------------------------------------------------------------

    function processSlotSymbol(image) {
        const identity = identifySlotSymbol(image);

        if (!identity) {
            return false;
        }

        const svg = renderSlotSymbol(identity);

        if (!svg) {
            return false;
        }

        replaceImage(
            image,
            identity,
            svgDataUrl(svg),
            'slot-symbol'
        );

        return true;
    }

    function identifySlotSymbol(image) {
        const src = image.getAttribute('src') || '';
        const hash = dataSrcHash(src);

    // ------------------------------------------------------------
    // Filename / pagespeed-backed native slot imagery
    // ------------------------------------------------------------

        if (/\/images\/slots\/xslot1\.gif/i.test(src)) return '1 Cherry';
        if (/\/images\/slots\/xslot2\.gif/i.test(src)) return '2 Cherries';
        if (/\/images\/slots\/xslot3\.gif/i.test(src)) return '3 Cherries';

        if (/\/images\/slots\/xslot4\.gif/i.test(src)) return '1 Coin';
        if (/\/images\/slots\/xslot5\.gif/i.test(src)) return '2 Coins';
        if (/\/images\/slots\/xslot6\.gif/i.test(src)) return '3 Coins';

        if (/\/images\/slots\/xslot7\.gif/i.test(src)) return '1 Bar';
        if (/\/images\/slots\/xslot8\.gif/i.test(src)) return '2 Bars';
        if (/\/images\/slots\/xslot9\.gif/i.test(src)) return '3 Bars';

        if (/\/images\/slots\/xslot10\.gif/i.test(src)) return '1 Can';
        if (/\/images\/slots\/xslot11\.gif/i.test(src)) return '2 Cans';
        if (/\/images\/slots\/xslot12\.gif/i.test(src)) return '3 Cans';

        if (/\/images\/slots\/xslot13\.gif/i.test(src)) return '7';
        if (/\/images\/slots\/xslot14\.gif/i.test(src)) return '77';
        if (/\/images\/slots\/slot15\.gif/i.test(src)) return '777';

    // ------------------------------------------------------------
    // Base64/native data:image variants
    // ------------------------------------------------------------

        if (hash === 'e8d44d0f') return '1 Cherry';
        if (hash === '95ff0aa0') return '2 Cherries';
        if (hash === '2476a1a6') return '3 Cherries';

        if (hash === 'eafcac0f') return '1 Coin';
        if (hash === '9bc9b519') return '2 Coins';
        if (hash === 'f6d17a75') return '3 Coins';

        if (hash === '410ce95f') return '1 Bar';
        if (hash === 'be0ecb00') return '2 Bars';
        if (hash === 'ed9f889f') return '3 Bars';

        if (hash === 'e54dba89') return '1 Can';
        if (hash === 'e9d8388b') return '2 Cans';
        if (hash === '61161a21') return '3 Cans';

        if (hash === 'aead0336') return '7';
        if (hash === 'ef44560d') return '77';
        if (hash === 'bad82abb') return '777';

        return null;
    }

// ------------------------------------------------------------------------
// EQUIPMENT
// ------------------------------------------------------------------------

    function processEquipment(image) {
        const itemName =
            identifyEquipmentFromAttributes(image) ||
            identifyEquipmentFromCell(image) ||
            identifyEquipmentFromRow(image) ||
            identifyEquipmentFromSource(image);

        if (!itemName) {
            return false;
        }

        const entry = getCatalogEntry(
            'equipment',
            itemName
        );

        if (!entry) {
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry
        );
    }

    /*
     * Direct image attributes are preferred whenever they actually identify
     * the equipment item.
     */
    function identifyEquipmentFromAttributes(image) {
        const candidates = [
            image.getAttribute('alt'),
            image.getAttribute('title'),
            image.getAttribute('aria-label')
        ];

        for (const candidate of candidates) {
            const itemName =
                canonicalizeEquipmentName(candidate);

            if (itemName) {
                return itemName;
            }
        }

        return null;
    }

    /*
     * Some native equipment views, particularly the equipped-item strip,
     * serve images as base64 data URIs. The individual table cell is the
     * narrowest reliable semantic container for those items.
     */
    function identifyEquipmentFromCell(image) {
        const cell = image.closest('td');

        if (!cell) {
            return null;
        }

        const text = normalizeEquipmentName(
            cell.textContent
        );

        const matches = EQUIPMENT_NAMES.filter(name =>
            containsEquipmentName(text, name)
        );

        return matches.length === 1
            ? matches[0]
            : null;
    }

    /*
     * Table rows are treated as indivisible item records.
     *
     * This is particularly important on wiki.hobowars.com:
     * DALI must NEVER escape an individual equipment row and begin matching
     * names found elsewhere in the containing table.
     */
    function identifyEquipmentFromRow(image) {
        const row = image.closest('tr');

        if (!row) {
            return null;
        }

        const text = normalizeEquipmentName(
            row.textContent
        );

        const matches = EQUIPMENT_NAMES.filter(name =>
            containsEquipmentName(text, name)
        );

        return matches.length === 1
            ? matches[0]
            : null;
    }

    /*
     * Filename matching is useful wherever native item image URLs remain
     * available.
     *
     * data/base64 sources deliberately do not participate here because they
     * contain no meaningful filename identity.
     */
    function identifyEquipmentFromSource(image) {
        const src = String(
            image.getAttribute('src') || ''
        );

        if (!src || src.startsWith('data:')) {
            return null;
        }

        let filename =
            src.split(/[?#]/)[0]
                .split('/')
                .pop() || '';

        try {
            filename = decodeURIComponent(filename);
        } catch (error) {
            // Keep the undecoded filename.
        }

        if (
            /^x/i.test(filename) &&
            /\.pagespeed\./i.test(filename)
        ) {
            filename = filename.slice(1);
        }

        filename = filename.replace(
            /\.(?:gif|png|jpe?g|webp)(?:\.pagespeed\..*)?$/i,
            ''
        );

        return canonicalizeEquipmentName(filename);
    }

// ------------------------------------------------------------------------
// IMAGE REPLACEMENT
// ------------------------------------------------------------------------

    function replaceImage(
        image,
        name,
        replacementUrl,
        category,
        path = null
    ) {
        const dimensions =
            getRenderedDimensions(image);

        if (!dimensions) {
            queueImageRetry(image);
            return false;
        }

        const originalSrc =
            image.getAttribute('src') || '';

        image.dataset.daliName = name;
        image.dataset.daliCategory = category;
        image.dataset.daliOriginalSrc = originalSrc;
        image.dataset.daliState = 'replaced';
        image.dataset.daliGeneration = String(CATALOG_GENERATION);

        if (Array.isArray(path)) {
            image.dataset.daliPath = path.join('/');
        }

        image.style.width =
            `${dimensions.width}px`;

        image.style.height =
            `${dimensions.height}px`;

        image.style.objectFit = 'cover';
        image.style.objectPosition = 'center';

        image.removeAttribute('srcset');
        image.removeAttribute('sizes');

        image.src = replacementUrl;
        return true;
    }

    function queueImageRetry(image) {
        if (image.dataset.daliPending) {
            return;
        }

        image.dataset.daliPending = 'true';

        const retry = () => {
            delete image.dataset.daliPending;
            delete image.dataset.daliState;
            delete image.dataset.daliGeneration;
            processImage(image);
        };

        /*
         * Cached native images can already be complete by the time a
         * document-start MutationObserver callback reaches them. In that case
         * attaching a one-shot load listener is too late and the replacement
         * can remain stranded forever. Retry after layout instead.
         */
        if (image.complete) {
            requestAnimationFrame(() =>
                requestAnimationFrame(retry)
            );
            return;
        }

        image.addEventListener(
            'load',
            retry,
            { once: true }
        );
    }

    function getRenderedDimensions(image) {
        const rect = image.getBoundingClientRect();

        const width =
            rect.width ||
            numericDimension(
                image.getAttribute('width')
            ) ||
            image.width ||
            image.naturalWidth;

        const height =
            rect.height ||
            numericDimension(
                image.getAttribute('height')
            ) ||
            image.height ||
            image.naturalHeight;

        if (
            !(width > 0) ||
            !(height > 0)
        ) {
            return null;
        }

        return {
            width,
            height
        };
    }

// ------------------------------------------------------------------------
// NAME HANDLING
// ------------------------------------------------------------------------

    function canonicalizeEquipmentName(value) {
        if (!value) {
            return null;
        }

        let normalized =
            normalizeEquipmentName(value);

        /*
         * Native alt attributes frequently expose the image filename rather
         * than a display-name string.
         */
        normalized = normalized.replace(
            /\.(?:gif|png|jpe?g|webp)$/i,
            ''
        );

        return NORMALIZED_EQUIPMENT_NAMES.get(
            normalized.toLowerCase()
        ) || null;
    }

    function containsEquipmentName(
        text,
        itemName
    ) {
        if (!text) {
            return false;
        }

        const normalizedItem =
            normalizeEquipmentName(itemName);

        const escaped =
            normalizedItem.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

        return new RegExp(
            `(?:^|\\s|[\\[(])${escaped}(?=$|\\s|[\\])(:,])`,
            'i'
        ).test(text);
    }

    function normalizeEquipmentName(value) {
        return String(value || '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }


    function numericDimension(value) {
        const number = Number.parseFloat(value);

        return Number.isFinite(number)
            ? number
            : 0;
    }
})();
