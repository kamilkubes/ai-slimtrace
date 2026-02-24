// content.js - SlimTrace logic for cleaning and capturing error logs
console.log('AI-SlimTrace: Content script loaded');

// Inject the script that overrides console methods
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function () {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

const logBuffer = [];
const MAX_LOGS = SLIMTRACE_CONFIG.maxLogs || 20;
let aiSlimTraceShadow = null;

function updateUIState() {
    if (!aiSlimTraceShadow) return;
    const btn = aiSlimTraceShadow.getElementById('ai-slimtrace-trigger');
    if (!btn) return;

    const currentPath = window.location.pathname;
    const normalize = p => (p || '').replace(/\/+$/, '') || '/';
    const normalizedCurrent = normalize(currentPath);

    const hasIssueOnCurrentPage = logBuffer.some(l => {
        if (!l.type || (!l.type.includes('ERROR') && !l.type.includes('WARN'))) return false;
        try {
            const logPath = l.url ? normalize(new URL(l.url).pathname) : '';
            return logPath === normalizedCurrent;
        } catch (e) {
            return l.url && l.url.includes(currentPath);
        }
    });

    if (hasIssueOnCurrentPage) {
        btn.classList.add('has-error');
        btn.innerText = 'AI!';
        btn.title = `🚨 Issues (Errors/Warnings) detected on ${currentPath}! Click to copy trace.`;
    } else {
        btn.classList.remove('has-error');
        btn.innerText = 'AI';
        btn.title = 'AI-SlimTrace: Monitoring...';
    }
}

// When navigation is detected, just refresh the UI state (don't clear buffer)
window.addEventListener('AI_SLIMTRACE_RESET', updateUIState);

// Listen for logs from the injected script
window.addEventListener('AI_SLIMTRACE_LOG', (event) => {
    let logData = event.detail;

    // Only process WARN and ERROR types
    if (!['WARN', 'ERROR', 'UNHANDLED_ERROR'].includes(logData.type)) return;

    if (logData.type === 'UNHANDLED_ERROR' && logData.content.stack) {
        logData.content.stack = cleanStackTrace(logData.content.stack);
    } else if (typeof logData.content === 'string') {
        logData.content = cleanStackTrace(logData.content);
    }

    logBuffer.push(logData);
    if (logBuffer.length > MAX_LOGS) {
        logBuffer.shift();
    }

    // Visual cue: trigger UI update
    updateUIState();
});

function cleanStackTrace(stack) {
    if (typeof stack !== 'string') return stack;

    // Normalize newlines and split
    let lines = stack.replace(/\\n/g, '\n').split('\n');

    let processedLines = lines
        .map(line => line.trim())
        .filter(line => {
            if (!line) return false;
            // Filter out dependencies and system noise
            if (line.includes('node_modules') || line.includes('.vite/deps') || line.includes('chrome-extension://')) return false;
            // Filter out common React/HTML wrappers that don't help identify the logic
            if (line.match(/^at (div|span|p|a|li|ul|ol|h[1-6]|button|input|section|header|footer|nav|main|article|aside|select|option|br|strong|em)\b/)) return false;
            // Filter React console artifacts
            if (line.match(/^%[os]$|^%s %s$|^%o\s*%s\s*%s$/)) return false;
            return true;
        })
        .map(line => {
            // Shorten localhost URLs and remove cache-busting timestamps
            return line
                .replace(/https?:\/\/localhost:\d+\/src\//g, '') // Remove localhost prefix
                .replace(/\?t=\d+/g, '')                        // Remove Vite timestamp
                .replace(/^(at\s+)+/, '')                       // Remove leading 'at '
                .trim();
        });

    // Deduplicate consecutive lines
    processedLines = processedLines.filter((line, index, self) => index === 0 || line !== self[index - 1]);

    // Limit depth to keep it token-friendly
    if (processedLines.length > 10) {
        processedLines = processedLines.slice(0, 8).concat(['...']);
    }

    return processedLines.join('\n');
}

function createUI() {
    const container = document.createElement('div');
    container.id = 'ai-slimtrace-root';
    document.body.appendChild(container);

    aiSlimTraceShadow = container.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
    .slimtrace-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 44px;
      height: 44px;
      background: #007bff;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 2147483647;
      font-family: sans-serif;
      font-weight: bold;
      transition: all 0.3s ease;
      user-select: none;
      border: 2px solid white;
      opacity: 0.9;
    }
    .slimtrace-btn:hover {
      transform: scale(1.1);
      background: #0056b3;
    }
    .slimtrace-btn.has-error {
      background: #dc3545;
      box-shadow: 0 0 15px rgba(220, 53, 69, 0.5);
      animation: ${SLIMTRACE_CONFIG.pulseOnError ? 'pulse 2s infinite' : 'none'};
    }
    @keyframes pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
  `;
    aiSlimTraceShadow.appendChild(style);

    const btn = document.createElement('div');
    btn.id = 'ai-slimtrace-trigger';
    btn.className = 'slimtrace-btn';
    btn.innerText = 'AI';
    btn.title = 'Copy Token-Efficient Trace';

    btn.onclick = () => {
        const payload = generatePayload();
        navigator.clipboard.writeText(payload).then(() => {
            const originalText = btn.innerText;
            btn.innerText = '✅';
            const originalBg = btn.style.backgroundColor;
            btn.style.backgroundColor = '#28a745';

            setTimeout(() => {
                updateUIState();
                btn.style.backgroundColor = '';
            }, 2000);
        });
    };

    aiSlimTraceShadow.appendChild(btn);
    updateUIState(); // Initial check
}

function generatePayload() {
    if (logBuffer.length === 0) return 'OK';

    let out = `Log @ ${window.location.host}${window.location.pathname}`;
    let lastLogPath = '';

    logBuffer.slice(-15).forEach(log => {
        const isErr = log.type.includes('ERROR');
        const pfx = isErr ? 'E:' : 'W:';
        let logPath = '[Global]';
        try {
            logPath = new URL(log.url).pathname;
        } catch (e) { }

        if (logPath !== lastLogPath) {
            out += `\n@ ${logPath}\n`;
            lastLogPath = logPath;
        }

        let msg = '';
        if (log.type === 'UNHANDLED_ERROR' && typeof log.content === 'object' && log.content !== null) {
            const message = log.content.message || '';
            const stack = log.content.stack || '';
            // Avoid duplicating message if it's already the first line of the stack
            if (stack && stack.includes(message)) {
                msg = stack;
            } else {
                msg = message + (stack ? `\n${stack}` : '');
            }
        } else {
            msg = typeof log.content === 'string' ? log.content : JSON.stringify(log.content);
        }

        // Get and shorten source location
        let sourceStr = log.source || '';
        if (!sourceStr && log.type === 'UNHANDLED_ERROR' && log.content) {
            sourceStr = `${log.content.source || ''}:${log.content.lineno || ''}`;
        }
        const loc = sourceStr ? ` (${sourceStr.replace(/https?:\/\/localhost:\d+\/src\//g, '').replace(/\?t=\d+/g, '').replace(/^(\/|src\/)/, '')})` : '';

        // Format neatly
        msg = msg.trim();
        if (msg.includes('\n')) {
            out += `${pfx}${loc}\n${msg}\n`;
        } else {
            out += `${pfx}${loc} ${msg}\n`;
        }
    });

    return out.trim();
}

// Initialize UI if current domain is allowed in config
if (SLIMTRACE_CONFIG.allowedDomains.includes(window.location.hostname)) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
}
