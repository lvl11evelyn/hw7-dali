// ==UserScript==
// @name         HW Dynamically Adapted Legacy Images
// @namespace    https://www.hobowars.com/
// @version      2.27
// @description  DALI seeks out native, legacy images in the Hobowars domain and substitutes them while retaining their dimensions for a crisper, more contemporary aesthetic.
// @author       lvl11evelyn / HW1 (2924238)
// @match        *://hobowars.com/*
// @match        *://*.hobowars.com/*
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/lvl11evelyn/hw7-dali/main/HW%20Dynamically%20Adapted%20Legacy%20Images.user.js
// @downloadURL  https://raw.githubusercontent.com/lvl11evelyn/hw7-dali/main/HW%20Dynamically%20Adapted%20Legacy%20Images.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
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

    const ASSET_MAP_CACHE_TIME_KEY =
        'hw-dali-asset-map-cache-fetched-at-v1';

    const ID_REGISTRY_URL =
        'https://raw.githubusercontent.com/lvl11evelyn/hw7-dali/main/assets/dali-id-registry.json';

    const REJECTION_REGISTRY_URL =
        'https://raw.githubusercontent.com/lvl11evelyn/hw7-dali/main/assets/dali-rejection-registry.json';

    const SVG_CATALOG_URL =
        'https://raw.githubusercontent.com/lvl11evelyn/hw7-dali/main/assets/dali-svg-catalog.json';

    const REMOTE_AUX_TTL_MS = 12 * 60 * 60 * 1000;

    const ID_REGISTRY_CACHE_KEY =
        'hw-dali-id-registry-cache-v1';

    const REJECTION_REGISTRY_CACHE_KEY =
        'hw-dali-rejection-registry-cache-v1';

    const SVG_CATALOG_CACHE_KEY =
        'hw-dali-svg-catalog-cache-v1';

    const LEARNING_STORAGE_KEY =
        'hw-dali-learning-state-v1';

    let REPLACEMENTS = null;
    let ASSET_MAP_SIGNATURE = '';
    let CATALOG_GENERATION = 0;

    let EQUIPMENT_NAMES = [];
    let NORMALIZED_EQUIPMENT_NAMES = new Map();
    let DALI_OBSERVER = null;
    let SCAN_FRAME = 0;
    let FULL_SCAN_QUEUED = false;
    const SCAN_ROOTS = new Set();

    /*
     * The authoritative identity index contains every named leaf in the
     * external asset map, including entries whose replacement URL is null.
     *
     * DALI is deliberately fail-closed: an image must resolve to exactly one
     * known catalog identity before ordinary catalog replacement is allowed.
     * Unknown or ambiguous imagery is left untouched.
     */
    let CATALOG_IDENTITY_INDEX = new Map();

    /*
     * One native image node gets one immutable examination snapshot.
     *
     * DALI may revisit an unresolved node when a remote catalog arrives or a
     * layout retry becomes possible, but learning evidence must always refer
     * to the native image state captured before DALI adapts it. WeakMap keeps
     * even large base64 sources out of DOM data attributes.
     */
    const IMAGE_EXAMINATIONS = new WeakMap();

    let ID_REGISTRY = null;
    let ID_REGISTRY_SIGNATURE = '';
    let ID_REGISTRY_READY = false;
    let ID_EXACT_FILENAME_INDEX = new Map();
    let ID_FILENAME_INDEX = new Map();
    let ID_HASH_INDEX = new Map();

    let REJECTION_REGISTRY = null;
    let REJECTION_REGISTRY_SIGNATURE = '';
    let REJECTION_INDEX = new Set();

    const REJECTION_CANON_CONFIDENCE_MIN = 0.75;

    /*
     * Optional local runtime identity authorities are deliberately isolated
     * from DALI's canonical registry state. They exist only in memory for the
     * current page session and can never write the remote registry, its cache,
     * revision, or sourceCounts. Canonical authority always wins on conflict.
     */
    const LOCAL_IDENTITY_REGISTER_EVENT = 'dali:register-local-identities';
    const LOCAL_IDENTITY_READY_EVENT = 'dali:local-identity-channel-ready';
    const PENDING_SNAPSHOT_REQUEST_EVENT = 'dali:request-pending-snapshot';
    const PENDING_SNAPSHOT_EVENT = 'dali:pending-snapshot';
    const REVIEW_OPENED_EVENT = 'dali:review-opened';
    const REVIEW_CLOSED_EVENT = 'dali:review-closed';

    let LOCAL_FILENAME_INDEX = new Map();
    let LOCAL_HASH_INDEX = new Map();

    let SVG_CATALOG = null;
    let SVG_CATALOG_SIGNATURE = '';

    let LEARNING_STATE = loadLearningState();

    /*
     * DALI starts immediately. The network is never on the critical path.
     * A cached catalog is usable synchronously; a first-run install can still
     * process self-contained SVG families while the remote map is arriving.
     */

    async function refreshRemoteAssetMap(force = false) {
        if (!force) {
            try {
                const fetchedAt = Number(localStorage.getItem(ASSET_MAP_CACHE_TIME_KEY)) || 0;
                if (fetchedAt > 0 && Date.now() - fetchedAt < REMOTE_AUX_TTL_MS) {
                    return;
                }
            } catch {
                // Continue with a network refresh when cache timing is unavailable.
            }
        }

        try {
            const assetMap = await fetchRemoteAssetMap();

            cacheAssetMap(assetMap);

            if (applyAssetMap(assetMap)) {
                /*
                 * Only unresolved / known-unmapped / ambiguous images from an
                 * older catalog generation are reconsidered. Replaced images
                 * remain final and are not churned through the resolver again.
                 */
                queueScan(document);
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
        prunePendingAgainstReplacementPointers();
        return true;
    }

    function cacheAssetMap(assetMap) {
        try {
            localStorage.setItem(
                ASSET_MAP_CACHE_KEY,
                JSON.stringify(assetMap)
            );
            localStorage.setItem(
                ASSET_MAP_CACHE_TIME_KEY,
                String(Date.now())
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

    // ------------------------------------------------------------------------
    // DETERMINISTIC ID REGISTRY / SVG CATALOG
    // ------------------------------------------------------------------------

    function fetchRemoteJson(url, label) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${url}?dali=${Date.now()}`,
                timeout: 10000,

                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`${label} request returned HTTP ${response.status}.`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (error) {
                        reject(new Error(`${label} is not valid JSON: ${error.message}`));
                    }
                },

                onerror() {
                    reject(new Error(`${label} network request failed.`));
                },

                ontimeout() {
                    reject(new Error(`${label} network request timed out.`));
                }
            });
        });
    }

    function readTimedCache(key, validate) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;

            const wrapper = JSON.parse(raw);
            if (!wrapper || typeof wrapper !== 'object') return null;

            validate(wrapper.data);

            return {
                data: wrapper.data,
                fetchedAt: Number(wrapper.fetchedAt) || 0
            };
        } catch (error) {
            console.warn(`[DALI] Cached ${key} is invalid.`, error);
            return null;
        }
    }

    function writeTimedCache(key, data) {
        try {
            localStorage.setItem(
                key,
                JSON.stringify({
                    fetchedAt: Date.now(),
                    data
                })
            );
        } catch (error) {
            console.warn(`[DALI] Unable to cache ${key}.`, error);
        }
    }

    function cacheIsFresh(cached) {
        return Boolean(
            cached &&
            cached.fetchedAt > 0 &&
            Date.now() - cached.fetchedAt < REMOTE_AUX_TTL_MS
        );
    }

    function validateIdRegistry(registry) {
        if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
            throw new Error('ID registry root is not a JSON object.');
        }

        if (registry.schema !== 1) {
            throw new Error(`Unsupported ID registry schema: ${registry.schema}.`);
        }

        if (!registry.sourceCounts || typeof registry.sourceCounts !== 'object') {
            throw new Error('ID registry is missing sourceCounts.');
        }

        if (!registry.identities || typeof registry.identities !== 'object' || Array.isArray(registry.identities)) {
            throw new Error('ID registry is missing identities.');
        }

        let identityCount = 0;
        let filenameCount = 0;
        let fnvCount = 0;
        const exactFilenames = new Map();
        const filenames = new Map();
        const hashes = new Map();

        for (const [registryKey, entry] of Object.entries(registry.identities)) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`Invalid ID registry entry: ${registryKey}.`);
            }

            if (
                typeof entry.catalog !== 'string' || !entry.catalog ||
                typeof entry.identity !== 'string' || !entry.identity ||
                !Array.isArray(entry.path) || entry.path.length < 2 ||
                (
                    entry.exactFilenames !== undefined &&
                    !Array.isArray(entry.exactFilenames)
                ) ||
                !Array.isArray(entry.filenames) ||
                !Array.isArray(entry.hashes)
            ) {
                throw new Error(`Malformed ID registry entry: ${registryKey}.`);
            }

            identityCount += 1;

            for (const filename of entry.exactFilenames || []) {
                const key = String(filename || '').trim();
                if (!key) {
                    throw new Error(`Blank exact filename authority in ${registryKey}.`);
                }

                const existing = exactFilenames.get(key);
                if (existing && existing !== registryKey) {
                    throw new Error(`Conflicting exact filename authority: ${filename}.`);
                }

                exactFilenames.set(key, registryKey);
                filenameCount += 1;
            }

            for (const filename of entry.filenames) {
                const key = normalizeIdentityKey(filename);
                if (!key) throw new Error(`Blank filename authority in ${registryKey}.`);

                const existing = filenames.get(key);
                if (existing && existing !== registryKey) {
                    throw new Error(`Conflicting filename authority: ${filename}.`);
                }

                filenames.set(key, registryKey);
                filenameCount += 1;
            }

            for (const hash of entry.hashes) {
                const key = String(hash || '').trim().toLowerCase();
                if (!/^[0-9a-f]{8}$/.test(key)) {
                    throw new Error(`Invalid FNV authority in ${registryKey}: ${hash}.`);
                }

                const existing = hashes.get(key);
                if (existing && existing !== registryKey) {
                    throw new Error(`Conflicting FNV authority: ${key}.`);
                }

                hashes.set(key, registryKey);
                fnvCount += 1;
            }
        }

        const actual = {
            identity: identityCount,
            filename: filenameCount,
            fnv: fnvCount,
            total: filenameCount + fnvCount
        };

        for (const field of ['identity', 'filename', 'fnv', 'total']) {
            if (Number(registry.sourceCounts[field]) !== actual[field]) {
                throw new Error(
                    `ID registry self-count mismatch for ${field}: declared ${registry.sourceCounts[field]}, actual ${actual[field]}.`
                );
            }
        }

        return registry;
    }

    function applyIdRegistry(registry) {
        validateIdRegistry(registry);

        const signature = JSON.stringify(registry);
        if (signature === ID_REGISTRY_SIGNATURE) {
            ID_REGISTRY_READY = true;
            return false;
        }

        const exactFilenameIndex = new Map();
        const filenameIndex = new Map();
        const hashIndex = new Map();

        for (const [registryKey, entry] of Object.entries(registry.identities)) {
            for (const filename of entry.exactFilenames || []) {
                exactFilenameIndex.set(String(filename).trim(), registryKey);
            }

            for (const filename of entry.filenames) {
                filenameIndex.set(normalizeIdentityKey(filename), registryKey);
            }

            for (const hash of entry.hashes) {
                hashIndex.set(String(hash).toLowerCase(), registryKey);
            }
        }

        ID_REGISTRY = registry;
        ID_REGISTRY_SIGNATURE = signature;
        ID_EXACT_FILENAME_INDEX = exactFilenameIndex;
        ID_FILENAME_INDEX = filenameIndex;
        ID_HASH_INDEX = hashIndex;
        ID_REGISTRY_READY = true;
        CATALOG_GENERATION += 1;

        if (REJECTION_REGISTRY) {
            REJECTION_REGISTRY_SIGNATURE = '';
            applyRejectionRegistry(REJECTION_REGISTRY);
        }

        prunePendingAgainstRegistry();
        return true;
    }

    async function refreshRemoteIdRegistry(force = false) {
        const cached = readTimedCache(ID_REGISTRY_CACHE_KEY, validateIdRegistry);

        if (!force && cacheIsFresh(cached)) {
            return;
        }

        try {
            const registry = await fetchRemoteJson(ID_REGISTRY_URL, 'ID registry');

            /*
             * IMPORTANT: acceptance compares the freshly downloaded file's
             * declared counters against counts independently calculated from
             * that same fresh body. The existing cache is never the comparator.
             */
            validateIdRegistry(registry);
            writeTimedCache(ID_REGISTRY_CACHE_KEY, registry);

            if (applyIdRegistry(registry)) {
                queueScan(document);
            }
        } catch (error) {
            console.warn(
                '[DALI] Remote ID registry rejected/unavailable; retaining last known-good copy.',
                error
            );
        }
    }

    function validateRejectionRegistry(registry) {
        if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
            throw new Error('Rejection registry root is not a JSON object.');
        }

        if (registry.schema !== 1) {
            throw new Error(`Unsupported rejection registry schema: ${registry.schema}.`);
        }

        if (!Number.isInteger(registry.revision) || registry.revision < 0) {
            throw new Error('Rejection registry revision must be a non-negative integer.');
        }

        if (!registry.sourceCounts || typeof registry.sourceCounts !== 'object') {
            throw new Error('Rejection registry is missing sourceCounts.');
        }

        if (!registry.rejections || typeof registry.rejections !== 'object' || Array.isArray(registry.rejections)) {
            throw new Error('Rejection registry is missing rejections.');
        }

        let rejectionCount = 0;
        const pairs = new Set();

        for (const [sourceKey, entries] of Object.entries(registry.rejections)) {
            const fnvMatch = sourceKey.match(/^fnv:([0-9a-f]{8})$/i);
            const filenameMatch = sourceKey.match(/^filename:(.+)$/i);

            if (!fnvMatch && !filenameMatch) {
                throw new Error(`Invalid rejection source authority: ${sourceKey}.`);
            }

            if (fnvMatch && sourceKey !== `fnv:${fnvMatch[1].toLowerCase()}`) {
                throw new Error(`Non-canonical rejection FNV key: ${sourceKey}.`);
            }

            if (filenameMatch) {
                const canonicalFilenameKey = normalizeIdentityKey(filenameMatch[1]);
                if (!canonicalFilenameKey || sourceKey !== `filename:${canonicalFilenameKey}`) {
                    throw new Error(`Non-canonical rejection filename key: ${sourceKey}.`);
                }
            }

            if (!Array.isArray(entries)) {
                throw new Error(`Rejection source ${sourceKey} must contain an array.`);
            }

            for (const entry of entries) {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                    throw new Error(`Malformed rejection entry under ${sourceKey}.`);
                }

                if (
                    typeof entry.catalog !== 'string' || !entry.catalog ||
                    typeof entry.identity !== 'string' || !entry.identity ||
                    !Array.isArray(entry.path) || entry.path.length < 2 ||
                    entry.path[0] !== entry.catalog ||
                    entry.path[entry.path.length - 1] !== entry.identity
                ) {
                    throw new Error(`Malformed rejection identity under ${sourceKey}.`);
                }

                const confidence = Number(entry.confidence);
                if (
                    !Number.isFinite(confidence) ||
                    confidence < REJECTION_CANON_CONFIDENCE_MIN ||
                    confidence > 1
                ) {
                    throw new Error(
                        `Canonical rejection confidence under ${sourceKey} must be ${REJECTION_CANON_CONFIDENCE_MIN}–1.`
                    );
                }

                const pairKey = `${sourceKey}\u0000${entry.path.join('/')}`;
                if (pairs.has(pairKey)) {
                    throw new Error(`Duplicate canonical rejection pair: ${pairKey}.`);
                }

                pairs.add(pairKey);
                rejectionCount += 1;
            }
        }

        if (Number(registry.sourceCounts.rejections) !== rejectionCount) {
            throw new Error(
                `Rejection registry self-count mismatch: declared ${registry.sourceCounts.rejections}, actual ${rejectionCount}.`
            );
        }

        return registry;
    }

    function canonicalPositiveExistsForSourceKey(sourceKey) {
        if (!ID_REGISTRY_READY || !ID_REGISTRY || typeof sourceKey !== 'string') {
            return false;
        }

        if (sourceKey.startsWith('fnv:')) {
            return ID_HASH_INDEX.has(sourceKey.slice(4).toLowerCase());
        }

        if (sourceKey.startsWith('filename:')) {
            return ID_FILENAME_INDEX.has(sourceKey.slice(9));
        }

        return false;
    }

    function applyRejectionRegistry(registry) {
        validateRejectionRegistry(registry);

        const signature = JSON.stringify(registry);
        if (signature === REJECTION_REGISTRY_SIGNATURE) {
            return false;
        }

        const nextIndex = new Set();
        let retired = 0;

        for (const [sourceKey, entries] of Object.entries(registry.rejections)) {
            /*
             * Positive canonical identity is stronger authority than negative
             * inference memory. Once a source is deterministically known, its
             * old rejection pairs can no longer be reached and are obsolete.
             */
            if (canonicalPositiveExistsForSourceKey(sourceKey)) {
                retired += entries.length;
                continue;
            }

            for (const entry of entries) {
                nextIndex.add(`${sourceKey}\u0000${entry.path.join('/')}`);
            }
        }

        REJECTION_REGISTRY = registry;
        REJECTION_REGISTRY_SIGNATURE = signature;
        REJECTION_INDEX = nextIndex;

        if (retired > 0) {
            console.info(
                `[DALI] ${retired} canonical rejection entr${retired === 1 ? 'y is' : 'ies are'} obsolete because positive canonical identity now exists.`
            );
        }

        prunePendingAgainstCanonicalRejections();
        return true;
    }

    async function refreshRemoteRejectionRegistry(force = false) {
        const cached = readTimedCache(
            REJECTION_REGISTRY_CACHE_KEY,
            validateRejectionRegistry
        );

        if (!force && cacheIsFresh(cached)) {
            return;
        }

        try {
            const registry = await fetchRemoteJson(
                REJECTION_REGISTRY_URL,
                'Rejection registry'
            );

            validateRejectionRegistry(registry);
            writeTimedCache(REJECTION_REGISTRY_CACHE_KEY, registry);

            applyRejectionRegistry(registry);
        } catch (error) {
            console.warn(
                '[DALI] Remote rejection registry rejected/unavailable; retaining last known-good copy.',
                error
            );
        }
    }

    function canonicalRejectionPairKey(descriptor, entry) {
        if (!descriptor || !entry?.path) return '';
        return `${descriptor.key}\u0000${entry.path.join('/')}`;
    }

    function isCanonicallyRejected(descriptor, entry) {
        if (!descriptor || !entry?.path) return false;

        /* Positive canon always retires negative authority for this source. */
        if (canonicalRegistryKeyForDescriptor(descriptor)) {
            return false;
        }

        return REJECTION_INDEX.has(canonicalRejectionPairKey(descriptor, entry));
    }

    function validateSvgCatalog(catalog) {
        if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
            throw new Error('SVG catalog root is not a JSON object.');
        }

        if (catalog.schema !== 1) {
            throw new Error(`Unsupported SVG catalog schema: ${catalog.schema}.`);
        }

        if (!catalog.sourceCounts || typeof catalog.sourceCounts !== 'object') {
            throw new Error('SVG catalog is missing sourceCounts.');
        }

        if (!catalog.svgs || typeof catalog.svgs !== 'object' || Array.isArray(catalog.svgs)) {
            throw new Error('SVG catalog is missing svgs.');
        }

        let count = 0;

        for (const [identity, svg] of Object.entries(catalog.svgs)) {
            if (
                !identity ||
                typeof svg !== 'string' ||
                !/^\s*<svg\b/i.test(svg) ||
                !/<\/svg>\s*$/i.test(svg)
            ) {
                throw new Error(`Malformed SVG catalog entry: ${identity}.`);
            }

            count += 1;
        }

        if (Number(catalog.sourceCounts.svg) !== count) {
            throw new Error(
                `SVG catalog self-count mismatch: declared ${catalog.sourceCounts.svg}, actual ${count}.`
            );
        }

        return catalog;
    }

    function applySvgCatalog(catalog) {
        validateSvgCatalog(catalog);

        const signature = JSON.stringify(catalog);
        if (signature === SVG_CATALOG_SIGNATURE) {
            return false;
        }

        SVG_CATALOG = catalog;
        SVG_CATALOG_SIGNATURE = signature;
        CATALOG_GENERATION += 1;
        return true;
    }

    async function refreshRemoteSvgCatalog(force = false) {
        const cached = readTimedCache(SVG_CATALOG_CACHE_KEY, validateSvgCatalog);

        if (!force && cacheIsFresh(cached)) {
            return;
        }

        try {
            const catalog = await fetchRemoteJson(SVG_CATALOG_URL, 'SVG catalog');
            validateSvgCatalog(catalog);
            writeTimedCache(SVG_CATALOG_CACHE_KEY, catalog);

            if (applySvgCatalog(catalog)) {
                queueScan(document);
            }
        } catch (error) {
            console.warn(
                '[DALI] Remote SVG catalog rejected/unavailable; retaining last known-good copy.',
                error
            );
        }
    }

    function getCatalogEntryByPath(path) {
        if (!REPLACEMENTS || !Array.isArray(path) || path.length < 2) {
            return null;
        }

        let node = REPLACEMENTS;

        for (const segment of path) {
            if (
                !node ||
                typeof node !== 'object' ||
                !Object.prototype.hasOwnProperty.call(node, segment)
            ) {
                return null;
            }

            node = node[segment];
        }

        if (node !== null && typeof node !== 'string') {
            return null;
        }

        return {
            name: path[path.length - 1],
            catalog: path[0],
            path: [...path],
            url: typeof node === 'string' && node.trim()
                ? node.trim()
                : null
        };
    }

    function describeNativeSource(src) {
        const value = String(src || '');
        if (!value) return null;

        if (/^data:image\/svg\+xml/i.test(value)) {
            return null;
        }

        if (value.startsWith('data:image/')) {
            const hash = dataSrcHash(value);
            if (!hash) return null;

            return {
                sourceType: 'data-image',
                key: `fnv:${hash}`,
                fnvHash: hash,
                filename: '',
                normalizedFilename: ''
            };
        }

        let filename = value
            .split(/[?#]/)[0]
            .split('/')
            .pop() || '';

        try {
            filename = decodeURIComponent(filename);
        } catch (error) {
            // Preserve undecoded filename.
        }

        const exactFilename = filename;
        const normalizedFilename = normalizeAssetName(filename);
        const key = normalizeIdentityKey(normalizedFilename);

        if (!exactFilename && !key) return null;

        return {
            sourceType: 'url',
            key: `filename:${key}`,
            fnvHash: '',
            filename,
            exactFilename,
            normalizedFilename
        };
    }

    function canonicalRegistryKeyForDescriptor(descriptor) {
        if (!descriptor || !ID_REGISTRY_READY || !ID_REGISTRY) {
            return null;
        }

        if (descriptor.sourceType === 'data-image') {
            return ID_HASH_INDEX.get(descriptor.fnvHash) || null;
        }

        return (
            ID_EXACT_FILENAME_INDEX.get(descriptor.exactFilename) ||
            ID_FILENAME_INDEX.get(normalizeIdentityKey(descriptor.normalizedFilename)) ||
            null
        );
    }

    function localRuntimeKeyForDescriptor(descriptor) {
        if (!descriptor) return '';

        return descriptor.sourceType === 'data-image'
            ? String(descriptor.fnvHash || '').toLowerCase()
            : normalizeIdentityKey(descriptor.normalizedFilename);
    }

    function lookupLocalIdentityForSource(src) {
        /*
         * Local authority waits until a valid canonical registry is loaded so
         * a first-run local mapping can never win merely because canonical
         * authority has not arrived yet.
         */
        if (!ID_REGISTRY_READY || !ID_REGISTRY) {
            return null;
        }

        const descriptor = describeNativeSource(src);
        if (!descriptor) return null;

        /* Canonical authority is immutable from the local extension channel. */
        if (canonicalRegistryKeyForDescriptor(descriptor)) {
            return null;
        }

        const key = localRuntimeKeyForDescriptor(descriptor);
        const local = descriptor.sourceType === 'data-image'
            ? LOCAL_HASH_INDEX.get(key)
            : LOCAL_FILENAME_INDEX.get(key);

        if (!local) return null;

        return { descriptor, local };
    }

    function validateLocalIdentityMapping(mapping) {
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
            throw new Error('Local identity mapping must be an object.');
        }

        const source = mapping.source;
        const proposedIdentity = mapping.proposedIdentity || mapping.identity;

        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            throw new Error('Local identity mapping is missing source.');
        }

        if (!proposedIdentity || typeof proposedIdentity !== 'object' || Array.isArray(proposedIdentity)) {
            throw new Error('Local identity mapping is missing proposedIdentity.');
        }

        const path = proposedIdentity.path;
        if (
            !Array.isArray(path) ||
            path.length < 2 ||
            path.some(segment => typeof segment !== 'string' || !segment.trim()) ||
            proposedIdentity.catalog !== path[0] ||
            proposedIdentity.identity !== path[path.length - 1]
        ) {
            throw new Error('Local identity mapping has an invalid catalog path.');
        }

        let descriptor;

        if (source.sourceType === 'data-image') {
            const hash = String(source.fnvHash || '').trim().toLowerCase();
            if (!/^[0-9a-f]{8}$/.test(hash)) {
                throw new Error('Local data-image mapping has an invalid FNV hash.');
            }

            descriptor = {
                sourceType: 'data-image',
                key: `fnv:${hash}`,
                fnvHash: hash,
                filename: '',
                normalizedFilename: ''
            };
        } else if (source.sourceType === 'url') {
            const normalizedFilename = normalizeAssetName(
                source.normalizedFilename || source.filename || ''
            );
            const normalizedKey = normalizeIdentityKey(normalizedFilename);

            if (!normalizedKey) {
                throw new Error('Local URL mapping has no usable filename authority.');
            }

            descriptor = {
                sourceType: 'url',
                key: `filename:${normalizedKey}`,
                fnvHash: '',
                filename: String(source.filename || ''),
                exactFilename: String(source.filename || '').trim(),
                normalizedFilename
            };
        } else {
            throw new Error(`Unsupported local sourceType: ${source.sourceType}.`);
        }

        return {
            descriptor,
            entry: {
                name: proposedIdentity.identity,
                catalog: proposedIdentity.catalog,
                path: [...path]
            }
        };
    }

    function registerLocalIdentities(payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('Local identity payload must be an object.');
        }

        if (payload.schema !== 1 || !Array.isArray(payload.mappings)) {
            throw new Error('Unsupported local identity payload.');
        }

        let added = 0;

        for (const mapping of payload.mappings) {
            const { descriptor, entry } = validateLocalIdentityMapping(mapping);

            /*
             * A local mapping may supplement unknown native signatures, but
             * it may never replace or shadow a canonical source authority.
             */
            if (canonicalRegistryKeyForDescriptor(descriptor)) {
                continue;
            }

            const key = localRuntimeKeyForDescriptor(descriptor);
            const index = descriptor.sourceType === 'data-image'
                ? LOCAL_HASH_INDEX
                : LOCAL_FILENAME_INDEX;
            const existing = index.get(key);

            if (existing) {
                const samePath = existing.path.join('\u0000') === entry.path.join('\u0000');
                if (!samePath) {
                    console.warn(
                        `[DALI] Ignoring conflicting local identity authority for ${descriptor.key}.`
                    );
                }
                continue;
            }

            index.set(key, entry);
            added += 1;
        }

        if (added > 0) {
            CATALOG_GENERATION += 1;
            prunePendingAgainstLocalIdentities();
            queueScan(document);

            if (document.getElementById('dali-pending-review')) {
                openPendingReview();
            }
        }

        return added;
    }

    function processLocalIdentityImage(image) {
        const nativeSrc = getImageExamination(image).src;
        const hit = lookupLocalIdentityForSource(nativeSrc);

        if (!hit?.local) {
            return false;
        }

        const entry = getCatalogEntryByPath(hit.local.path);
        if (!entry) {
            console.warn(
                `[DALI] Local identity points to an asset-map path that does not exist: ${hit.local.path.join('/')}`
            );
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry,
            { skipLearning: true, resolution: 'local-runtime' }
        );
    }

    function parseLocalIdentityEventDetail(detail) {
        if (typeof detail === 'string') {
            return JSON.parse(detail);
        }

        if (detail && typeof detail === 'object') {
            return detail;
        }

        throw new Error('Local identity event has no usable payload.');
    }

    function installLocalIdentityBridge() {
        document.addEventListener(LOCAL_IDENTITY_REGISTER_EVENT, event => {
            try {
                registerLocalIdentities(
                    parseLocalIdentityEventDetail(event.detail)
                );
            } catch (error) {
                console.warn('[DALI] Local identity extension payload rejected.', error);
            }
        });

        document.addEventListener(
            PENDING_SNAPSHOT_REQUEST_EVENT,
            () => dispatchPendingSnapshot()
        );

        queueMicrotask(() => {
            document.dispatchEvent(new CustomEvent(LOCAL_IDENTITY_READY_EVENT));
        });
    }

    function lookupRegistryEntryForSource(src) {
        if (!ID_REGISTRY_READY || !ID_REGISTRY) {
            return null;
        }

        const descriptor = describeNativeSource(src);
        if (!descriptor) return null;

        const registryKey = descriptor.sourceType === 'data-image'
            ? ID_HASH_INDEX.get(descriptor.fnvHash)
            : (
                ID_EXACT_FILENAME_INDEX.get(descriptor.exactFilename) ||
                ID_FILENAME_INDEX.get(normalizeIdentityKey(descriptor.normalizedFilename))
            );

        if (!registryKey) return null;

        return {
            registryKey,
            descriptor,
            registryEntry: ID_REGISTRY.identities[registryKey] || null
        };
    }

    function processDeterministicRegistryImage(image) {
        const src = image.getAttribute('src') || '';
        const hit = lookupRegistryEntryForSource(src);

        if (!hit?.registryEntry) {
            return false;
        }

        const entry = getCatalogEntryByPath(hit.registryEntry.path);
        if (!entry) {
            console.warn(
                `[DALI] ID registry points to an asset-map path that does not exist: ${hit.registryKey}`
            );
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry,
            { skipLearning: true, resolution: 'id-registry' }
        );
    }

    // ------------------------------------------------------------------------
    // DYNAMIC LEARNING / HUMAN REVIEW
    // ------------------------------------------------------------------------

    function newLearningState() {
        return {
            schema: 1,
            pending: {},
            rejections: {}
        };
    }

    function loadLearningState() {
        try {
            const raw = GM_getValue(LEARNING_STORAGE_KEY, '');
            const parsed = raw ? JSON.parse(raw) : null;

            if (
                parsed &&
                parsed.schema === 1 &&
                parsed.pending && typeof parsed.pending === 'object' &&
                parsed.rejections && typeof parsed.rejections === 'object'
            ) {
                return parsed;
            }
        } catch (error) {
            console.warn('[DALI] Local learning state could not be read.', error);
        }

        return newLearningState();
    }

    function saveLearningState() {
        try {
            GM_setValue(LEARNING_STORAGE_KEY, JSON.stringify(LEARNING_STATE));
        } catch (error) {
            console.warn('[DALI] Local learning state could not be saved.', error);
        }
    }

    function proposalKey(descriptor, entry) {
        return `${descriptor.key}\u0000${entry.path.join('/')}`;
    }

    function compactText(value, limit = 350) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, limit);
    }

    function addEvidenceValue(array, value, limit = 10) {
        const text = compactText(value);
        if (!text || array.includes(text) || array.length >= limit) return;
        array.push(text);
    }

    function getImageExamination(image) {
        let examination = IMAGE_EXAMINATIONS.get(image);

        if (examination) {
            return examination;
        }

        const anchor = image.closest('a[href]');
        const container = image.closest('td, center, li, div, a');

        examination = Object.freeze({
            src: image.getAttribute('src') || '',
            alt: image.getAttribute('alt') || '',
            title: image.getAttribute('title') || '',
            ariaLabel: image.getAttribute('aria-label') || '',
            pageHref: String(location.href || ''),
            anchorHref: anchor?.href || '',
            containerText: compactText(container?.textContent || ''),
            ratStructure: Boolean(image.closest('td.ratcell[id^="ratimg-"]')),
            miningToolStructure: Boolean(
                /^choose_tool_\d+$/.test(image.id || '') &&
                image.closest('td[id^="tool_"]')
            )
        });

        IMAGE_EXAMINATIONS.set(image, examination);
        return examination;
    }

    function anchorHrefIsDiscriminative(image, anchorHref) {
        if (!anchorHref) return false;

        let scope = image.parentElement;
        let hrefs = [];

        while (scope && scope !== document.documentElement) {
            hrefs = [];

            for (const peer of scope.querySelectorAll('img')) {
                const href = peer.closest('a[href]')?.href || '';
                if (href) hrefs.push(href);
            }

            if (hrefs.length >= 2) break;
            scope = scope.parentElement;
        }

        if (hrefs.length < 2) return false;

        /*
         * Shared destinations carry no identity information. Macro Check is
         * the canonical example: every candidate image points to one href, so
         * that href remains recorded evidence but contributes zero confidence.
         */
        const distinct = new Set(hrefs);
        if (distinct.size < 2) return false;

        const occurrences = hrefs.filter(href => href === anchorHref).length;
        return occurrences > 0 && occurrences < hrefs.length;
    }

    function collectLearningEvidence(image, entry, descriptor, examination) {
        const alt = examination.alt;
        const title = examination.title;
        const ariaLabel = examination.ariaLabel;
        const containerText = examination.containerText;
        const identityKey = normalizeIdentityKey(entry.name);
        const cues = [];

        if (
            descriptor.sourceType === 'url' &&
            normalizeIdentityKey(descriptor.normalizedFilename) === identityKey
        ) {
            cues.push('exact-native-filename');
        }

        for (const [label, value] of [
            ['exact-alt', alt],
            ['exact-title', title],
            ['exact-aria-label', ariaLabel]
        ]) {
            if (normalizeIdentityKey(value) === identityKey) {
                cues.push(label);
            }
        }

        const normalizedContainer = normalizeAssetName(containerText).toLowerCase();
        const normalizedIdentity = normalizeAssetName(entry.name).toLowerCase();

        if (
            normalizedContainer === normalizedIdentity ||
            normalizedContainer.startsWith(`${normalizedIdentity} `) ||
            normalizedContainer.startsWith(`${normalizedIdentity}(`)
        ) {
            cues.push('container-prefix');
        } else if (
            normalizedIdentity &&
            normalizedContainer.includes(normalizedIdentity)
        ) {
            cues.push('container-contains');
        }

        if (examination.ratStructure) {
            cues.push('rat-structure');
        }

        if (examination.miningToolStructure) {
            cues.push('mining-tool-structure');
        }

        if (entry.catalog === 'tattoos' && /-(1|2|3)(?:\.|$)/i.test(alt || examination.src || '')) {
            cues.push('tattoo-stage-structure');
        }

        if (anchorHrefIsDiscriminative(image, examination.anchorHref)) {
            cues.push('discriminative-anchor-href');
        }

        /*
         * Confidence is cumulative rather than a single-cue maximum. Exact
         * labels remain strong, while structural/container/href evidence adds
         * proportionately smaller support. Repetition is applied separately.
         */
        let confidence = 0.38;

        const weights = {
            'exact-native-filename': 0.50,
            'exact-alt': 0.42,
            'exact-title': 0.38,
            'exact-aria-label': 0.40,
            'rat-structure': 0.22,
            'mining-tool-structure': 0.22,
            'tattoo-stage-structure': 0.12,
            'container-prefix': 0.24,
            'container-contains': 0.16,
            'discriminative-anchor-href': 0.08
        };

        for (const cue of cues) {
            confidence += weights[cue] || 0;
        }

        confidence = Math.min(0.985, confidence);

        return {
            pageHref: examination.pageHref,
            anchorHref: examination.anchorHref,
            alt,
            title,
            ariaLabel,
            containerText,
            cues,
            baseConfidence: confidence
        };
    }

    function canonicalizeRasterUrl(value, baseHref = location.href) {
        const raw = String(value || '').trim();

        if (
            !raw ||
            raw.startsWith('data:') ||
            raw.startsWith('dali-svg://')
        ) {
            return '';
        }

        try {
            const url = new URL(raw, baseHref);

            /* Fragment identifiers do not change the fetched raster resource. */
            url.hash = '';

            return url.href;
        } catch {
            return '';
        }
    }

    function isCurrentRasterReplacementSource(nativeSrc, entry) {
        if (
            !entry?.url ||
            String(entry.url).startsWith('dali-svg://')
        ) {
            return false;
        }

        const sourceUrl = canonicalizeRasterUrl(nativeSrc);
        const replacementUrl = canonicalizeRasterUrl(entry.url);

        return Boolean(
            sourceUrl &&
            replacementUrl &&
            sourceUrl === replacementUrl
        );
    }

    function recordPendingAssociation(image, entry) {
        if (!ID_REGISTRY_READY || !entry?.path) {
            return;
        }

        const examination = getImageExamination(image);
        const nativeSrc = examination.src;

        /*
         * Learning has already normalized this object to one canonical asset
         * identity. Compare only that identity's raster pointer; do not build
         * or scan a global replacement index on the per-image hot path.
         */
        if (isCurrentRasterReplacementSource(nativeSrc, entry)) {
            return;
        }

        if (!nativeSrc || /^data:image\/svg\+xml/i.test(nativeSrc)) {
            return;
        }

        const descriptor = describeNativeSource(nativeSrc);
        if (!descriptor) return;

        /* Already deterministic in core or local runtime memory: no proposal is needed. */
        if (
            lookupRegistryEntryForSource(nativeSrc) ||
            lookupLocalIdentityForSource(nativeSrc)
        ) {
            return;
        }

        const key = proposalKey(descriptor, entry);

        /* Users may reject locally, but never approve locally. */
        if (LEARNING_STATE.rejections[key]) {
            return;
        }

        if (isCanonicallyRejected(descriptor, entry)) {
            return;
        }

        const evidence = collectLearningEvidence(image, entry, descriptor, examination);
        const now = Date.now();
        let proposal = LEARNING_STATE.pending[key];

        if (!proposal) {
            proposal = {
                schema: 1,
                source: {
                    sourceType: descriptor.sourceType,
                    fnvHash: descriptor.fnvHash,
                    filename: descriptor.filename,
                    exactFilename: descriptor.exactFilename || '',
                    normalizedFilename: descriptor.normalizedFilename,
                    src: nativeSrc
                },
                proposedIdentity: {
                    identity: entry.name,
                    catalog: entry.catalog,
                    path: [...entry.path]
                },
                confidence: evidence.baseConfidence,
                observations: 0,
                firstSeen: now,
                lastSeen: now,
                evidence: {
                    pageHrefs: [],
                    anchorHrefs: [],
                    alt: [],
                    title: [],
                    ariaLabel: [],
                    containerText: [],
                    cues: []
                }
            };

            LEARNING_STATE.pending[key] = proposal;
            console.info(
                `[DALI] New pending identity association: ${descriptor.key} -> ${entry.path.join('/')}`
            );
        }

        proposal.observations += 1;
        proposal.lastSeen = now;

        const repetitionBonus = Math.min(
            0.04,
            Math.max(0, Math.log2(Math.max(1, proposal.observations))) * 0.01
        );

        proposal.confidence = Number(
            Math.min(0.999, Math.max(proposal.confidence, evidence.baseConfidence) + repetitionBonus)
                .toFixed(3)
        );

        addEvidenceValue(proposal.evidence.pageHrefs, evidence.pageHref, 12);
        addEvidenceValue(proposal.evidence.anchorHrefs, evidence.anchorHref, 12);
        addEvidenceValue(proposal.evidence.alt, evidence.alt, 8);
        addEvidenceValue(proposal.evidence.title, evidence.title, 8);
        addEvidenceValue(proposal.evidence.ariaLabel, evidence.ariaLabel, 8);
        addEvidenceValue(proposal.evidence.containerText, evidence.containerText, 8);

        for (const cue of evidence.cues) {
            addEvidenceValue(proposal.evidence.cues, cue, 20);
        }

        saveLearningState();
    }

    function prunePendingAgainstReplacementPointers() {
        let changed = false;

        for (const [key, proposal] of Object.entries(LEARNING_STATE.pending)) {
            const src = proposal?.source?.src || '';
            const path = proposal?.proposedIdentity?.path;

            if (!src || !Array.isArray(path)) {
                continue;
            }

            const entry = getCatalogEntryByPath(path);

            if (entry && isCurrentRasterReplacementSource(src, entry)) {
                delete LEARNING_STATE.pending[key];
                changed = true;
            }
        }

        if (changed) saveLearningState();
    }

    function prunePendingAgainstRegistry() {
        let changed = false;

        for (const [key, proposal] of Object.entries(LEARNING_STATE.pending)) {
            const src = proposal?.source?.src || '';
            if (src && lookupRegistryEntryForSource(src)) {
                delete LEARNING_STATE.pending[key];
                changed = true;
            }
        }

        if (changed) saveLearningState();
    }

    function prunePendingAgainstCanonicalRejections() {
        let changed = false;

        for (const [key, proposal] of Object.entries(LEARNING_STATE.pending)) {
            const descriptor = describeNativeSource(proposal?.source?.src || '');
            const path = proposal?.proposedIdentity?.path;

            if (!descriptor || !Array.isArray(path)) continue;

            if (REJECTION_INDEX.has(`${descriptor.key}\u0000${path.join('/')}`)) {
                delete LEARNING_STATE.pending[key];
                changed = true;
            }
        }

        if (changed) saveLearningState();
    }

    function prunePendingAgainstLocalIdentities() {
        let changed = false;

        for (const [key, proposal] of Object.entries(LEARNING_STATE.pending)) {
            const src = proposal?.source?.src || '';
            if (src && lookupLocalIdentityForSource(src)) {
                delete LEARNING_STATE.pending[key];
                changed = true;
            }
        }

        if (changed) saveLearningState();
    }

    function rejectPendingAssociation(key) {
        const proposal = LEARNING_STATE.pending[key];
        if (!proposal) return;

        LEARNING_STATE.rejections[key] = {
            rejectedAt: Date.now(),
            source: proposal.source,
            proposedIdentity: proposal.proposedIdentity,
            confidence: Number(proposal.confidence) || 0,
            canonicalEligible: Number(proposal.confidence) >= REJECTION_CANON_CONFIDENCE_MIN,
            observations: Number(proposal.observations) || 0,
            evidence: proposal.evidence
        };

        delete LEARNING_STATE.pending[key];
        saveLearningState();
    }

    function restoreRejectedAssociation(key) {
        const rejection = LEARNING_STATE.rejections[key];
        if (!rejection?.source || !rejection?.proposedIdentity) {
            return false;
        }

        const rejectedAt = Number(rejection.rejectedAt) || Date.now();

        LEARNING_STATE.pending[key] = {
            schema: 1,
            source: rejection.source,
            proposedIdentity: rejection.proposedIdentity,
            confidence: Number(rejection.confidence) || 0,
            observations: Number(rejection.observations) || 0,
            firstSeen: rejectedAt,
            lastSeen: Date.now(),
            evidence: rejection.evidence || {
                pageHrefs: [],
                anchorHrefs: [],
                alt: [],
                title: [],
                ariaLabel: [],
                containerText: [],
                cues: []
            }
        };

        delete LEARNING_STATE.rejections[key];
        saveLearningState();
        CATALOG_GENERATION += 1;
        queueScan(document);
        dispatchPendingSnapshot();
        return true;
    }

    function latestRejectedAssociationKey() {
        let latestKey = '';
        let latestTime = -1;

        for (const [key, rejection] of Object.entries(LEARNING_STATE.rejections)) {
            const rejectedAt = Number(rejection?.rejectedAt) || 0;
            if (rejectedAt > latestTime) {
                latestTime = rejectedAt;
                latestKey = key;
            }
        }

        return latestKey;
    }

    function undoLastRejection() {
        const key = latestRejectedAssociationKey();
        if (!key) return false;
        return restoreRejectedAssociation(key);
    }

    function pendingToken(key) {
        return encodeURIComponent(String(key || ''));
    }

    function pendingSnapshotObject() {
        return {
            schema: 1,
            type: 'dali-pending-snapshot',
            generatedAt: Date.now(),
            associations: Object.entries(LEARNING_STATE.pending).map(([key, proposal]) => ({
                token: pendingToken(key),
                proposal
            }))
        };
    }

    function dispatchPendingSnapshot() {
        document.dispatchEvent(
            new CustomEvent(PENDING_SNAPSHOT_EVENT, {
                detail: JSON.stringify(pendingSnapshotObject())
            })
        );
    }

    function pendingExportObject(keys = null) {
        const selected = keys
            ? keys.map(key => LEARNING_STATE.pending[key]).filter(Boolean)
            : Object.values(LEARNING_STATE.pending);

        return {
            schema: 1,
            type: 'dali-pending-associations',
            exportedAt: Date.now(),
            count: selected.length,
            associations: selected
        };
    }

    function downloadJson(filename, value) {
        const blob = new Blob(
            [JSON.stringify(value, null, 2) + '\n'],
            { type: 'application/json;charset=utf-8' }
        );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        (document.body || document.documentElement).appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    const PENDING_EXPORT_LOCK_KEY = 'hw-dali-pending-export-lock-v1';
    const PENDING_EXPORT_LOCK_MS = 1500;

    function acquirePendingExportLock() {
        const now = Date.now();

        try {
            const previous = Number.parseInt(
                localStorage.getItem(PENDING_EXPORT_LOCK_KEY) || '0',
                10
            );

            if (Number.isFinite(previous) && now - previous < PENDING_EXPORT_LOCK_MS) {
                return false;
            }

            localStorage.setItem(PENDING_EXPORT_LOCK_KEY, String(now));
            return true;
        } catch {
            /*
             * localStorage can be unavailable in unusually restricted page
             * contexts. Fall back to this userscript instance's timestamp.
             */
            if (
                exportPendingAssociations.lastExportAt &&
                now - exportPendingAssociations.lastExportAt < PENDING_EXPORT_LOCK_MS
            ) {
                return false;
            }

            exportPendingAssociations.lastExportAt = now;
            return true;
        }
    }

    function exportPendingAssociations(keys = null) {
        /*
         * One physical click must produce exactly one download. The shared
         * localStorage lock also suppresses duplicate invocations if more than
         * one DALI userscript context happens to be alive on the same page.
         */
        if (!acquirePendingExportLock()) {
            return;
        }

        const payload = pendingExportObject(keys);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        downloadJson(`dali-pending-associations-${stamp}.json`, payload);
    }

    function resolvePendingNativePreviewSource(proposal) {
        const src = String(proposal?.source?.src || '').trim();

        if (!src) {
            return null;
        }

        if (src.startsWith('data:image/')) {
            return src;
        }

        const base = proposal?.evidence?.pageHrefs?.[0] || location.href;

        try {
            return new URL(src, base).href;
        } catch {
            return src;
        }
    }

    function resolvePendingReplacementPreviewSource(proposal) {
        const entry = getCatalogEntryByPath(
            proposal?.proposedIdentity?.path
        );

        if (!entry?.url) {
            return null;
        }

        return resolveReplacementPointer(entry.url);
    }

    function makePendingPreviewBox(label, src, emptyText) {
        const box = document.createElement('div');
        Object.assign(box.style, {
            flex: '1 1 280px',
            minWidth: '0',
            border: '1px solid #999',
            borderRadius: '6px',
            background: '#fff',
            padding: '8px'
        });

        const heading = document.createElement('strong');
        heading.textContent = label;
        heading.style.display = 'block';
        heading.style.marginBottom = '6px';
        box.appendChild(heading);

        if (!src) {
            const empty = document.createElement('div');
            empty.textContent = emptyText;
            Object.assign(empty.style, {
                minHeight: '120px',
                display: 'grid',
                placeItems: 'center',
                color: '#666',
                background: '#eee'
            });
            box.appendChild(empty);
            return box;
        }

        const image = document.createElement('img');
        image.dataset.daliReviewPreview = '1';
        image.alt = label;
        image.src = src;
        Object.assign(image.style, {
            display: 'block',
            width: '100%',
            height: '160px',
            objectFit: 'contain',
            background: '#eee',
            imageRendering: 'auto'
        });
        box.appendChild(image);
        return box;
    }

    async function copyPendingSource(proposal) {
        const src = String(proposal?.source?.src || '');

        if (!src) {
            return;
        }

        try {
            await navigator.clipboard.writeText(src);
        } catch {
            const area = document.createElement('textarea');
            area.value = src;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            (document.body || document.documentElement).appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
        }
    }

    function closePendingReview() {
        const overlay = document.getElementById('dali-pending-review');
        if (!overlay) return;

        const keyHandler = overlay.__daliDocumentKeyHandler;
        if (keyHandler) {
            document.removeEventListener('keydown', keyHandler, true);
        }

        overlay.remove();
        document.dispatchEvent(new CustomEvent(REVIEW_CLOSED_EVENT));
    }

    function openPendingReview() {
        closePendingReview();

        const overlay = document.createElement('div');
        overlay.id = 'dali-pending-review';
        overlay.dataset.daliReview = 'pending-associations';
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            background: 'rgba(0,0,0,.72)',
            padding: '24px',
            overflow: 'auto',
            font: '14px/1.4 Arial, sans-serif'
        });

        const panel = document.createElement('div');
        panel.id = 'dali-pending-review-panel';
        Object.assign(panel.style, {
            maxWidth: '1100px',
            margin: '0 auto',
            background: '#f4f4f4',
            color: '#111',
            border: '2px solid #333',
            borderRadius: '8px',
            padding: '16px'
        });

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.gap = '12px';
        header.style.alignItems = 'center';

        const title = document.createElement('strong');
        title.textContent = `DALI Pending Associations (${Object.keys(LEARNING_STATE.pending).length})`;

        const controls = document.createElement('div');

        const undoRejectButton = document.createElement('button');
        undoRejectButton.type = 'button';
        undoRejectButton.textContent = 'Undo Last Reject';
        undoRejectButton.dataset.daliAction = 'undo-reject';
        undoRejectButton.disabled = !latestRejectedAssociationKey();
        undoRejectButton.title = 'Keyboard: Ctrl+Z / Cmd+Z';
        undoRejectButton.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            if (undoLastRejection()) {
                openPendingReview();
            }
        };

        const exportButton = document.createElement('button');
        exportButton.type = 'button';
        exportButton.textContent = 'Export All Pending';
        exportButton.dataset.daliAction = 'export-all';
        exportButton.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            exportPendingAssociations();
        };

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = 'Close';
        closeButton.dataset.daliAction = 'close';
        closeButton.style.marginLeft = '8px';
        closeButton.onclick = closePendingReview;

        controls.append(undoRejectButton, exportButton, closeButton);
        exportButton.style.marginLeft = '8px';
        header.append(title, controls);
        panel.appendChild(header);

        const note = document.createElement('p');
        note.textContent = 'Compare the native source image on the left with DALI\'s proposed replacement on the right. FNV is retained as the deterministic fingerprint, but you do not need to validate an association by reading the hash. Pending associations may be exported or rejected here; authoritative promotion occurs only in the core ID registry.';
        panel.appendChild(note);

        const entries = Object.entries(LEARNING_STATE.pending)
            .sort((a, b) => (b[1]?.confidence || 0) - (a[1]?.confidence || 0));

        if (!entries.length) {
            const empty = document.createElement('p');
            empty.textContent = 'No pending associations.';
            panel.appendChild(empty);
        }

        for (const [key, proposal] of entries) {
            const card = document.createElement('div');
            card.dataset.daliPendingToken = pendingToken(key);
            card.dataset.daliPendingIdentity = proposal.proposedIdentity.path.join('/');
            Object.assign(card.style, {
                borderTop: '1px solid #aaa',
                marginTop: '16px',
                paddingTop: '16px'
            });

            const heading = document.createElement('div');
            heading.innerHTML = `<strong>${escapeHtml(proposal.proposedIdentity.path.join('/'))}</strong> — confidence ${(proposal.confidence * 100).toFixed(1)}% — ${proposal.observations} observation(s)`;
            card.appendChild(heading);

            const comparison = document.createElement('div');
            Object.assign(comparison.style, {
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                margin: '10px 0'
            });

            comparison.append(
                makePendingPreviewBox(
                    'Native source',
                    resolvePendingNativePreviewSource(proposal),
                    'Native source unavailable'
                ),
                makePendingPreviewBox(
                    'Proposed DALI replacement',
                    resolvePendingReplacementPreviewSource(proposal),
                    'No replacement currently mapped'
                )
            );
            card.appendChild(comparison);

            const sourceSummary = document.createElement('code');
            sourceSummary.style.display = 'block';
            sourceSummary.style.whiteSpace = 'pre-wrap';
            sourceSummary.style.wordBreak = 'break-all';
            sourceSummary.style.margin = '6px 0';

            const summaryParts = [];
            if (proposal.source.fnvHash) {
                summaryParts.push(`FNV: ${proposal.source.fnvHash}`);
            }
            if (proposal.source.filename) {
                summaryParts.push(`Filename: ${proposal.source.filename}`);
            }
            sourceSummary.textContent = summaryParts.join(' | ') || 'No compact source fingerprint recorded';
            card.appendChild(sourceSummary);

            const srcDetails = document.createElement('details');
            srcDetails.style.margin = '6px 0';

            const srcSummary = document.createElement('summary');
            srcSummary.textContent = 'Show exact native src';
            srcSummary.style.cursor = 'pointer';

            const srcText = document.createElement('code');
            srcText.style.display = 'block';
            srcText.style.whiteSpace = 'pre-wrap';
            srcText.style.wordBreak = 'break-all';
            srcText.style.maxHeight = '180px';
            srcText.style.overflow = 'auto';
            srcText.style.marginTop = '6px';
            srcText.textContent = proposal.source.src || '';

            srcDetails.append(srcSummary, srcText);
            card.appendChild(srcDetails);

            const cues = document.createElement('div');
            cues.textContent = `Cues: ${proposal.evidence.cues.join(', ') || 'none recorded'}`;
            card.appendChild(cues);

            const page = document.createElement('div');
            page.textContent = `Seen: ${proposal.evidence.pageHrefs[0] || 'unknown page'}`;
            page.style.wordBreak = 'break-all';
            card.appendChild(page);

            const anchorTarget = proposal.evidence.anchorHrefs?.[0] || '';
            if (anchorTarget) {
                const linkTarget = document.createElement('div');
                linkTarget.textContent = `Link target: ${anchorTarget}`;
                linkTarget.style.wordBreak = 'break-all';
                card.appendChild(linkTarget);
            }

            const buttons = document.createElement('div');
            buttons.dataset.daliReviewActions = '1';
            buttons.style.marginTop = '8px';

            const copySource = document.createElement('button');
            copySource.type = 'button';
            copySource.textContent = 'Copy Native src';
            copySource.dataset.daliAction = 'copy-source';
            copySource.onclick = () => copyPendingSource(proposal);

            const exportOne = document.createElement('button');
            exportOne.type = 'button';
            exportOne.textContent = 'Export';
            exportOne.dataset.daliAction = 'export-one';
            exportOne.style.marginLeft = '8px';
            exportOne.onclick = event => {
                event.preventDefault();
                event.stopPropagation();
                exportPendingAssociations([key]);
            };

            const reject = document.createElement('button');
            reject.type = 'button';
            reject.textContent = 'Reject';
            reject.dataset.daliAction = 'reject';
            reject.dataset.daliPendingToken = pendingToken(key);
            reject.style.marginLeft = '8px';
            reject.onclick = () => {
                if (!confirm(`Reject pending association for ${proposal.proposedIdentity.path.join('/')}?`)) return;
                rejectPendingAssociation(key);
                openPendingReview();
            };

            buttons.append(copySource, exportOne, reject);
            card.appendChild(buttons);
            panel.appendChild(card);
        }

        overlay.appendChild(panel);
        (document.body || document.documentElement).appendChild(overlay);

        const onDocumentKeyDown = event => {
            if (!document.getElementById('dali-pending-review')) return;

            if (
                event.key.toLowerCase() === 'z' &&
                (event.ctrlKey || event.metaKey) &&
                !event.altKey
            ) {
                if (undoLastRejection()) {
                    event.preventDefault();
                    event.stopPropagation();
                    openPendingReview();
                }
                return;
            }

            if (event.key !== 'Escape') return;

            event.preventDefault();
            event.stopPropagation();
            closePendingReview();
        };

        overlay.__daliDocumentKeyHandler = onDocumentKeyDown;
        document.addEventListener('keydown', onDocumentKeyDown, true);

        dispatchPendingSnapshot();
        document.dispatchEvent(new CustomEvent(REVIEW_OPENED_EVENT));

        requestAnimationFrame(() => {
            if (!panel.contains(document.activeElement)) {
                panel.querySelector('[data-dali-action="reject"]')?.focus();
            }
        });
    }

    function closeRejectedReview() {
        document.getElementById('dali-rejected-review')?.remove();
    }

    function openRejectedReview() {
        closeRejectedReview();

        const overlay = document.createElement('div');
        overlay.id = 'dali-rejected-review';
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            background: 'rgba(0,0,0,.72)',
            padding: '24px',
            overflow: 'auto',
            font: '14px/1.4 Arial, sans-serif'
        });

        const panel = document.createElement('div');
        Object.assign(panel.style, {
            maxWidth: '900px',
            margin: '0 auto',
            background: '#f4f4f4',
            color: '#111',
            border: '2px solid #333',
            borderRadius: '8px',
            padding: '16px'
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            alignItems: 'center'
        });

        const title = document.createElement('strong');
        const entries = Object.entries(LEARNING_STATE.rejections)
            .sort((a, b) => (Number(b[1]?.rejectedAt) || 0) - (Number(a[1]?.rejectedAt) || 0));
        title.textContent = `DALI Rejected Associations (${entries.length})`;

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = 'Close';
        closeButton.onclick = closeRejectedReview;

        header.append(title, closeButton);
        panel.appendChild(header);

        const note = document.createElement('p');
        note.textContent = 'Restore removes the local rejection and returns that association to the pending review queue.';
        panel.appendChild(note);

        if (!entries.length) {
            const empty = document.createElement('p');
            empty.textContent = 'No locally rejected associations.';
            panel.appendChild(empty);
        }

        for (const [key, rejection] of entries) {
            const card = document.createElement('div');
            Object.assign(card.style, {
                borderTop: '1px solid #aaa',
                marginTop: '12px',
                paddingTop: '12px'
            });

            const identity = rejection?.proposedIdentity?.path?.join('/') || 'Unknown identity';
            const heading = document.createElement('div');
            heading.innerHTML = `<strong>${escapeHtml(identity)}</strong>`;
            card.appendChild(heading);

            const sourceSummary = document.createElement('code');
            const parts = [];
            if (rejection?.source?.fnvHash) parts.push(`FNV: ${rejection.source.fnvHash}`);
            if (rejection?.source?.filename) parts.push(`Filename: ${rejection.source.filename}`);
            sourceSummary.textContent = parts.join(' | ') || 'No compact source fingerprint recorded';
            sourceSummary.style.display = 'block';
            sourceSummary.style.margin = '6px 0';
            card.appendChild(sourceSummary);

            const restore = document.createElement('button');
            restore.type = 'button';
            restore.textContent = 'Restore to Pending';
            restore.onclick = () => {
                if (!restoreRejectedAssociation(key)) return;
                openRejectedReview();
            };
            card.appendChild(restore);
            panel.appendChild(card);
        }

        overlay.appendChild(panel);
        (document.body || document.documentElement).appendChild(overlay);

        overlay.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeRejectedReview();
        }, true);

        requestAnimationFrame(() => {
            panel.querySelector('button:not(:disabled)')?.focus();
        });
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function installLearningMenuCommands() {
        GM_registerMenuCommand(
            'Review Proposals',
            openPendingReview
        );

        GM_registerMenuCommand(
            'Export Proposals',
            () => exportPendingAssociations()
        );

        GM_registerMenuCommand(
            'Review Rejected Proposals',
            openRejectedReview
        );
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

    function findCatalogEntryByIdentity(catalogName, rawValue) {
        const lookup = lookupCatalogIdentity(rawValue);

        if (lookup.status === 'resolved') {
            return lookup.entry.catalog === catalogName
                ? lookup.entry
                : null;
        }

        if (lookup.status !== 'ambiguous') {
            return null;
        }

        const matches = lookup.entries.filter(
            entry => entry.catalog === catalogName
        );

        return matches.length === 1
            ? matches[0]
            : null;
    }

    function findCatalogEntryByContainerText(catalogName, rawValue) {
        const catalog = REPLACEMENTS?.[catalogName];

        if (!catalog) {
            return null;
        }

        const normalizedContainer = normalizeAssetName(rawValue);

        if (!normalizedContainer) {
            return null;
        }

        let match = null;

        walkCatalogLeaves(
            catalogName,
            catalog,
            [],
            (name, url, path) => {
                if (match) {
                    return;
                }

                const normalizedName = normalizeAssetName(name);

                if (
                    normalizedContainer === normalizedName ||
                    normalizedContainer.startsWith(
                        `${normalizedName} `
                    ) ||
                    normalizedContainer.startsWith(
                        `${normalizedName}(`
                    )
                ) {
                    match = {
                        name,
                        catalog: catalogName,
                        path: [catalogName, ...path, name],
                        url: typeof url === 'string' && url.trim()
                            ? url.trim()
                            : null
                    };
                }
            }
        );

        return match;
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


    function isCanvasMapImage(image) {
        return Boolean(image && String(image.id || '') === 'canvasImg');
    }

    function isDaliControlSurfaceImage(image) {
        return Boolean(
            image?.closest?.('#dali-pending-review, #dali-rejection-review')
        );
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
        const suppressSemanticIdentity = isCanvasMapImage(image);
        const rawCandidates = [
            ...(suppressSemanticIdentity
                ? []
                : [
                    image.getAttribute('alt'),
                    image.getAttribute('title'),
                    image.getAttribute('aria-label')
                ]),
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

        const currencyCandidates = suppressSemanticIdentity
            ? []
            : [
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

    function applyResolvedCatalogEntry(image, entry, options = null) {
        if (!entry) {
            return false;
        }

        if (!options?.skipLearning) {
            recordPendingAssociation(image, entry);
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
    
        const replaced = replaceImage(
            image,
            entry.name,
            replacementUrl,
            catalogCategoryLabel(entry.catalog),
            entry.path
        );
    
        if (!replaced) {
            return false;
        }
    
        if (fade !== null) {
            image.style.opacity = String(TATTOO_OPACITY[fade]);
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
// RUNTIME EXCLUSIONS
// ------------------------------------------------------------------------

    function isRtBarRuntimeExclusionActive() {
        const cmd = new URLSearchParams(window.location.search).get('cmd');

        return (
            cmd === 'mail' ||
            cmd === 'gathering' ||
            cmd === 'network'
        );
    }

    function isDaliRuntimeExcludedNode(node) {
        if (!isRtBarRuntimeExclusionActive() || !node) {
            return false;
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            return (
                node.id === 'RTBar' ||
                Boolean(node.closest?.('#RTBar'))
            );
        }

        return Boolean(
            node.parentElement?.closest?.('#RTBar')
        );
    }

    function isDaliRuntimeExcludedImage(image) {
        return Boolean(
            image &&
            isRtBarRuntimeExclusionActive() &&
            image.closest?.('#RTBar')
        );
    }


// ------------------------------------------------------------------------
// MANUAL ASSET-MAP REFRESH CONTROL
// ------------------------------------------------------------------------

    function installAssetRefreshControl() {
        const menu = document.querySelector(
            'div.topbar-menu > ul'
        );

        if (!menu) {
            return false;
        }

        if (menu.querySelector(
            'li[data-dali-refresh-assets="1"]'
        )) {
            return true;
        }

        const item = document.createElement('li');
        item.dataset.daliRefreshAssets = '1';

        const link = document.createElement('a');
        link.href = '#';
        link.textContent = '↻ Imagery';

        link.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();

            if (link.dataset.daliRefreshing === '1') {
                return;
            }

            link.dataset.daliRefreshing = '1';

            const originalText = link.textContent;
            const stateStartedAt = Date.now();
            const minimumStateMs = 600;

            link.textContent = '↻ Working';

            const holdCurrentState = async () => {
                const remaining = minimumStateMs - (Date.now() - stateStartedAt);

                if (remaining > 0) {
                    await new Promise(resolve => setTimeout(resolve, remaining));
                }
            };

            try {
                await Promise.all([
                    refreshRemoteAssetMap(true),
                    refreshRemoteSvgCatalog(true)
                ]);

                await holdCurrentState();

                link.textContent = '✓ Success';

                setTimeout(() => {
                    link.textContent = originalText;
                }, 1500);
            } catch (error) {
                console.error(
                    'Manual asset refresh failed.',
                    error
                );

                await holdCurrentState();

                link.textContent = '✕ Failure';

                setTimeout(() => {
                    link.textContent = originalText;
                }, 2000);
            } finally {
                delete link.dataset.daliRefreshing;
            }
        });

        item.appendChild(link);
        menu.appendChild(item);

        return true;
    }

// ------------------------------------------------------------------------
// INITIALIZATION / DYNAMIC CONTENT
// ------------------------------------------------------------------------

    function queueScan(root = document) {
        if (!root) return;

        /*
         * Mail and Gathering continuously populate #RTBar with native emoji.
         * Reject those roots before they enter DALI's scan queue.
         */
        if (
            root !== document &&
            isDaliRuntimeExcludedNode(root)
        ) {
            return;
        }

        if (root === document) {
            FULL_SCAN_QUEUED = true;
            SCAN_ROOTS.clear();
        } else if (!FULL_SCAN_QUEUED) {
            SCAN_ROOTS.add(root);
        }

        if (SCAN_FRAME) return;

        SCAN_FRAME = requestAnimationFrame(() => {
            SCAN_FRAME = 0;

            if (FULL_SCAN_QUEUED) {
                FULL_SCAN_QUEUED = false;
                SCAN_ROOTS.clear();
                scan(document);
                return;
            }

            const roots = [...SCAN_ROOTS].filter(root => root?.isConnected !== false);
            SCAN_ROOTS.clear();

            const outerRoots = roots.filter(
                root => !roots.some(other => other !== root && other?.contains?.(root))
            );

            for (const root of outerRoots) {
                if (root.matches?.('img')) {
                    processImage(root);
                }
                scan(root);
            }
        });
    }

    function initializeDali() {
        if (DALI_OBSERVER) {
            return;
        }
    
        DALI_OBSERVER = new MutationObserver(mutations => {
            installAssetRefreshControl();

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) {
                        continue;
                    }

                    if (isDaliRuntimeExcludedNode(node)) {
                        continue;
                    }

    
                    queueScan(node);
                }
            }
        });
    
        DALI_OBSERVER.observe(document, {
            childList: true,
            subtree: true
        });

        installAssetRefreshControl();

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
                () => queueScan(document),
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

        if (
            root !== document &&
            isDaliRuntimeExcludedNode(root)
        ) {
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
            const replacementPointer = REPLACEMENTS[catalogName]?.[identity];

            if (!replacementPointer) {
                continue;
            }

            const replacementUrl = resolveReplacementPointer(
                replacementPointer
            );

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
                const appliedGeneration = Number.parseInt(
                    icon.dataset.daliMenuGeneration || '-1',
                    10
                );

                if (
                    icon.dataset.daliMenuAsset === identity &&
                    appliedGeneration === CATALOG_GENERATION
                ) {
                    continue;
                }

                icon.dataset.daliMenuAsset = identity;
                icon.dataset.daliMenuGeneration = String(CATALOG_GENERATION);

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

        if (
            isDaliControlSurfaceImage(image) ||
            isDaliRuntimeExcludedImage(image) ||
            isCanvasMapImage(image)
        ) {
            return;
        }

        const src = image.getAttribute('src') || '';

        /*
         * Message-board icons are HoboWars emoji. Many are animated, and
         * filename identities such as money.gif can collide with DALI's
         * ordinary catalogs. Preserve the entire emoji namespace untouched.
         */
        if (/\/mb_icons\//i.test(src)) {
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

        /*
         * Capture native evidence once, before any resolver can adapt this node.
         * Later catalog-generation rescans and layout retries reuse this exact
         * snapshot instead of examining DALI's own replacement.
         */
        getImageExamination(image);

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
         * Primary deterministic authority. Native filename/FNV identity is
         * resolved before any contextual or semantic inference is attempted.
         */
        if (processDeterministicRegistryImage(image)) {
            return;
        }

        /*
         * Optional user-supplied local deterministic authority is evaluated
         * only after the canonical registry. It is session-local, cannot
         * shadow canonical source authority, and never mutates core cache.
         */
        if (processLocalIdentityImage(image)) {
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
         * Rat pairings encode two identities in the host image title:
         *
         *     Host Rat / Sub Rat
         *
         * The host portrait must use the first identity while the smaller
         * sub-rat portrait uses the second. A lone rat title contains only
         * the host identity. Resolve this semantic relationship before the
         * generic catalog normalizer sees the slash-delimited title.
         */
        if (processRatUpgrade(image)) {
            return;
        }

        if (processRat(image)) {
            return;
        }

        /*
         * The native Mines Blast tool picker can serve its tool imagery as
         * base64 data URIs, removing the filename identity used by ordinary
         * catalog resolution. In that narrowly scoped UI, explosive tools
         * expose their own marker name while pickaxe-class tools use the
         * generic marker name "x". Resolve the safe explicit names here and
         * use known native-payload fingerprints only for the pickaxe variants.
         */
        if (processMiningBlastTool(image)) {
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
// ASSET-MAP SVG POINTERS / REMOTE SVG CATALOG
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

    if (!SVG_CATALOG) {
        return null;
    }

    const svg = SVG_CATALOG.svgs?.[identity];

    if (!svg) {
        console.warn(
            `[DALI] SVG pointer is not currently available in the SVG catalog: ${value}`
        );
        return null;
    }

    return svgDataUrl(svg);
}

// ------------------------------------------------------------------------
// INLINE NAVIGATION SVG ARTWORK
// ------------------------------------------------------------------------

const NAV_ARROW_HASHES = new Map([
    /* Authoritatively mapped cardinal base64 payloads. */
    ['30bc4f42', 'N'],
    ['3eb8d06b', 'E'],
    ['acda841b', 'S'],
    ['e1200fbc', 'W'],

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
    const strokeWidth = Math.max(2, Math.min(w, h) * 0.095);
    const inset = Math.max(1.5, strokeWidth * 0.75);

    let points;

    switch (direction) {
        case 'N':
            points = [
                [w / 2, inset],
                [w - inset, h - inset],
                [inset, h - inset]
            ];
            break;

        case 'E':
            points = [
                [w - inset, h / 2],
                [inset, inset],
                [inset, h - inset]
            ];
            break;

        case 'S':
            points = [
                [w / 2, h - inset],
                [inset, inset],
                [w - inset, inset]
            ];
            break;

        case 'W':
            points = [
                [inset, h / 2],
                [w - inset, h - inset],
                [w - inset, inset]
            ];
            break;

        default: {
            const cx = w / 2;
            const cy = h / 2;
            const radius = Math.max(
                1,
                (Math.min(w, h) / 2) - inset
            );
            const rotation = NAV_ARROW_ROTATIONS[direction] || 0;
            const angle = rotation * Math.PI / 180;
            const spread = 2 * Math.PI / 3;

            points = [
                angle - Math.PI / 2,
                angle - Math.PI / 2 + spread,
                angle - Math.PI / 2 - spread
            ].map(theta => [
                cx + Math.cos(theta) * radius,
                cy + Math.sin(theta) * radius
            ]);
            break;
        }
    }

    const pointString = points
        .map(([x, y]) => `${x},${y}`)
        .join(' ');

    return `
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 ${w} ${h}"
            width="${w}"
            height="${h}"
        >
            <polygon
                points="${pointString}"
                fill="#d00"
                stroke="#000"
                stroke-width="${strokeWidth}"
                stroke-linejoin="round"
            />
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
                    ) ||
                    normalizedContainer.startsWith(
                        `${normalizedName}(`
                    )
                ) {
                    return name;
                }
            }
        }

        return null;
    }

// ------------------------------------------------------------------------
// RATS
// ------------------------------------------------------------------------

    const RAT_UPGRADE_TITLES = new Map([
        ["Rat's specials will fire more often in battle", 'Buddhism'],
        ['Rat is better at finding, fetching and stealing stuff', 'Materialism'],
        ["Rat won't eat meat, but gains increase from other food", 'Vegetarianism']
    ]);

    function processRatUpgrade(image) {
        const title = String(
            image.getAttribute('title') || ''
        ).trim();

        const identity = RAT_UPGRADE_TITLES.get(title);

        if (!identity) {
            return false;
        }

        const entry = findCatalogEntryByIdentity(
            'rats',
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

    function processRat(image) {
        const entry = identifyRatEntry(image);

        if (!entry) {
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry
        );
    }

    function identifyRatEntry(image) {
        const ratCell = image.closest(
            'td.ratcell[id^="ratimg-"]'
        );

        if (
            !ratCell ||
            !/^ratimg-\d+$/.test(ratCell.id)
        ) {
            return null;
        }

        const hostImage = ratCell.querySelector(
            'div.ratimg > img.mainimg[title]'
        );

        if (!hostImage) {
            return null;
        }

        const identities = parseRatTitle(
            hostImage.getAttribute('title') || ''
        );

        if (!identities.host) {
            return null;
        }

        if (image === hostImage) {
            return findCatalogEntryByIdentity(
                'rats',
                identities.host
            );
        }

        const subImage = ratCell.querySelector(
            'div.ratimg > img.ratImg2'
        );

        if (
            image === subImage &&
            identities.sub
        ) {
            return findCatalogEntryByIdentity(
                'rats',
                identities.sub
            );
        }

        return null;
    }

    function parseRatTitle(value) {
        const parts = String(value || '')
            .split(/\s*\/\s*/)
            .map(part => part.trim())
            .filter(Boolean);

        return {
            host: parts[0] || null,
            sub: parts[1] || null
        };
    }

// ------------------------------------------------------------------------
// BACKPACK ITEMS
// ------------------------------------------------------------------------

    function processBackpackItem(image) {
        const entry = identifyBackpackItem(image);

        if (!entry) {
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry
        );
    }

    function identifyBackpackItem(image) {
        if (isCanvasMapImage(image)) {
            return null;
        }

        const candidates = [
            image.getAttribute('alt'),
            image.getAttribute('title'),
            image.getAttribute('src')
        ];

        /*
         * Prefer identity attached directly to the image.
         *
         * Backpack items now rely on the catalog identity index so nested
         * subfamilies such as Misc, Wearables, and MiningTools resolve
         * authoritatively.
         */
        for (const candidate of candidates) {
            const entry = findCatalogEntryByIdentity(
                'backpackItems',
                candidate
            );

            if (entry) {
                return entry;
            }
        }

        /*
         * Some Backpack items can be base64 images with no useful
         * filename or alt text.
         *
         * Only inspect the item's immediate semantic container, and
         * require its displayed text to BEGIN with the item name.
         */
        const container = image.closest('center, td');

        if (!container) {
            return null;
        }

        return findCatalogEntryByContainerText(
            'backpackItems',
            container.textContent || ''
        );
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

    const SLOT_IDENTITIES = Object.freeze({
        1: '1 Cherry',
        2: '2 Cherries',
        3: '3 Cherries',
        4: '1 Coin',
        5: '2 Coins',
        6: '3 Coins',
        7: '1 Bar',
        8: '2 Bars',
        9: '3 Bars',
        10: '1 Can',
        11: '2 Cans',
        12: '3 Cans',
        13: '7',
        14: '77',
        15: '777'
    });

    function identifySlotSymbol(image) {
        const src = image.getAttribute('src') || '';
        const hash = dataSrcHash(src);

    // ------------------------------------------------------------
    // Filename / pagespeed-backed native slot imagery
    // ------------------------------------------------------------

        const filenameMatch = src.match(
            /\/slots\/x?slot(\d{1,2})\.gif/i
        );

        if (filenameMatch) {
            const slot = Number.parseInt(
                filenameMatch[1],
                10
            );

            const identity = SLOT_IDENTITIES[slot];

            if (identity) {
                return identity;
            }
        }

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
// MINES BLAST TOOL PICKER
// ------------------------------------------------------------------------

    const MINING_BLAST_TOOL_HASHES = new Map([
        /* Authoritatively captured native base64 Pickaxe payload. */
        ['e5c4ccfa', 'Pickaxe']
    ]);

    function processMiningBlastTool(image) {
        const entry = identifyMiningBlastToolEntry(image);

        if (!entry) {
            return false;
        }

        return applyResolvedCatalogEntry(
            image,
            entry
        );
    }

    function identifyMiningBlastToolEntry(image) {
        const idMatch = String(image.id || '').match(
            /^choose_tool_(\d+)$/
        );

        if (!idMatch) {
            return null;
        }

        const toolCell = image.closest(
            'td[id^="tool_"]'
        );

        if (
            !toolCell ||
            toolCell.id !== `tool_${idMatch[1]}`
        ) {
            return null;
        }

        const src = image.getAttribute('src') || '';

        /*
         * Filename-backed imagery is already handled authoritatively by the
         * ordinary catalog/equipment resolver. This specialized path exists
         * only for native data-image fallback states.
         */
        if (!src.startsWith('data:image/')) {
            return null;
        }

        const markerName = String(
            image.getAttribute('name') || ''
        ).trim();

        /*
         * Explosive tools use their own image identity as the Blast marker.
         * The pickaxe family deliberately does not: both Pickaxe and Gold
         * Pickaxe use name="x", so never infer taxonomy from that marker.
         */
        if (markerName && markerName.toLowerCase() !== 'x') {
            const namedEntry = findCatalogEntryByIdentity(
                'backpackItems',
                markerName
            );

            if (
                namedEntry &&
                namedEntry.path.includes('MiningTools')
            ) {
                return namedEntry;
            }
        }

        const hash = dataSrcHash(src);
        const identity = MINING_BLAST_TOOL_HASHES.get(hash);

        if (identity) {
            const hashedEntry = findCatalogEntryByIdentity(
                'backpackItems',
                identity
            );

            if (
                hashedEntry &&
                hashedEntry.path.includes('MiningTools')
            ) {
                return hashedEntry;
            }
        }

        /*
         * tool_1 is the pickaxe-class Blast slot. HoboWars exposes only two
         * player-accessible variants there: Pickaxe and Gold Pickaxe. The
         * ordinary Pickaxe payload is fingerprinted above, so any other
         * base64 image in this exact slot with the shared name="x" marker can
         * safely fall through to Gold Pickaxe.
         */
        if (
            idMatch[1] === '1' &&
            markerName.toLowerCase() === 'x'
        ) {
            return findCatalogEntryByIdentity(
                'equipment',
                'Gold Pickaxe'
            );
        }

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
    /*
     * Player-profile link text is not valid equipment evidence. Hobos may use
     * equipment names as their display names, so strip those links from a
     * cloned semantic container before contextual equipment matching.
     */
    function getEquipmentContextText(container) {
        if (!container) {
            return '';
        }

        const clone = container.cloneNode(true);

        clone.querySelectorAll(
            'a[href*="cmd=player"][href*="ID="]'
        ).forEach(link => link.remove());

        return normalizeEquipmentName(
            clone.textContent
        );
    }

    function identifyEquipmentFromCell(image) {
        const cell = image.closest('td');

        if (!cell) {
            return null;
        }

        const text = getEquipmentContextText(cell);

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

        const text = getEquipmentContextText(row);

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
        const isMiningTool =
            Array.isArray(path) &&
            path[0] === 'backpackItems' &&
            path.includes('MiningTools');

        const isBlastMiningTool =
            isMiningTool &&
            /^choose_tool_\d+$/.test(image.id || '') &&
            Boolean(image.closest('td[id^="tool_"]'));

        const dimensions = isBlastMiningTool
            ? { width: 30, height: 30 }
            : getRenderedDimensions(image);

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

        image.style.objectFit = isMiningTool
            ? 'contain'
            : 'cover';
        image.style.objectPosition = 'center center';

        if (isBlastMiningTool) {
            image.setAttribute('width', '30');
            image.setAttribute('height', '30');
            image.style.minWidth = '30px';
            image.style.minHeight = '30px';
            image.style.maxWidth = '30px';
            image.style.maxHeight = '30px';
            image.style.boxSizing = 'border-box';
            image.style.display = 'inline-block';
            image.style.verticalAlign = 'middle';
            image.style.background = 'transparent';
        }

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

            /*
             * The native load event may fire after another pass has already
             * adapted this node. A stale retry must never erase the terminal
             * replaced state and interrogate DALI's own replacement image.
             */
            if (image.dataset.daliState === 'replaced') {
                return;
            }

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

    const cachedAssetMap = readCachedAssetMap();

    if (cachedAssetMap) {
        applyAssetMap(cachedAssetMap);
    }

    const cachedIdRegistry = readTimedCache(
        ID_REGISTRY_CACHE_KEY,
        validateIdRegistry
    );

    if (cachedIdRegistry) {
        applyIdRegistry(cachedIdRegistry.data);
    }

    const cachedRejectionRegistry = readTimedCache(
        REJECTION_REGISTRY_CACHE_KEY,
        validateRejectionRegistry
    );

    if (cachedRejectionRegistry) {
        applyRejectionRegistry(cachedRejectionRegistry.data);
    }

    const cachedSvgCatalog = readTimedCache(
        SVG_CATALOG_CACHE_KEY,
        validateSvgCatalog
    );

    if (cachedSvgCatalog) {
        applySvgCatalog(cachedSvgCatalog.data);
    }

    installLocalIdentityBridge();
    installLearningMenuCommands();
    initializeDali();

    refreshRemoteAssetMap();
    refreshRemoteIdRegistry();
    refreshRemoteRejectionRegistry();
    refreshRemoteSvgCatalog();
})();