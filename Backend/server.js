const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const multer = require('multer');

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Configure Multer storage for PDF proposal uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, __dirname); // Saves files in the Backend directory
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

// 1. Serve static files (index.html, script.js, style.css, uploaded PDFs) from the Backend folder
app.use(express.static(__dirname));

// 2. Serve index.html explicitly at the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// MySQL Database Connection Pool
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'suave_db'
});

// 3. Get all event proposals/bookings
app.get('/api/proposals', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM bookings ORDER BY event_date ASC');
        res.json(rows);
    } catch (err) {
        console.error('Error fetching proposals:', err);
        res.status(500).json({ error: 'Failed to fetch proposals from database.' });
    }
});

// 4. Submit a new event proposal with required PDF upload (Starts as Under Review - OSAS)
app.post('/api/proposals', upload.single('pdfFile'), async (req, res) => {
    const { title, description, organizationName, eventDate, venue, resourcesNeeded, userId } = req.body;
    const pdfFilename = req.file ? req.file.filename : null;

    if (!pdfFilename) {
        return res.status(400).json({ error: 'A PDF proposal document is required.' });
    }

    try {
        const query = `
            INSERT INTO bookings (title, description, organization_name, event_date, venue, resources_needed, user_id, proposal_file, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Under Review - OSAS')
        `;
        const [result] = await db.query(query, [
            title,
            description,
            organizationName,
            eventDate,
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

// 5. Update proposal status (Approve / Reject) - Persists to MySQL Database
app.put('/api/proposals/:id', async (req, res) => {
    const proposalId = req.params.id;
    const { status, rejectionReason } = req.body;

    try {
        const query = 'UPDATE bookings SET status = ?, rejection_reason = ? WHERE id = ?';
        await db.query(query, [status, rejectionReason || '', proposalId]);

        res.json({ success: true, message: 'Proposal status updated successfully in database.' });
    } catch (err) {
        console.error('Database update error:', err);
        res.status(500).json({ error: 'Failed to update proposal status in database.' });
    }
});

// 6. Login route
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials or user not found.' });
        }
        const user = rows[0];
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                displayName: user.display_name || user.displayName,
                role: user.role,
                avatar: user.avatar
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed on server.' });
    }
});

// 7. Signup route
app.post('/api/signup', async (req, res) => {
    const { email, displayName, password, role } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO users (email, display_name, password, role) VALUES (?, ?, ?, ?)',
            [email, displayName, password, role]
        );
        res.json({ success: true, userId: result.insertId });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Registration failed.' });
    }
});

// 8. Settings route
app.post('/api/settings', async (req, res) => {
    const { userId, displayName } = req.body;
    try {
        await db.query('UPDATE users SET display_name = ? WHERE id = ?', [displayName, userId]);
        res.json({ success: true, user: { displayName } });
    } catch (err) {
        console.error('Settings error:', err);
        res.status(500).json({ error: 'Failed to update settings.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`S.U.A.V.E. server running on port ${PORT}`);
});