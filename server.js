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
    
    // Vérification Captcha
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

        if (!admin.is_verified) {
            return res.status(403).json({ error: 'Votre compte n\'est pas encore vérifié. Veuillez consulter vos emails.' });
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

// Route de création du premier admin (SÉCURISÉE par un token)
app.post('/api/admin/setup', async (req, res) => {
    const { username, password, email, full_name, setupToken } = req.body;
    
    if (setupToken !== process.env.ADMIN_SETUP_TOKEN) {
        return res.status(403).json({ error: 'Token de configuration invalide' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const vToken = crypto.randomBytes(32).toString('hex');
        
        await pool.query(
            'INSERT INTO admins (username, password, email, full_name, verification_token) VALUES ($1, $2, $3, $4, $5)',
            [username, hashedPassword, email, full_name, vToken]
        );

        const admin = { email, full_name };
        await sendVerificationEmail(admin, vToken);

        res.json({ success: true, message: 'Compte créé. Veuillez vérifier vos emails pour activer le compte.' });
    } catch (err) {
        res.status(500).json({ error: 'L\'utilisateur existe déjà ou erreur serveur' });
    }
});

// Vérification de l'email
app.get('/api/admin/verify-email', async (req, res) => {
    const { token } = req.query;
    try {
        const result = await pool.query('SELECT * FROM admins WHERE verification_token = $1', [token]);
        if (result.rows.length === 0) return res.status(400).send('Lien de vérification invalide.');

        await pool.query('UPDATE admins SET is_verified = TRUE, verification_token = NULL WHERE id = $1', [result.rows[0].id]);
        res.send('<h1>✅ Compte vérifié avec succès ! Vous pouvez maintenant vous connecter.</h1>');
    } catch (err) {
        res.status(500).send('Erreur serveur.');
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
