// ==UserScript==
// @name         HW Dynamically Adapted Legacy Images
// @namespace    https://www.hobowars.com/
// @version      0.51
// @description  DALI seeks out native, legacy images in the Hobowars domain and substitutes them while retaining their dimensions for a crisper, more contemporary aesthetic.
// @author       lvl11evelyn / HW1 (2924238)
// @match        *://hobowars.com/*
// @match        *://*.hobowars.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

// ============================================================================
// DALI - DYNAMICALLY ADAPTED LEGACY IMAGES
// ============================================================================

(() => {
    'use strict';


// ------------------------------------------------------------------------
// REPLACEMENT REGISTRY
// ------------------------------------------------------------------------

    const REPLACEMENTS = {
        equipment: {
            'Hattori-Hanzo Sword': 'https://i.imgur.com/7vFKfMP.png',
            'Full-Body Trap': 'https://i.imgur.com/04oFlmN.png',
            'Filthy Socks': 'https://i.imgur.com/joZaAy4.png',
            'Cricket Bat': 'https://i.imgur.com/NN5yJ3P.png',
            'Balltop Cane': 'https://i.imgur.com/QOxlr1N.png',
            'MHGA Sign': 'https://i.imgur.com/ZPrZ60z.png',
            'Valyrian Steel Blade': 'https://i.imgur.com/virWHrL.png',
            'Coffee-Soaked Mop': 'https://i.imgur.com/hSc5B3K.png',
            'Sting': 'https://i.imgur.com/XPbif72.png',
            'Can Cannon': 'https://i.imgur.com/uUMtVug.png',
            'Hacksaw': 'https://i.imgur.com/1QmvhdZ.png',
            "Beggar's Bludgeon":'https://i.imgur.com/1hNW2nX.png',
            'Gold Pickaxe': 'https://i.imgur.com/koYGGaF.png',
            'Hackeysack': 'https://i.imgur.com/NU1Hm1c.png',
            'Ratarang': 'https://i.imgur.com/jvdD0yS.png',
            'Weaponized Bindle': 'https://i.imgur.com/7qFqBmt.png',
            'Water Cannon': 'https://i.imgur.com/waXHq3q.png',
            'Championship Belt': 'https://i.imgur.com/tFUAP92.png',
            'Gold Folding Chair': 'https://i.imgur.com/gC8yOxg.png',
            'Golden Rod': 'https://i.imgur.com/SHHnw5S.png',

            'Wonka Ring': 'https://i.imgur.com/I503bqk.png',
            'Rodent Ring': 'https://i.imgur.com/ldE9Adi.png',
            'Onion Ring': 'https://i.imgur.com/NFzQitY.png',
            'Chewing Gum Ring': 'https://i.imgur.com/ptqgOT7.png',
            'Engagement Ring': 'https://i.imgur.com/AHbTxT9.png',
            'Respect Ring': 'https://i.imgur.com/mBvsJ6d.png',

            'Kobayashi Ring': 'https://i.imgur.com/t8x3Kce.png',
            'Toothpuff Ring': 'https://i.imgur.com/8Mjwx7g.png',
            'Ring Pop': 'https://i.imgur.com/2YGfOJF.png',
            'Green Lantern Ring': 'https://i.imgur.com/Edy751T.png',
            'Beggar Ring': 'https://i.imgur.com/hGuIhLM.png'
        },

        tattoos: {
            'Boozaholic': 'https://i.imgur.com/2FnyyLv.png',
            'Rattoo': 'https://i.imgur.com/BG2Jbpw.png',
            'Skull-Pot': 'https://i.imgur.com/vkuyUaY.png',
            'Cantastic': 'https://i.imgur.com/bueFImn.png',
            'Liberty Cycle': 'https://i.imgur.com/91JlOwh.png',
            'Middle Earth Rock': 'https://i.imgur.com/O6Crd8S.png',
            'Packin Sasquatch': 'https://i.imgur.com/gwscPXL.png',
            'Beggars Paradise': 'https://i.imgur.com/Gmxgh3B.png',
            'Arena Badass': 'https://i.imgur.com/NejOXS6.png'
        },
        specialItems: {
            'Hobo Grail (Depleted)': 'https://i.imgur.com/BEX1ls6.png',
            'Hobo Grail (Full)': 'https://i.imgur.com/2Lz5HCc.png',
            "King's Kiddie Cup+": 'https://i.imgur.com/qCxDIVc.png'
        },
        bernardsSpecialItems: {
            'Cabana Club Card': 'https://i.imgur.com/v5SWazu.png',
            'Library Card': 'https://i.imgur.com/BFDRT2u.png',
            'Training Shoes': 'https://i.imgur.com/uuR89Yp.png',
            'Professional Beggar Outfit': 'https://i.imgur.com/aoBxfy0.png',
            'Green Card': 'https://i.imgur.com/0YMvHvr.png',
            'Debit Card': 'https://i.imgur.com/xkwoVRi.png',
            'Special Sunglasses': 'https://i.imgur.com/V54X14b.png'
        },

        backpackItems: {
            'Care Package': 'https://i.imgur.com/2JKw0ca.png',
            'Cardboard Box': 'https://i.imgur.com/DQPaaTa.png'
        },

        currencies: {
            'Money': 'https://i.imgur.com/AzNtUzE.png',
            'Cans': 'https://i.imgur.com/VxnDASV.png',
            'Tokens': 'https://i.imgur.com/1jMG4iN.png',
            'Food Stamps': 'https://i.imgur.com/A6sf6dd.png',
            'Points': 'https://i.imgur.com/CxlQGI2.png',
            'Donator Packs': 'https://i.imgur.com/eHSCpsk.png'
        }
    };


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
// LOOKUP TABLES
// ------------------------------------------------------------------------

    const EQUIPMENT_NAMES = Object.keys(REPLACEMENTS.equipment);

    const NORMALIZED_EQUIPMENT_NAMES = new Map(
        EQUIPMENT_NAMES.map(name => [
            normalizeEquipmentName(name),
            name
        ])
    );

    const EQUIPMENT_SLUGS = new Map(
        EQUIPMENT_NAMES.map(name => [
            slugify(name),
            name
        ])
    );

    function normalizeAssetName(value) {
        if (!value) {
            return '';
        }

        let text = String(value).trim();

        // If it's a URL/path, keep only the last path segment.
        if (text.includes('/')) {
            text = text.split('/').pop() || text;
        }

        // Decode things like %20.
        try {
            text = decodeURIComponent(text);
        } catch (err) {
            // Ignore malformed escape sequences and keep raw text.
        }

        // Strip query/hash if they ever appear.
        text = text.split('?')[0].split('#')[0];

        // Strip extension.
        text = text.replace(/\.(gif|png|jpe?g|webp)$/i, '');

        // Normalize separators.
        text = text.replace(/[_-]+/g, ' ');

        // Collapse whitespace.
        text = text.replace(/\s+/g, ' ').trim();

        return text;
    }

    function findCatalogMatch(rawValue, catalog) {
        const normalizedNeedle = normalizeAssetName(rawValue);

        if (!normalizedNeedle) {
            return null;
        }

        for (const key of Object.keys(catalog)) {
            if (normalizeAssetName(key) === normalizedNeedle) {
                return key;
            }
        }

        return null;
    }
// ------------------------------------------------------------------------
// INITIAL SCAN
// ------------------------------------------------------------------------

    scan(document);

// ------------------------------------------------------------------------
// DYNAMIC CONTENT
// ------------------------------------------------------------------------

    const observer = new MutationObserver(mutations => {
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

    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

// ------------------------------------------------------------------------
// SCANNING
// ------------------------------------------------------------------------

    function scan(root) {
        if (!root?.querySelectorAll) {
            return;
        }

        /*
         * One-off native top-menu currency icon replacement.
         *
         * The Cans counter in .section.bmenu is not an <img>; HoboWars renders
         * it as <div class="img cans"></div>. Handle that legacy CSS-sprite
         * location directly while preserving the native element geometry.
         */
        replaceBmenuCansIcon(root);

        for (const image of root.querySelectorAll('img')) {
            processImage(image);
        }
    }

    function replaceBmenuCansIcon(root) {
        const replacementUrl = REPLACEMENTS.currencies.Cans;

        if (!replacementUrl) {
            return;
        }

        const selector = '.section.bmenu .img.cans';
        const icons = [];

        /*
         * querySelectorAll() does not include root itself, so explicitly catch
         * a dynamically-added .img.cans node before scanning its descendants.
         */
        if (
            root instanceof Element &&
            root.matches(selector)
        ) {
            icons.push(root);
        }

        icons.push(
            ...root.querySelectorAll(selector)
        );

        for (const icon of icons) {
            if (icon.dataset.daliCurrencyUi === 'Cans') {
                continue;
            }

            icon.dataset.daliCurrencyUi = 'Cans';

            /*
             * Override the native sprite properties only. Width, height,
             * margins and surrounding top-menu layout remain owned by HoboWars.
             */
            icon.style.setProperty(
                'background-image',
                `url("${replacementUrl}")`,
                'important'
            );
            icon.style.setProperty(
                'background-position',
                'center',
                'important'
            );
            icon.style.setProperty(
                'background-repeat',
                'no-repeat',
                'important'
            );
            icon.style.setProperty(
                'background-size',
                'contain',
                'important'
            );
        }
    }

    function processImage(image) {
        if (!(image instanceof HTMLImageElement)) {
            return;
        }

        if (image.dataset.daliName) {
            return;
        }

        // Tattoos have the strongest native semantic identifier:
        // the exact tattoo name in the alt attribute.
        if (processTattoo(image)) {
            return;
        }

        if (processSpecialItem(image)) {
            return;
        }

        if (processSlotSymbol(image)) {
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

        processEquipment(image);
    }

    function processSpecialItem(image) {
        const identity = identifySpecialItem(image);

        if (!identity) {
            return false;
        }

        const replacementUrl =
            REPLACEMENTS.specialItems[identity];

        if (!replacementUrl) {
            return false;
        }

        replaceImage(
            image,
            identity,
            replacementUrl,
            'special-item'
        );

        return true;
    }

    function identifySpecialItem(image) {
        const src = image.getAttribute('src') || '';
        const alt = image.getAttribute('alt') || '';

    // ------------------------------------------------------------
    // Hobo Grail — depleted
    // ------------------------------------------------------------

        if (
            /Hobo-Grail-Dark/i.test(src) ||
            dataSrcHash(src) === '23e145b2'
        ) {
            return 'Hobo Grail (Depleted)';
        }

    // ------------------------------------------------------------
    // Hobo Grail — full
    // ------------------------------------------------------------

        if (
            /Hobo-Grail(?!-Dark)/i.test(src) ||
            dataSrcHash(src) === 'be956455'
        ) {
            return 'Hobo Grail (Full)';
        }

    // ------------------------------------------------------------
    // King's Kiddie Cup+
    // ------------------------------------------------------------

        if (
            alt === "King's Kiddie Cup" ||
            /Kings-Kiddie-Cup/i.test(src)
        ) {
            return "King's Kiddie Cup+";
        }

        /*
         * HoboWars serves several differently resized base64 versions
         * of the Kiddie Cup. These hashes identify those exact native
         * image payloads without embedding thousands of characters of
         * base64 into DALI.
         */
        const hash = dataSrcHash(src);

        if (
            hash === '9ab0cb50' ||
            hash === '4217fcb3' ||
            hash === '32fea929' ||
            hash === '207191e6'
        ) {
            return "King's Kiddie Cup+";
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

        const replacementUrl = REPLACEMENTS.tattoos[name];

        if (!replacementUrl) {
            return false;
        }

        const fade = getTattooFade(image);

        replaceImage(
            image,
            name,
            replacementUrl,
            'tattoo'
        );

        if (fade !== null) {
            image.style.opacity = String(
                TATTOO_OPACITY[fade]
            );
        }

        return true;
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

        const replacementUrl =
            REPLACEMENTS.bernardsSpecialItems[identity];

        if (!replacementUrl) {
            return false;
        }

        replaceImage(
            image,
            identity,
            replacementUrl,
            'bernards-special-item'
        );

        return true;
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
                if (
                    normalizeAssetName(containerText)
                        .includes(
                            normalizeAssetName(name)
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

        const replacementUrl =
            REPLACEMENTS.backpackItems[identity];

        if (!replacementUrl) {
            return false;
        }

        replaceImage(
            image,
            identity,
            replacementUrl,
            'backpack-item'
        );

        return true;
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

        const replacementUrl = REPLACEMENTS.currencies[identity];

        if (!replacementUrl) {
            return false;
        }

        replaceImage(
            image,
            identity,
            replacementUrl,
            'currency'
        );

        return true;
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

        const replacementUrl =
            REPLACEMENTS.equipment[itemName];

        if (!replacementUrl) {
            return false;
        }

        replaceImage(
            image,
            itemName,
            replacementUrl,
            'equipment'
        );

        return true;
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
        ).toLowerCase();

        if (
            !src ||
            src.startsWith('data:')
        ) {
            return null;
        }

        for (const [slug, itemName] of EQUIPMENT_SLUGS) {
            if (src.includes(slug)) {
                return itemName;
            }
        }

        return null;
    }

// ------------------------------------------------------------------------
// IMAGE REPLACEMENT
// ------------------------------------------------------------------------

    function replaceImage(
        image,
        name,
        replacementUrl,
        category
    ) {
        const dimensions =
            getRenderedDimensions(image);

        if (!dimensions) {
            /*
             * If the native image genuinely has not established dimensions
             * yet, retry once it loads.
             */
            if (!image.dataset.daliPending) {
                image.dataset.daliPending = 'true';

                image.addEventListener(
                    'load',
                    () => {
                        delete image.dataset.daliPending;
                        processImage(image);
                    },
                    { once: true }
                );
            }

            return;
        }

        const originalSrc =
            image.getAttribute('src') || '';

        image.dataset.daliName = name;
        image.dataset.daliCategory = category;
        image.dataset.daliOriginalSrc = originalSrc;

        /*
         * The native occurrence owns its geometry.
         * DALI changes the artwork, not the layout.
         */
        image.style.width =
            `${dimensions.width}px`;

        image.style.height =
            `${dimensions.height}px`;

        image.style.objectFit = 'cover';

        image.style.objectPosition = 'center';

        /*
         * Prevent native responsive-image metadata from overriding the
         * replacement source.
         */
        image.removeAttribute('srcset');
        image.removeAttribute('sizes');

        image.src = replacementUrl;
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
            normalized
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

    function slugify(value) {
        return normalizeEquipmentName(value)
            .toLowerCase()
            .replace(/\s+/g, '-');
    }

    function numericDimension(value) {
        const number = Number.parseFloat(value);

        return Number.isFinite(number)
            ? number
            : 0;
    }
})();