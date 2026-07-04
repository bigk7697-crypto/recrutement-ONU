const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Empêcher le crash de Cloudinary si CLOUDINARY_URL est mal configuré
if (process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_URL.startsWith('cloudinary://')) {
    delete process.env.CLOUDINARY_URL;
}

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { pool, initDb } = require('./database'); // Utilisation de pg pool

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: { folder: 'onu_recruitment', format: async (req, file) => 'pdf' },
});
const upload = multer({ storage });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'onu-secret-key-change-in-production-2024';

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/apply', (req, res) => res.sendFile(path.join(__dirname, 'public', 'apply.html')));
app.get('/jobs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jobs.html')));
app.get('/status', (req, res) => res.sendFile(path.join(__dirname, 'public', 'status.html')));
app.get('/recru', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin/jobs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jobs_admin.html')));
app.get('/admin/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings_admin.html')));

// API Admin Auth
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM admins WHERE username = $1 OR email = $1', [username]);
        const admin = result.rows[0];

        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.status(401).json({ error: 'Identifiants incorrects' });
        }

        const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
        res.cookie('admin_token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
        res.json({ success: true, username: admin.username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/verify', (req, res) => {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'Non authentifié' });

    try {
        jwt.verify(token, JWT_SECRET);
        res.json({ success: true });
    } catch (err) {
        res.status(401).json({ error: 'Session expirée' });
    }
});

// API Jobs
app.get('/api/jobs', (req, res) => {
    pool.query(`SELECT * FROM job_offers WHERE status = 'active' ORDER BY created_at DESC`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

// Admin Profile Update
app.put('/api/admin/profile', (req, res) => {
    res.json({ success: true });
});

// Admin Config Update
app.put('/api/admin/config', (req, res) => {
    res.json({ success: true });
});

async function startServer() {
    try {
        await initDb();
        console.log('✅ Base de données initialisée');

        global.appConfig = {};
        const configResult = await pool.query("SELECT setting_key, setting_value FROM platform_settings");
        configResult.rows.forEach(row => global.appConfig[row.setting_key] = row.setting_value);

        server.listen(PORT, () => console.log('✅ Serveur ONU lancé sur http://localhost:' + PORT));
    } catch (err) {
        console.error('❌ Erreur lors du démarrage du serveur:', err);
        process.exit(1);
    }
}

startServer();
