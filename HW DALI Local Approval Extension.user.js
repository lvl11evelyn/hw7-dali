// ==UserScript==
// @name         HW DALI Local Approval Extension
// @namespace    https://www.hobowars.com/
// @version      1.6
// @description  Optional local approval workflow for DALI pending identity associations. Stores only local user authority and cannot modify DALI's canonical remote registry.
// @author       lvl11evelyn / HW1 (2924238)
// @match        *://hobowars.com/*
// @match        *://*.hobowars.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// ==/UserScript==

(() => {
    'use strict';

    const STORAGE_KEY = 'hw-dali-local-approval-extension-v1';
    const GITHUB_TOKEN_KEY = 'hw-dali-local-approval-extension-github-token-v1';
    const GITHUB_OWNER = 'lvl11evelyn';
    const GITHUB_REPO = 'hw7-dali';
    const GITHUB_API_VERSION = '2026-03-10';
    const GITHUB_ISSUE_BODY_LIMIT = 60000;

    const LOCAL_IDENTITY_REGISTER_EVENT = 'dali:register-local-identities';
    const LOCAL_IDENTITY_READY_EVENT = 'dali:local-identity-channel-ready';
    const PENDING_SNAPSHOT_REQUEST_EVENT = 'dali:request-pending-snapshot';
    const PENDING_SNAPSHOT_EVENT = 'dali:pending-snapshot';
    const REVIEW_OPENED_EVENT = 'dali:review-opened';
    const REVIEW_CLOSED_EVENT = 'dali:review-closed';

    let state = loadState();
    let pendingByToken = new Map();
    let desiredFocusToken = '';
    let reviewKeyHandler = null;

    installEventBridge();
    installMenuCommands();

    publishApprovedMappings();
    requestPendingSnapshot();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            publishApprovedMappings();
            requestPendingSnapshot();
        }, { once: true });
    }

    function newState() {
        return {
            schema: 1,
            approvals: {},
            submissions: {}
        };
    }

    function loadState() {
        try {
            const raw = GM_getValue(STORAGE_KEY, '');
            const parsed = raw ? JSON.parse(raw) : null;

            if (
                parsed &&
                parsed.schema === 1 &&
                parsed.approvals &&
                typeof parsed.approvals === 'object' &&
                !Array.isArray(parsed.approvals)
            ) {
                if (!parsed.submissions || typeof parsed.submissions !== 'object' || Array.isArray(parsed.submissions)) {
                    parsed.submissions = {};
                }
                return parsed;
            }
        } catch (error) {
            console.warn('[DALI Approval] Stored approvals could not be read.', error);
        }

        return newState();
    }

    function saveState() {
        try {
            GM_setValue(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('[DALI Approval] Local approvals could not be saved.', error);
        }
    }

    function installEventBridge() {
        document.addEventListener(LOCAL_IDENTITY_READY_EVENT, () => {
            publishApprovedMappings();
        });

        document.addEventListener(PENDING_SNAPSHOT_EVENT, event => {
            try {
                const payload = parseEventDetail(event.detail);
                acceptPendingSnapshot(payload);
                injectApprovalControls();
            } catch (error) {
                console.warn('[DALI Approval] Pending snapshot rejected.', error);
            }
        });

        document.addEventListener(REVIEW_OPENED_EVENT, () => {
            requestPendingSnapshot();
            queueMicrotask(injectApprovalControls);
        });

        document.addEventListener(REVIEW_CLOSED_EVENT, () => {
            removeReviewKeyboardHandler();
        });
    }

    function parseEventDetail(detail) {
        if (typeof detail === 'string') {
            return JSON.parse(detail);
        }

        if (detail && typeof detail === 'object') {
            return detail;
        }

        throw new Error('Event has no usable payload.');
    }

    function requestPendingSnapshot() {
        document.dispatchEvent(new CustomEvent(PENDING_SNAPSHOT_REQUEST_EVENT));
    }

    function acceptPendingSnapshot(payload) {
        if (
            !payload ||
            payload.schema !== 1 ||
            payload.type !== 'dali-pending-snapshot' ||
            !Array.isArray(payload.associations)
        ) {
            throw new Error('Unsupported pending snapshot.');
        }

        const next = new Map();

        for (const item of payload.associations) {
            if (
                !item ||
                typeof item.token !== 'string' ||
                !item.token ||
                !item.proposal ||
                typeof item.proposal !== 'object'
            ) {
                continue;
            }

            next.set(item.token, item.proposal);
        }

        pendingByToken = next;
    }

    function approvalKey(proposal) {
        const source = proposal?.source || {};
        const identity = proposal?.proposedIdentity || {};

        const sourceKey = source.sourceType === 'data-image'
            ? `fnv:${String(source.fnvHash || '').toLowerCase()}`
            : `filename:${normalizeFilenameAuthority(source.normalizedFilename || source.filename || '')}`;

        return `${sourceKey}\u0000${(identity.path || []).join('/')}`;
    }

    function normalizeFilenameAuthority(value) {
        return String(value || '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function validateProposal(proposal) {
        if (!proposal || typeof proposal !== 'object') {
            return false;
        }

        const source = proposal.source;
        const identity = proposal.proposedIdentity;

        if (!source || !identity || !Array.isArray(identity.path) || identity.path.length < 2) {
            return false;
        }

        if (
            identity.catalog !== identity.path[0] ||
            identity.identity !== identity.path[identity.path.length - 1]
        ) {
            return false;
        }

        if (source.sourceType === 'data-image') {
            return /^[0-9a-f]{8}$/i.test(String(source.fnvHash || ''));
        }

        if (source.sourceType === 'url') {
            return Boolean(
                normalizeFilenameAuthority(
                    source.normalizedFilename || source.filename || ''
                )
            );
        }

        return false;
    }

    function approvePending(token) {
        const proposal = pendingByToken.get(token);

        if (!validateProposal(proposal)) {
            console.warn('[DALI Approval] Cannot approve malformed pending proposal.', token);
            return;
        }

        const cards = getReviewCards();
        const currentIndex = cards.findIndex(card => card.dataset.daliPendingToken === token);
        const nextCard = currentIndex >= 0
            ? cards[currentIndex + 1] || cards[currentIndex - 1] || null
            : null;

        desiredFocusToken = nextCard?.dataset.daliPendingToken || '';

        const key = approvalKey(proposal);
        state.approvals[key] = {
            schema: 1,
            approvedAt: Date.now(),
            source: structuredCloneSafe(proposal.source),
            proposedIdentity: structuredCloneSafe(proposal.proposedIdentity),
            confidence: Number(proposal.confidence) || 0,
            observations: Number(proposal.observations) || 0,
            evidence: structuredCloneSafe(proposal.evidence || {})
        };

        saveState();
        publishApprovedMappings();
    }

    function structuredCloneSafe(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function approvedMappings() {
        return Object.values(state.approvals)
            .filter(approval => validateProposal(approval))
            .map(approval => ({
                source: approval.source,
                proposedIdentity: approval.proposedIdentity
            }));
    }

    function publishApprovedMappings() {
        const mappings = approvedMappings();

        document.dispatchEvent(
            new CustomEvent(LOCAL_IDENTITY_REGISTER_EVENT, {
                detail: JSON.stringify({
                    schema: 1,
                    type: 'dali-local-identities',
                    source: 'HW DALI Local Approval Extension',
                    mappings
                })
            })
        );
    }

    function getReviewCards() {
        const panel = document.getElementById('dali-pending-review-panel');
        if (!panel) return [];

        return [
            ...panel.querySelectorAll('[data-dali-pending-token]')
        ].filter(element =>
            element.matches('div[data-dali-pending-token]')
        );
    }

    function injectApprovalControls() {
        const panel = document.getElementById('dali-pending-review-panel');
        if (!panel) {
            removeReviewKeyboardHandler();
            return;
        }

        for (const card of getReviewCards()) {
            const token = card.dataset.daliPendingToken || '';
            const proposal = pendingByToken.get(token);
            const reject = card.querySelector('[data-dali-action="reject"]');
            const actionHost = card.querySelector('[data-dali-review-actions="1"]');

            if (!token || !proposal || !reject || !actionHost) {
                continue;
            }

            reject.dataset.daliApprovalCycle = 'reject';
            reject.tabIndex = 0;

            if (!reject.dataset.daliApprovalFocusHook) {
                reject.dataset.daliApprovalFocusHook = '1';
                reject.addEventListener('click', () => {
                    const cards = getReviewCards();
                    const index = cards.findIndex(item => item.dataset.daliPendingToken === token);
                    const next = index >= 0
                        ? cards[index + 1] || cards[index - 1] || null
                        : null;
                    desiredFocusToken = next?.dataset.daliPendingToken || '';
                }, true);
            }

            let approve = card.querySelector('[data-dali-local-approve="1"]');

            if (!approve) {
                approve = document.createElement('button');
                approve.type = 'button';
                approve.textContent = 'Approve Locally';
                approve.dataset.daliLocalApprove = '1';
                approve.dataset.daliApprovalCycle = 'approve';
                approve.dataset.daliPendingToken = token;
                approve.style.marginLeft = '8px';
                approve.style.fontWeight = '700';
                approve.onclick = () => approvePending(token);
                reject.insertAdjacentElement('afterend', approve);
            }

            approve.tabIndex = 0;
        }

        /*
         * When this optional extension is installed, Tab is a dedicated review
         * workflow: Reject -> Approve -> next Reject -> next Approve. Every
         * other interactive object remains mouse-accessible but is removed
         * from the keyboard cycle for this panel.
         */
        for (const element of panel.querySelectorAll(
            'button, a[href], summary, input, select, textarea, [tabindex]'
        )) {
            if (element.dataset.daliApprovalCycle) {
                element.tabIndex = 0;
            } else {
                element.tabIndex = -1;
            }
        }

        installReviewKeyboardHandler();

        requestAnimationFrame(() => {
            const desired = desiredFocusToken
                ? panel.querySelector(
                    `[data-dali-action="reject"][data-dali-pending-token="${cssEscape(desiredFocusToken)}"]`
                )
                : null;

            const current = document.activeElement;
            const currentIsCycle = current?.dataset?.daliApprovalCycle;

            if (desired) {
                desired.focus();
                desiredFocusToken = '';
                return;
            }

            if (!currentIsCycle) {
                panel.querySelector('[data-dali-action="reject"]')?.focus();
            }
        });
    }

    function cssEscape(value) {
        if (window.CSS?.escape) {
            return CSS.escape(value);
        }

        return String(value).replace(/["\\]/g, '\\$&');
    }

    function reviewCycleButtons() {
        const panel = document.getElementById('dali-pending-review-panel');
        if (!panel) return [];

        const out = [];

        for (const card of getReviewCards()) {
            const reject = card.querySelector('[data-dali-action="reject"]');
            const approve = card.querySelector('[data-dali-local-approve="1"]');

            if (reject) out.push(reject);
            if (approve) out.push(approve);
        }

        return out;
    }

    function installReviewKeyboardHandler() {
        const overlay = document.getElementById('dali-pending-review');
        if (!overlay) return;

        removeReviewKeyboardHandler();

        reviewKeyHandler = event => {
            if (event.key !== 'Tab') return;

            const buttons = reviewCycleButtons();
            if (!buttons.length) return;

            event.preventDefault();
            event.stopPropagation();

            const currentIndex = buttons.indexOf(document.activeElement);
            let nextIndex;

            if (currentIndex < 0) {
                nextIndex = 0;
            } else if (event.shiftKey) {
                nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
            } else {
                nextIndex = (currentIndex + 1) % buttons.length;
            }

            buttons[nextIndex].focus();
        };

        overlay.addEventListener('keydown', reviewKeyHandler, true);
    }

    function removeReviewKeyboardHandler() {
        if (!reviewKeyHandler) return;

        const overlay = document.getElementById('dali-pending-review');
        overlay?.removeEventListener('keydown', reviewKeyHandler, true);
        reviewKeyHandler = null;
    }



    function getGitHubToken() {
        return String(GM_getValue(GITHUB_TOKEN_KEY, '') || '').trim();
    }

    function configureGitHubToken() {
        const current = getGitHubToken();
        const token = prompt(
            [
                'Configure the GitHub token used for DALI issue submissions.',
                '',
                `Target repository: ${GITHUB_OWNER}/${GITHUB_REPO}`,
                '',
                'For most public contributors:',
                'GitHub → Settings → Developer settings',
                '→ Personal access tokens → Tokens (classic)',
                '→ Generate new token',
                '→ enable public_repo',
                '',
                'Repository owners/collaborators may instead use a',
                'fine-grained token with Issues: Read and write.',
                '',
                'This token is stored only in this userscript\'s GM storage.',
                '',
                current
                    ? 'A token is currently stored. Enter a new token to replace it, leave the field blank to remove it, or Cancel to keep it unchanged.'
                    : 'Enter a token to store it, or Cancel/leave blank to make no change.'
            ].join('\n'),
            ''
        );

        if (token === null) return;

        const trimmed = token.trim();

        if (!trimmed) {
            if (!current) {
                return;
            }

            if (!confirm('Remove the stored GitHub issue-submission token?')) {
                return;
            }

            GM_setValue(GITHUB_TOKEN_KEY, '');
            alert('GitHub submission token removed.');
            return;
        }

        GM_setValue(GITHUB_TOKEN_KEY, trimmed);
        alert(
            current
                ? 'GitHub issue-submission token updated.'
                : 'GitHub issue-submission token stored.'
        );
    }

    function approvalSubmissionKey(approval) {
        return approvalKey(approval);
    }

    function unsubmittedApprovals() {
        return Object.values(state.approvals)
            .filter(approval => validateProposal(approval))
            .filter(approval => !state.submissions[approvalSubmissionKey(approval)])
            .sort((a, b) => a.approvedAt - b.approvedAt);
    }

    function registryMergeForApprovals(approvals) {
        const grouped = new Map();

        for (const approval of approvals) {
            if (!validateProposal(approval)) continue;

            const identity = approval.proposedIdentity;
            const registryKey = identity.path.join('/');
            let entry = grouped.get(registryKey);

            if (!entry) {
                entry = {
                    catalog: identity.catalog,
                    identity: identity.identity,
                    path: [...identity.path],
                    filenames: [],
                    hashes: []
                };
                grouped.set(registryKey, entry);
            }

            if (approval.source.sourceType === 'data-image') {
                const hash = String(approval.source.fnvHash || '').toLowerCase();
                if (hash && !entry.hashes.includes(hash)) entry.hashes.push(hash);
            } else {
                const filename = String(
                    approval.source.normalizedFilename || approval.source.filename || ''
                ).trim();
                if (filename && !entry.filenames.includes(filename)) entry.filenames.push(filename);
            }
        }

        const identities = {};
        for (const key of [...grouped.keys()].sort()) {
            const entry = grouped.get(key);
            entry.filenames.sort((a, b) => a.localeCompare(b));
            entry.hashes.sort();
            identities[key] = entry;
        }
        return identities;
    }

    function truncateForGitHub(value, maxLength = 100) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
    }

    function compactEvidenceValue(values, maxLength = 100) {
        const list = Array.isArray(values)
            ? values.map(value => truncateForGitHub(value, maxLength)).filter(Boolean)
            : [];

        if (!list.length) {
            return '';
        }

        const primary = list[0];
        return list.length > 1
            ? truncateForGitHub(`${primary} (+${list.length - 1})`, maxLength)
            : primary;
    }

    function compactApprovalForGitHubSubmission(approval) {
        const source = approval?.source || {};
        const identity = approval?.proposedIdentity || {};
        const evidence = approval?.evidence || {};

        const compact = {
            src: source.sourceType === 'data-image'
                ? {
                    t: 'd',
                    h: String(source.fnvHash || '').toLowerCase()
                }
                : {
                    t: 'u',
                    s: truncateForGitHub(source.src || '', 100),
                    f: truncateForGitHub(source.normalizedFilename || source.filename || '', 100)
                },
            id: {
                p: Array.isArray(identity.path) ? identity.path.join('/') : '',
                c: identity.catalog || '',
                n: identity.identity || ''
            },
            cf: Math.round((Number(approval?.confidence) || 0) * 1000) / 10,
            ob: Number(approval?.observations) || 0,
            ctx: {
                p: compactEvidenceValue(evidence.pageHrefs, 100),
                a: compactEvidenceValue(evidence.anchorHrefs, 100),
                al: compactEvidenceValue(evidence.alt, 100),
                ti: compactEvidenceValue(evidence.title, 100),
                ar: compactEvidenceValue(evidence.ariaLabel, 100),
                ct: compactEvidenceValue(evidence.containerText, 100),
                cu: compactEvidenceValue(evidence.cues, 100)
            }
        };

        for (const key of Object.keys(compact.ctx)) {
            if (!compact.ctx[key]) {
                delete compact.ctx[key];
            }
        }

        if (!Object.keys(compact.ctx).length) {
            delete compact.ctx;
        }

        if (compact.src.t === 'u') {
            if (!compact.src.s) delete compact.src.s;
            if (!compact.src.f) delete compact.src.f;
        }

        return compact;
    }

    function githubSubmissionPayload(approvals) {
        return {
            schema: 1,
            type: 'dali-canonical-identity-submission',
            submittedAt: Date.now(),
            source: 'HW DALI Local Approval Extension',
            repository: `${GITHUB_OWNER}/${GITHUB_REPO}`,
            count: approvals.length,
            associations: approvals.map(compactApprovalForGitHubSubmission)
        };
    }

    function githubIssueBody(payload) {
        return [
            '## DALI identity submission',
            '',
            'This issue was created by the HW DALI Local Approval Extension from locally approved identity associations.',
            '',
            'Local approval is not canonical approval. The compact payload below is review evidence only; canonical authority changes only when a repository maintainer updates the canonical registry.',
            '',
            `Associations: ${payload.count}`,
            'Legend: src.t = u(url) or d(data-image), src.s = source string, src.f = filename, src.h = FNV hash, id.p = registry path, cf = confidence %, ob = observations, ctx values truncated to ~100 chars.',
            '',
            '```json',
            JSON.stringify(payload),
            '```'
        ].join('\n');
    }

    function buildGitHubSubmissionBatches(approvals) {
        const batches = [];
        let current = [];

        for (const approval of approvals) {
            const trial = [...current, approval];
            const trialPayload = githubSubmissionPayload(trial);
            const trialBody = githubIssueBody(trialPayload);

            if (current.length && trialBody.length > GITHUB_ISSUE_BODY_LIMIT) {
                const payload = githubSubmissionPayload(current);
                batches.push({
                    approvals: current,
                    payload,
                    body: githubIssueBody(payload)
                });
                current = [approval];
                continue;
            }

            if (!current.length && trialBody.length > GITHUB_ISSUE_BODY_LIMIT) {
                throw new Error('A single approved association exceeds the GitHub issue size limit.');
            }

            current = trial;
        }

        if (current.length) {
            const payload = githubSubmissionPayload(current);
            batches.push({
                approvals: current,
                payload,
                body: githubIssueBody(payload)
            });
        }

        return batches;
    }

    function githubRequest(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method,
                url: options.url,
                headers: options.headers,
                data: options.data,
                timeout: 15000,
                onload(response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            resolve(JSON.parse(response.responseText || '{}'));
                        } catch (error) {
                            reject(new Error(`GitHub returned unreadable JSON: ${error.message}`));
                        }
                        return;
                    }

                    let message = '';
                    let details = '';

                    try {
                        const parsed = JSON.parse(response.responseText || '{}');
                        message = parsed.message || '';

                        if (Array.isArray(parsed.errors) && parsed.errors.length) {
                            details = '\n' + parsed.errors.map(error => {
                                if (typeof error === 'string') return error;
                                return JSON.stringify(error);
                            }).join('\n');
                        }
                    } catch {}

                    reject(new Error(
                        `GitHub issue request failed with HTTP ${response.status}${message ? `: ${message}` : '.'}${details}`
                    ));
                },
                onerror() {
                    reject(new Error('GitHub issue request failed at the network layer.'));
                },
                ontimeout() {
                    reject(new Error('GitHub issue request timed out.'));
                }
            });
        });
    }

    async function submitApprovedAssociationsToGitHub() {
        const approvals = unsubmittedApprovals();

        if (!approvals.length) {
            alert('There are no unsubmitted locally approved associations.');
            return;
        }

        let token = getGitHubToken();
        if (!token) {
            configureGitHubToken();
            token = getGitHubToken();
            if (!token) return;
        }

        const batches = buildGitHubSubmissionBatches(approvals);

        if (!confirm(
            `Submit ${approvals.length} locally approved association${approvals.length === 1 ? '' : 's'} to ${GITHUB_OWNER}/${GITHUB_REPO} as ${batches.length} GitHub Issue${batches.length === 1 ? '' : 's'}?`
        )) {
            return;
        }

        try {
            const createdIssues = [];
            const submittedAt = Date.now();

            for (let index = 0; index < batches.length; index += 1) {
                const batch = batches[index];
                const title = batches.length === 1
                    ? `DALI identity submission — ${batch.approvals.length} association${batch.approvals.length === 1 ? '' : 's'}`
                    : `DALI identity submission ${index + 1}/${batches.length} — ${batch.approvals.length} association${batch.approvals.length === 1 ? '' : 's'}`;

                const issue = await githubRequest({
                    method: 'POST',
                    url: `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
                    headers: {
                        'Accept': 'application/vnd.github+json',
                        'Authorization': `Bearer ${token}`,
                        'X-GitHub-Api-Version': GITHUB_API_VERSION,
                        'Content-Type': 'application/json'
                    },
                    data: JSON.stringify({ title, body: batch.body })
                });

                if (!issue || !Number.isInteger(issue.number) || !issue.html_url) {
                    throw new Error('GitHub created an issue but returned no usable issue identity.');
                }

                createdIssues.push(issue);

                for (const approval of batch.approvals) {
                    state.submissions[approvalSubmissionKey(approval)] = {
                        issueNumber: issue.number,
                        issueUrl: issue.html_url,
                        submittedAt
                    };
                }
            }

            saveState();

            const summary = createdIssues
                .map(issue => `#${issue.number}: ${issue.html_url}`)
                .join('\n');

            alert(
                `DALI submission created as ${createdIssues.length} GitHub Issue${createdIssues.length === 1 ? '' : 's'}.\n\n${summary}`
            );
            window.open(createdIssues[0].html_url, '_blank', 'noopener,noreferrer');
        } catch (error) {
            console.error('[DALI Approval] GitHub submission failed.', error);
            alert(
                [
                    'DALI GitHub submission failed.',
                    '',
                    error.message,
                    '',
                    'Local approvals were not changed or discarded.'
                ].join('\n')
            );
        }
    }

    function registryMergeObject() {
        const grouped = new Map();

        for (const approval of Object.values(state.approvals)) {
            if (!validateProposal(approval)) continue;

            const identity = approval.proposedIdentity;
            const registryKey = identity.path.join('/');

            let entry = grouped.get(registryKey);
            if (!entry) {
                entry = {
                    catalog: identity.catalog,
                    identity: identity.identity,
                    path: [...identity.path],
                    filenames: [],
                    hashes: []
                };
                grouped.set(registryKey, entry);
            }

            if (approval.source.sourceType === 'data-image') {
                const hash = String(approval.source.fnvHash || '').toLowerCase();
                if (hash && !entry.hashes.includes(hash)) {
                    entry.hashes.push(hash);
                }
            } else {
                const filename = String(
                    approval.source.normalizedFilename || approval.source.filename || ''
                ).trim();

                if (filename && !entry.filenames.includes(filename)) {
                    entry.filenames.push(filename);
                }
            }
        }

        const identities = {};

        for (const key of [...grouped.keys()].sort()) {
            const entry = grouped.get(key);
            entry.filenames.sort((a, b) => a.localeCompare(b));
            entry.hashes.sort();
            identities[key] = entry;
        }

        return identities;
    }

    function showSummary() {
        const approvals = Object.values(state.approvals)
            .filter(approval => validateProposal(approval));
        const registryEntries = Object.keys(registryMergeObject()).length;
        const unsubmitted = unsubmittedApprovals().length;

        alert([
            'DALI Local Approval Extension',
            '',
            `Locally approved associations: ${approvals.length}`,
            `Registry identities represented: ${registryEntries}`,
            `Unsubmitted approvals: ${unsubmitted}`,
            '',
            'These approvals are local runtime authority only.',
            'They do not modify DALI\'s canonical remote registry.'
        ].join('\n'));
    }

    function clearApprovals() {
        if (!confirm('Clear every locally approved DALI association from this extension?')) {
            return;
        }

        state = newState();
        saveState();

        alert(
            'Local approvals cleared. Already-registered mappings remain active only until this page is reloaded.'
        );
    }

    function installMenuCommands() {
        GM_registerMenuCommand(
            'Show summary',
            showSummary
        );

        GM_registerMenuCommand(
            'Submit approved associations to GitHub',
            submitApprovedAssociationsToGitHub
        );

        GM_registerMenuCommand(
            'Configure GitHub submission token',
            configureGitHubToken
        );

        GM_registerMenuCommand(
            'Clear local approvals',
            clearApprovals
        );
    }

})();