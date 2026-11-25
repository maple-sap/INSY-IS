const express = require('express');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic hardening headers (the app is same-origin, so CORS is intentionally not enabled)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // unpkg/cdnjs host the two CDN scripts the page loads (lucide, qrcodejs); 'unsafe-inline' is
    // needed because the UI uses inline onclick="" handlers and inline style="" throughout.
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdnjs.cloudflare.com; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https://via.placeholder.com; " +
        "font-src 'self'; " +
        "connect-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "frame-ancestors 'none'"
    );
    // Only sent once the site is actually served over HTTPS, otherwise browsers would remember
    // this for a plain-HTTP localhost and make local development awkward.
    if (process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// VULN-08 fix: when this app sits behind a reverse proxy (Cloudflare Quick Tunnel, Nginx, a load
// balancer), req.ip is the proxy's own address unless Express is told to trust the proxy's
// X-Forwarded-For header. Without this, every visitor behind the same tunnel shares one rate-limit
// bucket (a false DoS), or a spoofed header could bypass limits entirely if trust were assumed blindly.
// TRUST_PROXY defaults to false: only turn it on when a proxy you control sits in front of this server.
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

// Checks the file's actual bytes, not the mimetype header the browser claims (which anyone can fake)
function fileStartsWith(filePath, signatures) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(12);
        fs.readSync(fd, buf, 0, 12, 0);
        return signatures.some(sig => buf.slice(0, sig.length).equals(Buffer.from(sig)));
    } finally {
        fs.closeSync(fd);
    }
}

const PDF_SIGNATURE = [[0x25, 0x50, 0x44, 0x46]]; // %PDF
const IMAGE_SIGNATURES = [
    [0xFF, 0xD8, 0xFF],                               // JPEG
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],  // PNG
    [0x47, 0x49, 0x46, 0x38],                          // GIF
    [0x52, 0x49, 0x46, 0x46]                           // WEBP (RIFF container)
];

// Deletes the upload and fails the request if its real content doesn't match what it claims to be
function verifyUploadContent(signatures, label) {
    return (req, res, next) => {
        if (!req.file) return next();
        if (fileStartsWith(req.file.path, signatures)) return next();

        fs.unlink(req.file.path, () => { });
        res.status(400).json({ error: `That file is not a valid ${label}.` });
    };
}

// All uploaded files (proposal PDFs, profile photos, compliance photos) live in ./uploads
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Image types accepted for profile and compliance photos (SVG is excluded on purpose: it can carry scripts)
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Configure Multer storage: timestamp prefix + sanitized original name
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
        // Random part keeps several files uploaded in the same millisecond with the same name from overwriting each other
        cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-' + safeName.slice(-100));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

const avatarUpload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed for profile photos!'), false);
        }
    }
});

// Most cleanliness photos a student can attach to one compliance submission (must match script.js)
const MAX_COMPLIANCE_PHOTOS = 10;

const complianceUpload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed for cleanliness proof!'), false);
        }
    }
});

// Configure SMTP Transporter for Recovery Codes
const mailTransporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.MAIL_PORT || 587),
    secure: process.env.MAIL_SECURE === 'true',
    auth: process.env.MAIL_USER && process.env.MAIL_PASS ? {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS.replace(/\s+/g, '')
    } : undefined
});

const recoveryCodes = new Map();

// 1. Serve frontend static assets from ../Frontend (index.html, script.js, style.css, assets/)
const frontendDir = path.resolve(__dirname, '..', 'Frontend');
app.use(express.static(frontendDir, { dotfiles: 'allow' }));

// Uploaded files (proposal PDFs, profile photos, compliance photos) are NOT served as static files -
// see the protected GET /uploads/:filename route below, which requires a valid login.

// Builds the public URL for a stored upload filename
function uploadUrl(name) {
    if (!name) return null;
    if (name.startsWith('http') || name.startsWith('/')) return name;
    return `/uploads/${encodeURIComponent(name)}`;
}

// 2. Explicit root route fallback to Frontend/index.html
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: frontendDir, dotfiles: 'allow' });
});

// MySQL Database Connection Pool
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'suave_db',
    // Return DATE columns as plain 'YYYY-MM-DD' text. Otherwise they become JS Date objects at local
    // midnight, and JSON converts them to UTC, which shifts the day back by one (e.g. Sept 11 -> Sept 10).
    dateStrings: ['DATE']
});

// Self-healing schema check: makes an older suave_db match what this server expects.
// Runs on every start-up and only changes things that are actually out of date.
async function ensureSchema() {
    const dbName = process.env.DB_NAME || 'suave_db';

    const getColumn = async (table, column) => {
        const [rows] = await db.query(
            `SELECT COLUMN_TYPE AS column_type, DATA_TYPE AS data_type
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [dbName, table, column]
        );
        return rows[0] || null;
    };

    const addIfMissing = async (table, column, definition) => {
        if (!(await getColumn(table, column))) {
            await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
            console.log(`[DB] Added ${table}.${column}`);
        }
    };

    // users.role must accept 'osas'
    const role = await getColumn('users', 'role');
    if (role && !role.column_type.includes("'osas'")) {
        await db.query("ALTER TABLE users MODIFY COLUMN role ENUM('student','adviser','admin','osas') NOT NULL DEFAULT 'student'");
        console.log("[DB] users.role now accepts 'osas'");
    }

    // bookings.status must accept the two-step approval statuses (old ENUM silently stored blanks)
    const status = await getColumn('bookings', 'status');
    if (status && status.data_type !== 'varchar') {
        await db.query("ALTER TABLE bookings MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'Under Review - OSAS'");
        console.log('[DB] bookings.status converted to VARCHAR(50)');
    }
    const [fixed] = await db.query(
        "UPDATE bookings SET status = 'Under Review - OSAS' WHERE status IS NULL OR status = '' OR status = 'Under Review'"
    );
    if (fixed.affectedRows > 0) {
        console.log(`[DB] Reset ${fixed.affectedRows} proposal(s) with a blank/legacy status to 'Under Review - OSAS'`);
    }

    // Columns used by proposals and post-event compliance
    await addIfMissing('bookings', 'start_time', 'TIME NULL');
    await addIfMissing('bookings', 'end_time', 'TIME NULL');
    await addIfMissing('bookings', 'rejection_reason', 'TEXT NULL');
    await addIfMissing('bookings', 'resources_needed', 'TEXT NULL');
    await addIfMissing('bookings', 'proposal_file', 'VARCHAR(255) NULL');
    await addIfMissing('bookings', 'cleanliness_proof', 'VARCHAR(255) NULL');
    await addIfMissing('bookings', 'cleanliness_photos', 'TEXT NULL'); // JSON list of up to 10 photo filenames (cleanliness_proof keeps the first one)
    await addIfMissing('bookings', 'resources_returned', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addIfMissing('bookings', 'compliance_submitted_at', 'DATETIME NULL');
    await addIfMissing('bookings', 'equipment_checklist', 'TEXT NULL');
    await addIfMissing('bookings', 'compliance_remarks', 'TEXT NULL');
    await addIfMissing('bookings', 'compliance_verified_by', 'INT NULL');
    await addIfMissing('bookings', 'compliance_verified_at', 'DATETIME NULL');
    await addIfMissing('bookings', 'compliance_rejection_reason', 'TEXT NULL');
    await addIfMissing('bookings', 'compliance_status', "VARCHAR(20) NOT NULL DEFAULT 'Pending'");

    // An older migration created compliance_status as ENUM('N/A','Pending','Complied'); the app writes 'Submitted'
    const compliance = await getColumn('bookings', 'compliance_status');
    if (compliance && compliance.data_type !== 'varchar') {
        await db.query("ALTER TABLE bookings MODIFY COLUMN compliance_status VARCHAR(20) NOT NULL DEFAULT 'Pending'");
        await db.query("UPDATE bookings SET compliance_status = 'Pending' WHERE compliance_status IN ('N/A', '')");
        console.log('[DB] bookings.compliance_status converted to VARCHAR(20)');
    }

    // Login sessions: bumping this invalidates every token already issued for the user (e.g. on password reset)
    await addIfMissing('users', 'token_version', 'INT NOT NULL DEFAULT 0');

    // Email verification: existing accounts are grandfathered in as already verified so this does not lock anyone out
    const hadEmailVerified = await getColumn('users', 'email_verified_at');
    await addIfMissing('users', 'email_verified_at', 'DATETIME NULL');
    await addIfMissing('users', 'email_verify_hash', 'VARCHAR(64) NULL');
    await addIfMissing('users', 'email_verify_expires', 'DATETIME NULL');
    if (!hadEmailVerified) {
        await db.query('UPDATE users SET email_verified_at = COALESCE(created_at, NOW()) WHERE email_verified_at IS NULL');
        console.log('[DB] Existing accounts marked as already verified (one-time migration).');
    }

    // Survey responses (one row per user; scores are computed on the server)
    await db.query(`
        CREATE TABLE IF NOT EXISTS survey_responses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            sus_answers TEXT NOT NULL,
            fs_answers TEXT NOT NULL,
            sus_score DECIMAL(5,1) NOT NULL,
            functional_score DECIMAL(5,1) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
}

// Moves files that older versions saved next to server.js into ./uploads (only files the database references)
async function migrateLegacyUploads() {
    const [rows] = await db.query(`
        SELECT proposal_file AS f FROM bookings WHERE proposal_file IS NOT NULL AND proposal_file <> ''
        UNION SELECT cleanliness_proof FROM bookings WHERE cleanliness_proof IS NOT NULL AND cleanliness_proof <> ''
        UNION SELECT avatar_url FROM users WHERE avatar_url IS NOT NULL AND avatar_url <> ''
    `);

    let moved = 0;
    for (const { f } of rows) {
        // Only plain "<timestamp>-name" files; never URLs, paths or source files
        if (!/^\d{10,}-/.test(f) || f.includes('/') || f.includes('\\') || f.includes('..')) continue;

        const from = path.join(__dirname, f);
        const to = path.join(uploadsDir, f);
        if (fs.existsSync(from) && !fs.existsSync(to)) {
            await fs.promises.rename(from, to);
            moved++;
        }
    }
    if (moved > 0) {
        console.log(`[Uploads] Moved ${moved} existing file(s) into /uploads`);
    }
}

// ===== Authentication: signed session cookie (HttpOnly, SameSite=Strict) =====
const SESSION_COOKIE = 'suave_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
if (!process.env.JWT_SECRET) {
    console.warn('[Auth] JWT_SECRET is not set in .env - everyone is logged out whenever the server restarts.');
}
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

const OSAS_ROLES = ['admin', 'osas'];   // stage 1 reviewers ("OSAS")
const FINAL_ROLES = ['adviser'];        // stage 2 final approvers ("Admin")
const STAFF_ROLES = [...OSAS_ROLES, ...FINAL_ROLES];

// HS256 token: header.payload.signature, signed with JWT_SECRET
function signToken(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
        ...payload,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
    const given = Buffer.from(parts[2], 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

function readCookie(req, name) {
    for (const part of (req.headers.cookie || '').split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() === name) {
            try {
                return decodeURIComponent(part.slice(idx + 1).trim());
            } catch (e) {
                return null;
            }
        }
    }
    return null;
}

const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/' };

function startSession(res, user) {
    res.cookie(SESSION_COOKIE, signToken({ sub: user.id, tv: user.token_version || 0 }), { ...COOKIE_OPTIONS, maxAge: SESSION_TTL_SECONDS * 1000 });
}

// Reads the session cookie and returns the matching user, or null. Checks token_version so a
// token issued before a password reset is rejected even though it has not expired yet.
async function getSessionUser(req) {
    const payload = verifyToken(readCookie(req, SESSION_COOKIE));
    if (!payload || !payload.sub) return null;

    try {
        const [rows] = await db.query(
            'SELECT id, email, display_name, role, avatar_url, token_version FROM users WHERE id = ?',
            [payload.sub]
        );
        const user = rows[0];
        if (!user) return null;
        if ((payload.tv || 0) !== (user.token_version || 0)) return null; // invalidated by a password reset
        return user;
    } catch (err) {
        console.error('Session lookup failed:', err.message);
        return null;
    }
}

function publicUser(user) {
    return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        avatar: uploadUrl(user.avatar_url) || 'https://via.placeholder.com/80'
    };
}

// Which status changes each role may make, based on the proposal's CURRENT stage
function canChangeStatus(currentStatus, newStatus, role) {
    const stage = (!currentStatus || currentStatus === 'Under Review' || currentStatus === 'Pending')
        ? 'Under Review - OSAS'
        : currentStatus;

    if (stage === 'Under Review - OSAS') {
        return OSAS_ROLES.includes(role) && ['Under Review - Adviser', 'Rejected'].includes(newStatus);
    }
    if (stage === 'Under Review - Adviser') {
        return FINAL_ROLES.includes(role) && ['Approved', 'Rejected'].includes(newStatus);
    }
    return false; // Approved / Rejected proposals are final
}

// Login brute-force protection: 5 failures per email+IP, then a 15 minute lockout
const loginAttempts = new Map();
const MAX_LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginKey = (req, email) => `${req.ip}|${email}`;

function isLoginLocked(key) {
    const rec = loginAttempts.get(key);
    if (!rec) return false;
    if (Date.now() - rec.first > LOGIN_WINDOW_MS) {
        loginAttempts.delete(key);
        return false;
    }
    return rec.count >= MAX_LOGIN_FAILURES;
}

function recordLoginFailure(key) {
    const rec = loginAttempts.get(key);
    if (!rec || Date.now() - rec.first > LOGIN_WINDOW_MS) {
        loginAttempts.set(key, { count: 1, first: Date.now() });
    } else {
        rec.count++;
    }
}

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// ---- Password recovery protection ----
const RESET_CODE_TTL_MS = 10 * 60 * 1000;      // a code works for 10 minutes
const MAX_RESET_ATTEMPTS = 5;                   // wrong guesses before the code is destroyed
const RESET_RESEND_COOLDOWN_MS = 60 * 1000;     // minimum gap between codes for the same email

// Generic "N attempts per window" limiter, keyed by anything (IP, email...)
function createRateLimiter(max, windowMs) {
    const hits = new Map();
    return {
        // Counts one attempt. Returns 0 if allowed, otherwise the seconds to wait.
        hit(key) {
            const now = Date.now();
            const rec = hits.get(key);
            if (!rec || now - rec.first > windowMs) {
                hits.set(key, { count: 1, first: now });
                return 0;
            }
            rec.count++;
            return rec.count > max ? Math.ceil((rec.first + windowMs - now) / 1000) : 0;
        },
        sweep() {
            const now = Date.now();
            for (const [key, rec] of hits) {
                if (now - rec.first > windowMs) hits.delete(key);
            }
        }
    };
}

const forgotByEmail = createRateLimiter(3, 15 * 60 * 1000);   // 3 code requests per email / 15 min
const forgotByIp = createRateLimiter(10, 60 * 60 * 1000);     // 10 code requests per IP / hour
const resetByIp = createRateLimiter(20, 15 * 60 * 1000);      // 20 reset attempts per IP / 15 min
const apiByIp = createRateLimiter(300, 15 * 60 * 1000);       // 300 API calls per IP / 15 min (generous; stops scripted abuse)
const writeByIp = createRateLimiter(60, 15 * 60 * 1000);      // 60 write actions (POST/PUT/DELETE) per IP / 15 min
const staffCodeByIp = createRateLimiter(5, 15 * 60 * 1000);   // 5 staff/org access-code guesses per IP / 15 min

// Codes are stored as keyed hashes, never as plain text
function hashRecoveryCode(email, code) {
    return crypto.createHmac('sha256', JWT_SECRET).update(`${email}:${code}`).digest();
}

// Checks a recovery code. Every wrong guess is counted BEFORE comparing; after
// MAX_RESET_ATTEMPTS wrong guesses the code is destroyed and a new one must be requested.
function checkRecoveryCode(email, code) {
    const record = recoveryCodes.get(email);
    if (!record || Date.now() > record.expiresAt) {
        recoveryCodes.delete(email);
        return { ok: false, reason: 'invalid' };
    }

    record.attempts++;
    if (crypto.timingSafeEqual(hashRecoveryCode(email, String(code)), record.hash)) {
        recoveryCodes.delete(email); // single use
        return { ok: true };
    }

    if (record.attempts >= MAX_RESET_ATTEMPTS) {
        recoveryCodes.delete(email);
        return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'wrong', remaining: MAX_RESET_ATTEMPTS - record.attempts };
}
// ===== end of pure auth helpers =====

// Housekeeping: forget expired codes and old rate-limit entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [email, rec] of recoveryCodes) {
        if (now > rec.expiresAt) recoveryCodes.delete(email);
    }
    forgotByEmail.sweep();
    forgotByIp.sweep();
    resetByIp.sweep();
    apiByIp.sweep();
    writeByIp.sweep();
    staffCodeByIp.sweep();
}, 10 * 60 * 1000).unref();

// Rate limiting for the whole API: a generous cap on all calls, a tighter one on writes
app.use('/api', (req, res, next) => {
    const generalWait = apiByIp.hit(req.ip);
    if (generalWait > 0) {
        return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
    }
    if (req.method !== 'GET') {
        const writeWait = writeByIp.hit(`write:${req.ip}`);
        if (writeWait > 0) {
            return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
        }
    }
    next();
});

// Loads the logged-in user (if any) from the session cookie for every /api request
app.use('/api', async (req, res, next) => {
    req.user = await getSessionUser(req);
    next();
});

function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Please log in to continue.' });
    }
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Please log in to continue.' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'You do not have permission to do that.' });
        }
        next();
    };
}

// Uploaded files require a login (these links are often opened directly or used as <img src>,
// so a failed check shows a small HTML page instead of a JSON error).
function sendLoginRequiredPage(res) {
    res.status(401).type('html').send(
        '<!doctype html><html><head><meta charset="utf-8"><title>Login required</title></head>' +
        '<body style="font-family: sans-serif; text-align: center; padding: 60px 20px;">' +
        '<h2>Please log in to view this file</h2><p><a href="/">Go to S.U.A.V.E.</a></p></body></html>'
    );
}

app.get('/uploads/:filename', async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) {
        return sendLoginRequiredPage(res);
    }

    // path.basename strips any directory segments, which blocks "../" path traversal
    const filename = path.basename(req.params.filename);
    const filePath = path.join(uploadsDir, filename);

    if (!filePath.startsWith(uploadsDir + path.sep) || !fs.existsSync(filePath)) {
        return res.status(404).send('File not found.');
    }

    // Being logged in is not, by itself, a reason to see every file: a proposal PDF or compliance
    // photo for someone else's unapproved/rejected event is private to its owner and to staff.
    // Profile avatars are not booking-specific, so they fall through and stay visible to any
    // logged-in user (consistent with avatars being shown throughout the shared UI).
    if (!STAFF_ROLES.includes(user.role)) {
        try {
            const [bookings] = await db.query(
                'SELECT user_id, status FROM bookings WHERE proposal_file = ? OR cleanliness_proof = ? OR LOCATE(?, cleanliness_photos) > 0 LIMIT 1',
                [filename, filename, `"${filename}"`]
            );
            const booking = bookings[0];
            if (booking && booking.user_id !== user.id && booking.status !== 'Approved') {
                return res.status(403).send('Access denied.');
            }
        } catch (err) {
            console.error('Upload ownership check failed:', err.message);
            return res.status(500).send('Could not verify access to this file.');
        }
    }

    // Browsers render PDFs inline by default; a PDF can carry embedded actions/JavaScript, so
    // uploaded proposal documents are forced to download rather than render in the page's origin.
    if (filename.toLowerCase().endsWith('.pdf')) {
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filename, { root: uploadsDir, dotfiles: 'allow' });
});

// Who am I? (used by the front-end to confirm a saved session is still valid)
app.get('/api/me', requireAuth, (req, res) => {
    res.json({ success: true, user: publicUser(req.user) });
});

app.post('/api/logout', async (req, res) => {
    // The JWT itself is stateless and would stay valid until it expires even after the cookie is
    // cleared (e.g. if it was copied out of the browser). Bumping token_version invalidates it
    // immediately, the same mechanism already used to revoke sessions on a password reset.
    const payload = verifyToken(readCookie(req, SESSION_COOKIE));
    if (payload && payload.sub) {
        try {
            await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [payload.sub]);
        } catch (err) {
            console.error('Logout revocation error:', err.message);
        }
    }
    res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
    res.json({ success: true });
});

// 3. Get event proposals/bookings
//    Guests (not logged in) only receive approved events and only the public calendar fields.
app.get('/api/proposals', async (req, res) => {
    try {
        if (!req.user) {
            const [publicRows] = await db.query(`
                SELECT id, title, description, organization_name, event_date, start_time, end_time,
                       venue, status, google_form_url, max_participants, current_registered, resources_needed
                FROM bookings
                WHERE status = 'Approved'
                ORDER BY event_date ASC
            `);
            return res.json(publicRows);
        }

        // Staff (OSAS/Admin) need to review every booking, including ones still under review or
        // rejected. A student should only see events that are public (Approved) or their own -
        // otherwise every logged-in student could read every other org's pending/rejected
        // proposals, rejection reasons, compliance remarks and uploaded filenames.
        const isStaff = STAFF_ROLES.includes(req.user.role);
        const baseQuery = `
            SELECT b.*, u.display_name AS submitted_by, v.display_name AS verified_by_name
            FROM bookings b
            LEFT JOIN users u ON u.id = b.user_id
            LEFT JOIN users v ON v.id = b.compliance_verified_by`;

        const [rows] = isStaff
            ? await db.query(`${baseQuery} ORDER BY b.event_date ASC`)
            : await db.query(
                `${baseQuery} WHERE b.status = 'Approved' OR b.user_id = ? ORDER BY b.event_date ASC`,
                [req.user.id]
            );
        res.json(rows);
    } catch (err) {
        console.error('Error fetching proposals:', err);
        res.status(500).json({ error: 'Failed to fetch proposals from database.' });
    }
});

// 4. Submit a new event proposal with required PDF upload (Starts as Under Review - OSAS)
app.post('/api/proposals', requireAuth, upload.single('pdfFile'), verifyUploadContent(PDF_SIGNATURE, 'PDF'), async (req, res) => {
    const { title, description, organizationName, eventDate, startTime, endTime, venue, resourcesNeeded } = req.body;
    const userId = req.user.id; // always the logged-in user, never a value sent by the browser
    const pdfFilename = req.file ? req.file.filename : null;

    if (!pdfFilename) {
        return res.status(400).json({ error: 'A PDF proposal document is required.' });
    }

    const removeUpload = () => { if (req.file) fs.unlink(req.file.path, () => { }); };

    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(startTime || '') || !timePattern.test(endTime || '')) {
        removeUpload();
        return res.status(400).json({ error: 'A valid start time and end time are required.' });
    }
    if (endTime <= startTime) {
        removeUpload();
        return res.status(400).json({ error: 'End time must be later than the start time.' });
    }

    // Proposals need lead time, and can't be scheduled unreasonably far out (must match script.js)
    const MIN_PROPOSAL_LEAD_DAYS = 7;
    const MAX_PROPOSAL_LEAD_DAYS = 365;
    const dateOnly = (daysFromToday) => {
        const d = new Date();
        d.setDate(d.getDate() + daysFromToday);
        // Local calendar date (toISOString would use UTC and can be a day off)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const minDate = dateOnly(MIN_PROPOSAL_LEAD_DAYS);
    const maxDate = dateOnly(MAX_PROPOSAL_LEAD_DAYS);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate || '') || eventDate < minDate) {
        removeUpload();
        return res.status(400).json({ error: `Events must be proposed at least ${MIN_PROPOSAL_LEAD_DAYS} days in advance.` });
    }
    if (eventDate > maxDate) {
        removeUpload();
        return res.status(400).json({ error: `Events can't be scheduled more than ${MAX_PROPOSAL_LEAD_DAYS} days ahead.` });
    }

    try {
        // Reject overlapping bookings for the same physical venue and date
        if (!(venue || '').startsWith('Online')) {
            const [clashes] = await db.query(
                `SELECT id FROM bookings
                 WHERE event_date = ? AND venue = ?
                   AND status IN ('Under Review - OSAS', 'Under Review - Adviser', 'Approved')
                   AND (start_time IS NULL OR end_time IS NULL OR (start_time < ? AND end_time > ?))
                 LIMIT 1`,
                [eventDate, venue, endTime, startTime]
            );
            if (clashes.length > 0) {
                removeUpload();
                return res.status(409).json({ error: 'This venue is already requested or booked for an overlapping time on that date.' });
            }
        }

        const query = `
            INSERT INTO bookings (title, description, organization_name, event_date, start_time, end_time, venue, resources_needed, user_id, proposal_file, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Under Review - OSAS')
        `;
        const [result] = await db.query(query, [
            title,
            description,
            organizationName,
            eventDate,
            startTime,
            endTime,
            venue,
            resourcesNeeded,
            userId,
            pdfFilename
        ]);

        res.json({ success: true, proposalId: result.insertId });
    } catch (err) {
        console.error('Error creating proposal with file:', err);
        res.status(500).json({ error: 'Failed to submit proposal.' });
    }
});

// 5. Update proposal status (OSAS then Admin) - role and workflow stage are enforced here
app.put('/api/proposals/:id', requireAuth, async (req, res) => {
    const proposalId = req.params.id;
    const { status } = req.body;
    const rejectionReason = String(req.body.rejectionReason || '').trim().slice(0, 1000);

    try {
        const [rows] = await db.query('SELECT id, status FROM bookings WHERE id = ?', [proposalId]);
        if (!rows[0]) {
            return res.status(404).json({ error: `No booking found with ID ${proposalId}.` });
        }

        if (!canChangeStatus(rows[0].status, status, req.user.role)) {
            return res.status(403).json({ error: 'Your account cannot make that change at this stage of the approval workflow.' });
        }

        // "AND status = ?" makes sure nobody else changed it in the meantime
        const [result] = await db.query(
            'UPDATE bookings SET status = ?, rejection_reason = ? WHERE id = ? AND status = ?',
            [status, status === 'Rejected' ? rejectionReason : '', proposalId, rows[0].status]
        );

        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'This proposal was just updated by someone else. Please refresh.' });
        }

        res.json({
            success: true,
            status,
            message: 'Proposal status updated successfully in database.'
        });
    } catch (err) {
        console.error('Database update error:', err);
        res.status(500).json({ error: 'Failed to update proposal status in database.' });
    }
});

// Splits "Resources Needed" text into individual items (must match the front-end parser)
const RESOURCE_STATUSES = ['Returned', 'Damaged', 'Missing'];
// Must match the client-side NO_RESOURCES_PHRASES list in script.js exactly, or the two sides
// could disagree on how many checklist items a booking has.
const NO_RESOURCES_PHRASES = new Set([
    'none', 'none.', 'n/a', 'na', 'n.a', 'n.a.', 'nil', 'nil.', 'null', '-', '--', '—',
    'none needed', 'no resources', 'no resources needed', 'no equipment', 'no equipment needed',
    'not applicable', 'wala', 'wala po'
]);

function parseResourceItems(text) {
    return String(text || '')
        .split(/[\n,;]+/)
        .map(t => t.trim())
        .filter(Boolean)
        .filter(item => !NO_RESOURCES_PHRASES.has(item.toLowerCase()))
        .slice(0, 30);
}

// 5b. Student submits post-event compliance (photo + equipment checklist + remarks + certification)
app.post('/api/compliance', requireAuth, (req, res) => {
    complianceUpload.array('proofFiles', MAX_COMPLIANCE_PHOTOS)(req, res, (uploadErr) => {
        const files = req.files || [];
        const removeUpload = () => files.forEach(f => fs.unlink(f.path, () => { }));

        if (uploadErr) {
            let message = uploadErr.message;
            if (uploadErr.code === 'LIMIT_UNEXPECTED_FILE') message = `You can upload up to ${MAX_COMPLIANCE_PHOTOS} photos.`;
            if (uploadErr.code === 'LIMIT_FILE_SIZE') message = 'Each photo must be 10 MB or smaller.';
            return res.status(400).json({ error: message });
        }

        if (files.some(f => !fileStartsWith(f.path, IMAGE_SIGNATURES))) {
            removeUpload();
            return res.status(400).json({ error: 'One of the files is not a valid image.' });
        }

        (async () => {
            const { bookingId, certified } = req.body;
            const userId = req.user.id;
            const remarks = String(req.body.remarks || '').trim().slice(0, 500);

            if (files.length === 0) {
                return res.status(400).json({ error: 'At least one venue cleanliness photo is required.' });
            }

            if (certified !== 'true') {
                removeUpload();
                return res.status(400).json({ error: 'You must tick the certification statement.' });
            }

            let statuses;
            try {
                statuses = JSON.parse(req.body.checklist || '[]');
            } catch (e) {
                statuses = null;
            }

            try {
                const [rows] = await db.query(
                    'SELECT id, user_id, status, cleanliness_proof, cleanliness_photos, compliance_status, resources_needed FROM bookings WHERE id = ?',
                    [bookingId]
                );
                const booking = rows[0];

                if (!booking) {
                    removeUpload();
                    return res.status(404).json({ error: 'Event not found.' });
                }
                if (String(booking.user_id) !== String(userId)) {
                    removeUpload();
                    return res.status(403).json({ error: 'You can only submit compliance for your own events.' });
                }
                if (booking.status !== 'Approved') {
                    removeUpload();
                    return res.status(400).json({ error: 'Compliance can only be submitted for approved events.' });
                }
                // A submission already exists: only allowed to replace it if OSAS/Admin rejected it
                if (booking.cleanliness_proof && booking.compliance_status !== 'Rejected') {
                    removeUpload();
                    return res.status(409).json({ error: 'Compliance was already submitted for this event.' });
                }

                // Every requested item must have a valid condition
                const items = parseResourceItems(booking.resources_needed);
                if (!Array.isArray(statuses) || statuses.length !== items.length ||
                    statuses.some(st => !RESOURCE_STATUSES.includes(st))) {
                    removeUpload();
                    return res.status(400).json({ error: 'Set the condition of every item on the equipment checklist.' });
                }

                const checklist = items.map((item, i) => ({ item, status: statuses[i] }));
                const allReturned = checklist.every(c => c.status === 'Returned');
                // Photos from the rejected attempt (only set when this is a resubmission)
                let oldPhotos = [];
                if (booking.cleanliness_proof) {
                    try {
                        const parsed = JSON.parse(booking.cleanliness_photos || '[]');
                        oldPhotos = Array.isArray(parsed) ? parsed : [];
                    } catch (e) { /* fall through to the single-file value */ }
                    if (oldPhotos.length === 0) oldPhotos = [booking.cleanliness_proof];
                }

                await db.query(
                    `UPDATE bookings
                 SET cleanliness_proof = ?, cleanliness_photos = ?, equipment_checklist = ?, compliance_remarks = ?,
                     resources_returned = ?, compliance_status = 'Submitted', compliance_submitted_at = NOW(),
                     compliance_rejection_reason = NULL, compliance_verified_by = NULL, compliance_verified_at = NULL
                 WHERE id = ?`,
                    [files[0].filename, JSON.stringify(files.map(f => f.filename)), JSON.stringify(checklist), remarks, allReturned ? 1 : 0, bookingId]
                );

                // Clean up the photos from the rejected attempt now that they have been replaced
                oldPhotos.forEach(name => fs.unlink(path.join(uploadsDir, path.basename(String(name))), () => { }));

                res.json({ success: true });
            } catch (err) {
                console.error('Compliance submission error:', err);
                removeUpload();
                res.status(500).json({ error: 'Failed to submit compliance.' });
            }
        })();
    });
});

// 5c. OSAS / Admin verifies (signs off) a compliance submission
app.put('/api/compliance/:id/verify', requireRole(...STAFF_ROLES), async (req, res) => {
    const bookingId = req.params.id;

    try {
        const [rows] = await db.query(
            'SELECT id, cleanliness_proof, compliance_status FROM bookings WHERE id = ?',
            [bookingId]
        );
        const booking = rows[0];

        if (!booking) {
            return res.status(404).json({ error: 'Event not found.' });
        }
        if (!booking.cleanliness_proof) {
            return res.status(400).json({ error: 'No compliance submission to verify yet.' });
        }
        if (booking.compliance_status === 'Verified') {
            return res.status(409).json({ error: 'This submission is already verified.' });
        }
        if (booking.compliance_status === 'Rejected') {
            return res.status(409).json({ error: 'This submission was rejected. Waiting for the student to resubmit.' });
        }

        await db.query(
            `UPDATE bookings
             SET compliance_status = 'Verified', compliance_verified_by = ?, compliance_verified_at = NOW(),
                 compliance_rejection_reason = NULL
             WHERE id = ?`,
            [req.user.id, bookingId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Compliance verify error:', err);
        res.status(500).json({ error: 'Failed to verify compliance.' });
    }
});

// 5d. OSAS / Admin rejects a compliance submission (e.g. unclear photo, wrong/missing equipment entries)
app.put('/api/compliance/:id/reject', requireRole(...STAFF_ROLES), async (req, res) => {
    const bookingId = req.params.id;
    const reason = String(req.body.reason || '').trim().slice(0, 1000);

    if (!reason) {
        return res.status(400).json({ error: 'Please state what needs to be corrected.' });
    }

    try {
        const [rows] = await db.query(
            'SELECT id, cleanliness_proof, compliance_status FROM bookings WHERE id = ?',
            [bookingId]
        );
        const booking = rows[0];

        if (!booking) {
            return res.status(404).json({ error: 'Event not found.' });
        }
        if (!booking.cleanliness_proof) {
            return res.status(400).json({ error: 'No compliance submission to reject yet.' });
        }
        if (booking.compliance_status === 'Verified') {
            return res.status(409).json({ error: 'This submission is already verified and can no longer be rejected.' });
        }

        await db.query(
            `UPDATE bookings
             SET compliance_status = 'Rejected', compliance_rejection_reason = ?,
                 compliance_verified_by = ?, compliance_verified_at = NOW()
             WHERE id = ?`,
            [reason, req.user.id, bookingId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Compliance reject error:', err);
        res.status(500).json({ error: 'Failed to reject compliance submission.' });
    }
});

// ---- System evaluation survey (real responses) ----
function validSurveyAnswers(answers, count) {
    return Array.isArray(answers) && answers.length === count &&
        answers.every(a => Number.isInteger(a) && a >= 1 && a <= 5);
}

// Standard SUS scoring: odd items contribute (answer - 1), even items (5 - answer), total x 2.5 -> 0..100
function computeSusScore(answers) {
    const total = answers.reduce((sum, a, i) => sum + (i % 2 === 0 ? a - 1 : 5 - a), 0);
    return total * 2.5;
}

// Functional suitability: mean rating as a percentage of the maximum (5)
function computeFunctionalScore(answers) {
    const mean = answers.reduce((sum, a) => sum + a, 0) / answers.length;
    return (mean / 5) * 100;
}

app.get('/api/survey/metrics', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT COUNT(*) AS responses, AVG(sus_score) AS sus, AVG(functional_score) AS functional FROM survey_responses'
        );
        const r = rows[0];
        const round1 = (v) => (v === null ? 0 : Math.round(Number(v) * 10) / 10);

        let hasResponded = false;
        if (req.user) {
            const [mine] = await db.query('SELECT id FROM survey_responses WHERE user_id = ?', [req.user.id]);
            hasResponded = mine.length > 0;
        }

        res.json({
            responses: Number(r.responses),
            sus: round1(r.sus),
            functional: round1(r.functional),
            hasResponded
        });
    } catch (err) {
        console.error('Survey metrics error:', err);
        res.status(500).json({ error: 'Failed to load survey metrics.' });
    }
});

app.post('/api/survey', requireAuth, async (req, res) => {
    const { susAnswers, fsAnswers } = req.body;
    const userId = req.user.id;

    if (!validSurveyAnswers(susAnswers, 10) || !validSurveyAnswers(fsAnswers, 4)) {
        return res.status(400).json({ error: 'Please answer every survey question (ratings 1 to 5).' });
    }

    try {
        const [users] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
        if (!users[0]) {
            return res.status(401).json({ error: 'Please log in to submit the survey.' });
        }

        await db.query(
            `INSERT INTO survey_responses (user_id, sus_answers, fs_answers, sus_score, functional_score)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                sus_answers = VALUES(sus_answers), fs_answers = VALUES(fs_answers),
                sus_score = VALUES(sus_score), functional_score = VALUES(functional_score),
                updated_at = NOW()`,
            [userId, JSON.stringify(susAnswers), JSON.stringify(fsAnswers),
                computeSusScore(susAnswers), computeFunctionalScore(fsAnswers)]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Survey submit error:', err);
        res.status(500).json({ error: 'Failed to save survey response.' });
    }
});

// 6. Login route (verifies hashed password, then starts a signed session cookie)
app.post('/api/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const key = loginKey(req, email);

    if (isLoginLocked(key)) {
        return res.status(429).json({ error: 'Too many failed attempts. Please try again in 15 minutes.' });
    }

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        const user = rows[0];

        // Always run one bcrypt compare so unknown emails and wrong passwords look and feel identical
        const isMatch = await bcrypt.compare(password, (user && user.password_hash) || DUMMY_HASH);
        if (!user || !isMatch) {
            recordLoginFailure(key);
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        loginAttempts.delete(key);

        if (!user.email_verified_at) {
            return res.status(403).json({
                error: 'Please verify your email before logging in. Check your inbox for the verification link.',
                needsVerification: true
            });
        }

        startSession(res, user);
        res.json({ success: true, user: publicUser(user) });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed on server.' });
    }
});

// Sends a 24-hour email-verification link and stores its hash on the user row
async function issueVerificationEmail(req, userId, email) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await db.query(
        'UPDATE users SET email_verify_hash = ?, email_verify_expires = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE id = ?',
        [tokenHash, userId]
    );

    const link = `${req.protocol}://${req.get('host')}/api/verify-email?email=${encodeURIComponent(email)}&token=${token}`;
    await mailTransporter.sendMail({
        from: process.env.MAIL_FROM || process.env.MAIL_USER,
        to: email,
        subject: 'S.U.A.V.E. - Verify your email',
        text: `Welcome to S.U.A.V.E.! Please verify your email by opening this link:\n\n${link}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`
    });
}

const resendVerifyByEmail = createRateLimiter(3, 15 * 60 * 1000); // 3 resend requests per email / 15 min
const resendVerifyByIp = createRateLimiter(10, 60 * 60 * 1000);   // 10 resend requests per IP / hour

// Timing-safe "does this secret match?" check, shared by the org and staff access codes
function codeMatches(supplied, expected) {
    if (expected === '') return false; // an unset code means that signup path is closed
    const digest = (value) => crypto.createHash('sha256').update(value).digest();
    return crypto.timingSafeEqual(digest(String(supplied || '')), digest(expected));
}

// 7. Signup route.
//    - Student Organization Officer needs the organization access code, if one is configured.
//    - OSAS / Admin needs the staff access code.
app.post('/api/signup', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const displayName = String(req.body.displayName || '').trim().slice(0, 100);
    const password = String(req.body.password || '');
    const requestedRole = String(req.body.role || 'student');
    const staffCode = String(req.body.staffCode || '');
    const orgCode = String(req.body.orgCode || '');

    if (!email.endsWith('@cvsu.edu.ph')) {
        return res.status(400).json({ error: 'Only @cvsu.edu.ph emails are allowed.' });
    }
    if (!displayName) {
        return res.status(400).json({ error: 'A display name is required.' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    let role = 'student';
    if (requestedRole === 'student') {
        // ORG_SIGNUP_CODE is optional: leave it unset in .env to keep student signups open to anyone
        // with a valid @cvsu.edu.ph email, as before.
        const expected = process.env.ORG_SIGNUP_CODE || '';
        if (expected !== '') {
            const wait = staffCodeByIp.hit(req.ip);
            if (wait > 0) {
                return res.status(429).json({ error: `Too many attempts. Please try again in ${Math.ceil(wait / 60)} minute(s).` });
            }
            if (!codeMatches(orgCode, expected)) {
                return res.status(403).json({ error: 'A valid organization access code is required to register.' });
            }
        }
    } else {
        // A shared static code is still just one secret away from granting OSAS/Admin to anyone who
        // has it - this limiter only stops it from being brute-forced quickly; it does not replace
        // keeping the code itself private, rotating it, or disabling self-signup for these roles
        // entirely (leave STAFF_SIGNUP_CODE empty and promote accounts via SQL instead).
        const wait = staffCodeByIp.hit(req.ip);
        if (wait > 0) {
            return res.status(429).json({ error: `Too many attempts. Please try again in ${Math.ceil(wait / 60)} minute(s).` });
        }
        const expected = process.env.STAFF_SIGNUP_CODE || '';
        if (!STAFF_ROLES.includes(requestedRole) || !codeMatches(staffCode, expected)) {
            return res.status(403).json({ error: 'A valid staff access code is required to register as OSAS or Admin.' });
        }
        role = requestedRole;
    }

    const mailConfigured = !!(process.env.MAIL_USER && process.env.MAIL_PASS);

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            `INSERT INTO users (email, display_name, password_hash, role, email_verified_at)
             VALUES (?, ?, ?, ?, ?)`,
            [email, displayName, hashedPassword, role, mailConfigured ? null : new Date()]
        );

        if (!mailConfigured) {
            // No mail service configured (e.g. local development): skip verification so the app still works.
            const user = { id: result.insertId, email, display_name: displayName, role, avatar_url: null, token_version: 0 };
            startSession(res, user);
            return res.json({ success: true, userId: result.insertId, user: publicUser(user) });
        }

        try {
            await issueVerificationEmail(req, result.insertId, email);
        } catch (mailErr) {
            console.error('Verification email failed to send:', mailErr.message);
        }

        res.json({
            success: true,
            requiresVerification: true,
            message: `Account created! We sent a verification link to ${email}. Please verify it before logging in.`
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'An account with that email already exists.' });
        }
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Registration failed.' });
    }
});

// Verification link clicked from the email. Redirects back to the site with a result in the URL.
app.get('/api/verify-email', async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    const token = String(req.query.token || '');
    const fail = () => res.redirect('/?verified=0');

    if (!email || !token) return fail();

    try {
        const [rows] = await db.query(
            'SELECT id, email_verify_hash, email_verify_expires, email_verified_at FROM users WHERE email = ?',
            [email]
        );
        const user = rows[0];
        if (!user) return fail();
        if (user.email_verified_at) return res.redirect('/?verified=already');
        if (!user.email_verify_hash || !user.email_verify_expires || new Date(user.email_verify_expires) < new Date()) {
            return fail();
        }

        const givenHash = Buffer.from(crypto.createHash('sha256').update(token).digest('hex'));
        const storedHash = Buffer.from(user.email_verify_hash);
        if (givenHash.length !== storedHash.length || !crypto.timingSafeEqual(givenHash, storedHash)) {
            return fail();
        }

        await db.query(
            'UPDATE users SET email_verified_at = NOW(), email_verify_hash = NULL, email_verify_expires = NULL WHERE id = ?',
            [user.id]
        );
        res.redirect('/?verified=1');
    } catch (err) {
        console.error('Email verification error:', err);
        fail();
    }
});

// Sends a new verification link. Always replies the same way, so it cannot be used to check which emails exist.
app.post('/api/resend-verification', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email.endsWith('@cvsu.edu.ph')) {
        return res.status(400).json({ error: 'Only @cvsu.edu.ph emails are allowed.' });
    }

    const wait = Math.max(resendVerifyByIp.hit(req.ip), resendVerifyByEmail.hit(email));
    if (wait > 0) {
        return res.status(429).json({ error: `Too many requests. Please try again in ${Math.ceil(wait / 60)} minute(s).` });
    }

    const genericReply = { success: true, message: `If ${email} needs verification, a new link has been sent.` };

    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
        return res.json(genericReply); // accounts are auto-verified when mail isn't configured
    }

    try {
        const [rows] = await db.query('SELECT id, email_verified_at FROM users WHERE email = ?', [email]);
        const user = rows[0];
        if (user && !user.email_verified_at) {
            await issueVerificationEmail(req, user.id, email);
        }
        res.json(genericReply);
    } catch (err) {
        console.error('Resend verification error:', err);
        res.json(genericReply);
    }
});

// 8. Settings route: always edits the LOGGED-IN user. Changing the password needs the current password.
app.post('/api/settings', requireAuth, avatarUpload.single('avatarFile'), verifyUploadContent(IMAGE_SIGNATURES, 'image'), async (req, res) => {
    const userId = req.user.id;
    const displayName = String(req.body.displayName || '').trim().slice(0, 100);
    const newPassword = String(req.body.newPassword || '').trim();
    const currentPassword = String(req.body.currentPassword || '');
    const avatarFilename = req.file ? req.file.filename : null;
    const removeUpload = () => { if (req.file) fs.unlink(req.file.path, () => { }); };

    if (!displayName) {
        removeUpload();
        return res.status(400).json({ error: 'Display name cannot be empty.' });
    }

    try {
        const fields = ['display_name = ?'];
        const params = [displayName];

        if (newPassword !== '') {
            if (newPassword.length < 8) {
                removeUpload();
                return res.status(400).json({ error: 'New password must be at least 8 characters.' });
            }

            const [pwRows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
            const matches = pwRows[0] && await bcrypt.compare(currentPassword, pwRows[0].password_hash);
            if (!matches) {
                removeUpload();
                return res.status(400).json({ error: 'Current password is incorrect.' });
            }

            fields.push('password_hash = ?');
            params.push(await bcrypt.hash(newPassword, 10));
        }

        if (avatarFilename) {
            fields.push('avatar_url = ?');
            params.push(avatarFilename);
        }

        params.push(userId);
        await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);

        const [rows] = await db.query(
            'SELECT id, email, display_name, role, avatar_url FROM users WHERE id = ?',
            [userId]
        );
        const updated = rows[0] || {};

        res.json({
            success: true,
            user: {
                displayName: updated.display_name || displayName,
                avatar: uploadUrl(updated.avatar_url) || undefined
            }
        });
    } catch (err) {
        console.error('Settings error:', err);
        removeUpload();
        res.status(500).json({ error: 'Failed to update settings.' });
    }
});

// 9. Forgot password route (emails a 6-digit code). The reply is the same whether or not the account exists.
app.post('/api/forgot-password', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email.endsWith('@cvsu.edu.ph')) {
        return res.status(400).json({ error: 'Only @cvsu.edu.ph emails are allowed.' });
    }

    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
        return res.status(500).json({
            error: 'Email service is not configured yet (set MAIL_USER and MAIL_PASS in .env).'
        });
    }

    // Limits apply to every request, so they reveal nothing about which emails exist
    const wait = Math.max(forgotByIp.hit(req.ip), forgotByEmail.hit(email));
    if (wait > 0) {
        return res.status(429).json({
            error: `Too many recovery requests. Please try again in ${Math.ceil(wait / 60)} minute(s).`
        });
    }

    const genericReply = {
        success: true,
        message: `If an account exists for ${email}, a recovery code has been sent. It expires in 10 minutes.`
    };

    try {
        const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.json(genericReply);
        }

        // Cooldown: do not send another code too soon (same reply, so nothing is revealed)
        const existing = recoveryCodes.get(email);
        if (existing && Date.now() - existing.sentAt < RESET_RESEND_COOLDOWN_MS) {
            return res.json(genericReply);
        }

        const code = crypto.randomInt(100000, 1000000).toString();
        recoveryCodes.set(email, {
            hash: hashRecoveryCode(email, code),
            expiresAt: Date.now() + RESET_CODE_TTL_MS,
            attempts: 0,
            sentAt: Date.now()
        });

        // Local testing only: set DEBUG_RECOVERY_CODES=true in .env to print codes to this console
        if (process.env.DEBUG_RECOVERY_CODES === 'true' && process.env.NODE_ENV !== 'production') {
            console.log(`[DEBUG] Recovery code for ${email}: ${code}`);
        }

        try {
            await mailTransporter.sendMail({
                from: process.env.MAIL_FROM || process.env.MAIL_USER,
                to: email,
                subject: 'S.U.A.V.E. Password Recovery Code',
                text: `Your S.U.A.V.E. password recovery code is: ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`
            });
        } catch (mailErr) {
            recoveryCodes.delete(email);
            console.error('Recovery email failed:', mailErr.message);
        }

        res.json(genericReply);
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Failed to process the recovery request.' });
    }
});

// 10. Reset password route (verifies the 6-digit code, with a limit on wrong guesses)
app.post('/api/reset-password', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const newPassword = String(req.body.newPassword || '').trim();

    if (!email || !code || !newPassword) {
        return res.status(400).json({ error: 'Email, recovery code, and new password are required.' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const wait = resetByIp.hit(req.ip);
    if (wait > 0) {
        return res.status(429).json({
            error: `Too many attempts. Please try again in ${Math.ceil(wait / 60)} minute(s).`
        });
    }

    const result = checkRecoveryCode(email, code);
    if (!result.ok) {
        if (result.reason === 'locked') {
            return res.status(400).json({ error: 'Too many incorrect codes. Please request a new recovery code.' });
        }
        if (result.reason === 'wrong') {
            return res.status(400).json({
                error: `Incorrect code. ${result.remaining} attempt${result.remaining === 1 ? '' : 's'} left.`
            });
        }
        return res.status(400).json({ error: 'Invalid or expired recovery code. Please request a new one.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        // token_version = token_version + 1 signs every session already issued for this account out,
        // in case the account was compromised and someone else is still logged in.
        const [update] = await db.query(
            'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE email = ?',
            [hashedPassword, email]
        );

        if (update.affectedRows === 0) {
            return res.status(404).json({ error: 'User account not found.' });
        }

        res.json({ success: true, message: 'Password has been successfully reset! You can now log in.' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Failed to reset password in database.' });
    }
});

// Return JSON (not an HTML page) for upload errors such as wrong file type or file too large
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || /^Only .* (allowed|files)/.test(err.message || '')) {
        return res.status(400).json({ error: err.message });
    }
    if (err.status === 404 || err.statusCode === 404) {
        return res.status(404).send('Not Found');
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 3000;
ensureSchema()
    .then(() => {
        console.log('[DB] Schema check complete.');
        if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
            console.warn('[Auth] Email not configured (MAIL_USER/MAIL_PASS) - new accounts are auto-verified and logged in immediately.');
        }
    })
    .catch(err => console.error('[DB] Schema check failed:', err.message))
    .then(() => migrateLegacyUploads())
    .catch(err => console.error('[Uploads] Migration failed:', err.message))
    .then(() => {
        app.listen(PORT, () => {
            console.log(`S.U.A.V.E. server running on port ${PORT}`);
        });
    });