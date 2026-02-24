// inject.js - Runs in the page context to intercept console and errors
(function () {
    const originalWarn = console.warn;
    const originalError = console.error;
    const ringBuffer = [];
    const MAX_BUFFER_SIZE = 20;

    function addToBuffer(type, data, source = '') {
        const entry = {
            type,
            timestamp: new Date().toISOString(),
            content: data,
            url: window.location.href,
            source: source // Added source/line parameter
        };
        ringBuffer.push(entry);
        if (ringBuffer.length > MAX_BUFFER_SIZE) {
            ringBuffer.shift();
        }

        // Send to content script via CustomEvent
        window.dispatchEvent(new CustomEvent('AI_SLIMTRACE_LOG', { detail: entry }));
    }

    function safeStringify(obj) {
        try {
            if (obj instanceof Error) {
                return obj.stack || obj.message;
            }
            if (obj && typeof obj === 'object' && obj.componentStack) {
                return `\nComponent Stack:\n${obj.componentStack}`;
            }
            return JSON.stringify(obj);
        } catch (e) {
            return String(obj);
        }
    }

    function getCallerInfo() {
        try {
            throw new Error();
        } catch (e) {
            if (e.stack) {
                const lines = e.stack.split('\n');
                for (let i = 1; i < lines.length; i++) {
                    if (!lines[i].includes('inject.js') &&
                        !lines[i].includes('chrome-extension://') &&
                        !lines[i].includes('node_modules') &&
                        !lines[i].includes('.vite/deps')) {
                        return lines[i].replace(/^\s*at\s+/, '').trim();
                    }
                }
            }
        }
        return '';
    }

    console.warn = (...args) => {
        addToBuffer('WARN', args.map(a => typeof a === 'object' ? safeStringify(a) : String(a)).join(' '), getCallerInfo());
        originalWarn.apply(console, args);
    };

    console.error = (...args) => {
        addToBuffer('ERROR', args.map(a => typeof a === 'object' ? safeStringify(a) : String(a)).join(' '), getCallerInfo());
        originalError.apply(console, args);
    };

    window.onerror = function (message, source, lineno, colno, error) {
        addToBuffer('UNHANDLED_ERROR', {
            message,
            source,
            lineno,
            colno,
            stack: error ? error.stack : null
        }, `${source}:${lineno}`);
    };

    // SPA Navigation Detection (must be in page context to catch React Router etc.)
    let currentPath = window.location.pathname;
    function notifyNavigation() {
        if (window.location.pathname !== currentPath) {
            currentPath = window.location.pathname;
            window.dispatchEvent(new CustomEvent('AI_SLIMTRACE_RESET'));
        }
    }

    window.addEventListener('popstate', notifyNavigation);

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        notifyNavigation();
    };

    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        notifyNavigation();
    };

    console.log('AI-SlimTrace: Interceptor active');
})();
