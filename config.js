/**
 * AI-SlimTrace Configuration
 * 
 * allowedDomains: List of hostnames where the extension UI will be injected.
 * Note: You must also ensure these domains are covered by the "matches" 
 * patterns in manifest.json for the script to load.
 */
const SLIMTRACE_CONFIG = {
    allowedDomains: [
        'localhost',
        '127.0.0.1',
        '0.0.0.0'
    ],
    // Max number of logs to keep in memory
    maxLogs: 20,
    // Whether to pulse the button on error
    pulseOnError: true
};
