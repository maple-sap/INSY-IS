const express = require('express');
const mysql = require('mysql2');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, 'avatar-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Database Connection (XAMPP MySQL default: suave_db, root, no password)
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'suave_db'
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err);
        return;
    }
    console.log('Connected to MySQL suave_db database.');
});

// API: Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT id, email, display_name AS displayName, role, avatar_url AS avatar FROM users WHERE email = ? AND password = ?';
    db.query(query, [email, password], (err, results) => {
        if (err) {
            console.error('Login error:', err);
            return res.status(500).json({ error: 'Database error during login' });
        }
        if (results.length === 0) return res.status(401).json({ error: 'Invalid email or password.' });
        res.json({ success: true, user: results[0] });
    });
});

// API: Signup
app.post('/api/signup', (req, res) => {
    const { email, displayName, password, role } = req.body;
    const query = 'INSERT INTO users (email, display_name, password, role) VALUES (?, ?, ?, ?)';
    db.query(query, [email, displayName, password, role || 'student'], (err, result) => {
        if (err) {
            console.error('Signup error:', err);
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Email already registered.' });
            }
            return res.status(500).json({ error: 'Database error during registration.' });
        }
        res.json({ success: true, userId: result.insertId });
    });
});

// API: Get Bookings / Proposals
app.get('/api/proposals', (req, res) => {
    const query = 'SELECT * FROM bookings ORDER BY event_date ASC';
    db.query(query, (err, results) => {
        if (err) {
            console.error('Fetch bookings error:', err);
            return res.status(500).json({ error: 'Failed to fetch bookings' });
        }
        res.json(results);
    });
});

// API: Create Booking / Proposal
app.post('/api/proposals', (req, res) => {
    const { title, description, organizationName, eventDate, venue, resourcesNeeded, userId } = req.body;
    const query = `INSERT INTO bookings (title, description, organization_name, event_date, venue, resources_needed, user_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'Under Review')`;
    db.query(query, [title, description, organizationName, eventDate, venue, resourcesNeeded, userId || 1], (err, result) => {
        if (err) {
            console.error('Insert booking error:', err);
            return res.status(500).json({ error: 'Failed to insert booking' });
        }
        res.json({ success: true, proposalId: result.insertId });
    });
});

// API: Update Settings & Avatar in Database
app.post('/api/settings', upload.single('avatarFile'), (req, res) => {
    const { userId, displayName } = req.body;
    let avatarUrl = req.file ? `/uploads/${req.file.filename}` : null;

    let query = 'UPDATE users SET display_name = ?';
    let params = [displayName];

    if (avatarUrl) {
        query += ', avatar_url = ?';
        params.push(avatarUrl);
    }

    query += ' WHERE id = ?';
    params.push(userId);

    db.query(query, params, (err, result) => {
        if (err) {
            console.error('Database update error:', err);
            return res.status(500).json({ error: 'Database update failed' });
        }

        // Fetch updated user details from database
        db.query('SELECT id, email, display_name AS displayName, role, avatar_url AS avatar FROM users WHERE id = ?', [userId], (err, rows) => {
            if (err || rows.length === 0) {
                return res.status(500).json({ error: 'Failed to fetch updated user' });
            }
            res.json({ success: true, user: rows[0] });
        });
    });
});

app.listen(PORT, () => {
    console.log(`S.U.A.V.E. server running at http://localhost:${PORT}`);
});