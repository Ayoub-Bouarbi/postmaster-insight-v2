const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const multer = require('multer');
const path = require('path');
const moment = require('moment');
const { PostmasterToolsClient } = require('./postmaster-api');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Multer setup for in-memory file storage
const upload = multer({ storage: multer.memoryStorage() });

// --- Middleware Setup ---
app.set('view engine', 'ejs');
// Trust proxy so secure cookies work correctly behind Vercel/HTTPS
app.set('trust proxy', 1);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- UPDATED SESSION CONFIGURATION ---
app.use(session({
    name: 'pm.sid',
    secret: process.env.SESSION_SECRET || 'a-very-secret-and-random-string-for-nodejs',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    // ADD THE STORE CONFIGURATION:
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI, // You must set this environment variable in Vercel
        ttl: 14 * 24 * 60 * 60, // Session will live for 14 days
        autoRemove: 'interval',
        autoRemoveInterval: 10, // In minutes. Will clean up expired sessions.
    }),
    cookie: {
        httpOnly: true,
        secure: IS_PROD, // true on Vercel/HTTPS
        sameSite: 'lax', 
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// In-memory cache
const apiCache = new Map();
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// --- Helper Functions ---
function getOauth2Client(req) {
    if (!req.session.client_secret_json) return null;
    const clientConfig = JSON.parse(req.session.client_secret_json);
    const { client_secret, client_id, redirect_uris } = clientConfig.web;
    const redirect_uri = redirect_uris.find(uri => uri.includes('localhost') || uri.includes(req.get('host')));
    return new google.auth.OAuth2(client_id, client_secret, redirect_uri);
}

// --- [FIX] ---: Updated Authentication Middleware to prevent token refresh race conditions
const loginRequired = (req, res, next) => {
    if (!req.session.tokens) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: "Authentication required" });
        return res.redirect('/login');
    }

    const oauth2Client = getOauth2Client(req);
    if (!oauth2Client) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: "Client secret not configured in session" });
        return res.redirect('/login');
    }
    
    oauth2Client.setCredentials(req.session.tokens);
    
    // If token is not expiring, proceed immediately.
    if (!oauth2Client.isTokenExpiring()) {
        res.locals.client = oauth2Client;
        return next();
    }

    // If token is expiring, handle refresh carefully.
    // Check if another request for this session is already refreshing the token.
    if (req.session.isRefreshing) {
        // If so, wait for the refresh to complete by polling the session flag.
        const waitForRefresh = () => {
            if (!req.session.isRefreshing) {
                // The other request finished. Re-run the middleware with the new token.
                return loginRequired(req, res, next);
            }
            setTimeout(waitForRefresh, 300); // Check again in 300ms
        };
        return waitForRefresh();
    }

    // This is the first request to see the expired token. It will handle the refresh.
    console.log("Token is expiring. Refreshing now.");
    req.session.isRefreshing = true;

    oauth2Client.refreshAccessToken((err, tokens) => {
        // Mark refreshing as complete for all waiting requests.
        req.session.isRefreshing = false;

        if (err) {
            console.error("Failed to refresh access token:", err);
            // On failure, destroy the session and force re-login.
            return req.session.destroy(() => {
                if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session expired' });
                res.redirect('/login');
            });
        }
        
        console.log("Token refreshed successfully.");
        // Update the session with the new tokens.
        req.session.tokens = tokens;
        
        // Save the session to ensure the new token is stored before proceeding.
        req.session.save(saveErr => {
            if (saveErr) {
                console.error("Failed to save session after token refresh:", saveErr);
                if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Failed to save session' });
                return res.redirect('/login');
            }
            // Attach the updated client to the request and continue.
            oauth2Client.setCredentials(tokens);
            res.locals.client = oauth2Client;
            next();
        });
    });
};


// --- HTML Page Routes ---
app.get('/', (req, res) => {
    if (req.session.tokens) {
        return res.redirect('/custom');
    }
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    let project_id = null;
    let flash_message = req.session.flash_message;
    req.session.flash_message = null; // Clear flash message

    if (req.session.client_secret_json) {
        try {
            project_id = JSON.parse(req.session.client_secret_json).web.project_id;
        } catch (e) { /* ignore parse error */ }
    }
    res.render('login', { client_project_id: project_id, current_year: new Date().getFullYear(), flash: flash_message });
});

app.post('/login', upload.single('client_secret_file'), (req, res) => {
    if (!req.file) {
        req.session.flash_message = { type: 'error', message: 'No file was uploaded.' };
        return res.redirect('/login');
    }

    try {
        const clientSecretString = req.file.buffer.toString('utf8');
        const secretJson = JSON.parse(clientSecretString);

        if (!secretJson.web || !secretJson.web.client_id) {
            throw new Error("Invalid client_secret.json structure.");
        }
        
        req.session.client_secret_json = clientSecretString;
        req.session.flash_message = { type: 'success', message: 'API Credentials file uploaded successfully.' };
    } catch (error) {
        console.error("Error processing credentials file:", error.message);
        req.session.flash_message = { type: 'error', message: 'Error processing credentials file. Please check the format.' };
    }
    
    res.redirect('/login');
});


app.get('/auth', (req, res) => {
    const oauth2Client = getOauth2Client(req);
    if (!oauth2Client) {
        req.session.flash_message = { type: 'error', message: 'Please upload your credentials file before signing in.' };
        return res.redirect('/login');
    }
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/postmaster.readonly'],
        prompt: 'consent'
    });
    res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    const oauth2Client = getOauth2Client(req);
    try {
        const { tokens } = await oauth2Client.getToken(code);
        req.session.tokens = tokens;
        res.redirect('/custom');
    } catch (err) {
        console.error('Error fetching token', err);
        req.session.flash_message = { type: 'error', message: 'An error occurred during authentication.' };
        res.redirect('/login');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

app.get('/domain', loginRequired, (req, res) => {
    res.render('single_domain', { current_year: new Date().getFullYear() });
});

app.get('/custom', loginRequired, (req, res) => {
    res.render('custom_list', {
        session_domains: req.session.custom_domains || [],
        current_year: new Date().getFullYear()
    });
});

app.post('/custom', loginRequired, (req, res) => {
    const rawDomains = req.body.domains || '';
    const domainSet = new Set(rawDomains.split(/[\s,;]+/).map(d => d.trim()).filter(Boolean));
    req.session.custom_domains = Array.from(domainSet).sort();
    res.redirect('/custom');
});

app.get('/custom/clear', loginRequired, (req, res) => {
    req.session.custom_domains = [];
    res.redirect('/custom');
});

// --- API Endpoints ---
app.get('/api/domains', loginRequired, async (req, res) => {
    const pmClient = new PostmasterToolsClient(res.locals.client);
    
    if (req.session.custom_domains && req.session.custom_domains.length > 0) {
        return res.json(req.session.custom_domains);
    }

    try {
        const domains = await pmClient.listVerifiedDomains();
        res.json(domains.map(d => d.replace('domains/', '')).sort());
    } catch (error) {
        console.error("API Error fetching domains:", error);
        res.status(500).json({ error: "Failed to fetch domains from API." });
    }
});

app.get('/api/stat/:domain', loginRequired, async (req, res) => {
    const { domain } = req.params;
    const pmClient = new PostmasterToolsClient(res.locals.client);
    try {
        const stats = await pmClient.findNearestAvailableStat(domain);
        if (stats) {
            res.json(pmClient.extractMetrics(stats));
        } else {
            res.status(404).json({ status: 'No data available' });
        }
    } catch (error) {
        console.error(`API Error fetching stat for ${domain}:`, error);
        res.status(500).json({ error: "Failed to fetch domain stat." });
    }
});

app.get('/api/historical_stats/:domain', loginRequired, async (req, res) => {
    const { domain } = req.params;
    const { start_date, end_date } = req.query;
    const pmClient = new PostmasterToolsClient(res.locals.client);
    
    try {
        const chartData = await pmClient.getHistoricalStats(domain, start_date, end_date);
        res.json(chartData);
    } catch (error) {
        console.error(`API Error fetching historical stats for ${domain}:`, error);
        res.status(500).json({ error: "Failed to fetch historical stats." });
    }
});

app.get('/api/custom_domain_data/:domain_name', loginRequired, async (req, res) => {
    const { domain_name } = req.params;
    const { start_date, end_date } = req.query;
    const cacheKey = `${domain_name}-${start_date}-${end_date}`;

    if (apiCache.has(cacheKey) && (Date.now() - apiCache.get(cacheKey).timestamp < CACHE_DURATION_MS)) {
        return res.json(apiCache.get(cacheKey).data);
    }

    const pmClient = new PostmasterToolsClient(res.locals.client);
    try {
        const domainData = await pmClient.processSingleDomainStats(domain_name, start_date, end_date);
        apiCache.set(cacheKey, { data: domainData, timestamp: Date.now() });
        res.json(domainData);
    } catch (error) {
        console.error(`API Error fetching custom data for ${domain_name}:`, error);
        res.status(500).json({ error: "Failed to fetch custom domain data." });
    }
});


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

