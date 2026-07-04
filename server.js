const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendVerificationEmail } = require('./emailService');
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
app.get('/register-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register_admin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin/jobs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jobs_admin.html')));
app.get('/admin/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings_admin.html')));

// Captcha simple : on génère un problème mathématique stocké en session/cookie
app.get('/api/admin/captcha', (req, res) => {
    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    const result = a + b;
    
    // On stocke le résultat dans un cookie chiffré ou simple pour cet exemple
    res.cookie('captcha_res', result.toString(), { httpOnly: true });
    res.json({ question: `${a} + ${b} = ?` });
});

// API Admin Auth
app.post('/api/admin/login', async (req, res) => {
    const { username, password, captcha } = req.body;
    
    const storedCaptcha = req.cookies.captcha_res;
    if (!storedCaptcha || parseInt(captcha) !== parseInt(storedCaptcha)) {
        return res.status(400).json({ error: 'Captcha incorrect' });
    }

    try {
        const result = await pool.query('SELECT * FROM admins WHERE username = $1 OR email = $1', [username]);
        const admin = result.rows[0];

        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.status(401).json({ error: 'Identifiants incorrects' });
        }

        if (admin.status === 'banned') {
            return res.status(403).json({ error: 'Votre compte a été banni par l\'administration.' });
        }

        const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: '24h' });
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

// Captcha Complexe
app.get('/api/admin/captcha', (req, res) => {
    const a = Math.floor(Math.random() * 12) + 2;
    const b = Math.floor(Math.random() * 12) + 2;
    const c = Math.floor(Math.random() * 10);
    
    // Opération aléatoire entre addition et multiplication
    const isMult = Math.random() > 0.5;
    const question = isMult ? `${a} x ${b} + ${c} = ?` : `${a} + ${b} + ${c} = ?`;
    const result = isMult ? (a * b) + c : a + b + c;
    
    res.cookie('captcha_res', result.toString(), { httpOnly: true });
    res.json({ question });
});

// Middleware de vérification Super Admin
function isSuperAdmin(req, res, next) {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'Non authentifié' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'super_admin') {
            return res.status(403).json({ error: 'Accès refusé : réservé au Super Administrateur' });
        }
        next();
    } catch (err) {
        res.status(401).json({ error: 'Session expirée' });
    }
}

// Gestion des Admins (Réservé au Super Admin)
app.get('/api/admin/manage/list', isSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, role, status, is_verified FROM admins');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/manage/status', isSuperAdmin, async (req, res) => {
    const { adminId, status } = req.body;
    try {
        await pool.query('UPDATE admins SET status = $1 WHERE id = $2', [status, adminId]);
        res.json({ success: true, message: `L'administrateur a été ${status === 'banned' ? 'banni' : 'réactivé'}.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

        // CRÉATION DU SUPER ADMIN AUTOMATIQUE
        const adminEmail = 'maximej305@gmail.com';
        const adminPass = 'ONU20gost26';
        const hashedPass = await bcrypt.hash(adminPass, 10);

        await pool.query(
            `INSERT INTO admins (username, password, email, full_name, role, status, is_verified) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             ON CONFLICT (email) DO UPDATE SET password = $2`,
            ['superadmin', hashedPass, adminEmail, 'Maxime SuperAdmin', 'super_admin', 'active', true]
        );
        console.log('✅ Super Admin configuré');

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
