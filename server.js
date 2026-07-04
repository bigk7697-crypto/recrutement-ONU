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
const { analyzeCandidate, updateCandidateScore, getAnalysisStats } = require('./analysisService');
require('dotenv').config();

if (process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_URL.startsWith('cloudinary://')) {
    delete process.env.CLOUDINARY_URL;
}

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { pool, initDb } = require('./database');

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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/apply', (req, res) => res.sendFile(path.join(__dirname, 'public', 'apply.html')));
app.get('/jobs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jobs.html')));
app.get('/status', (req, res) => res.sendFile(path.join(__dirname, 'public', 'status.html')));
app.get('/recru', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/register-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register_admin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin/jobs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jobs_admin.html')));
app.get('/admin/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings_admin.html')));

app.get('/api/admin/captcha', (req, res) => {
    const a = Math.floor(Math.random() * 12) + 2;
    const b = Math.floor(Math.random() * 12) + 2;
    const c = Math.floor(Math.random() * 10);
    const isMult = Math.random() > 0.5;
    const question = isMult ? `${a} x ${b} + ${c} = ?` : `${a} + ${b} + ${c} = ?`;
    const result = isMult ? (a * b) + c : a + b + c;
    res.cookie('captcha_res', result.toString(), { httpOnly: true });
    res.json({ question });
});

function isAdmin(req, res, next) {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'Non authentifié' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Session expirée' });
    }
}

function isSuperAdmin(req, res, next) {
    isAdmin(req, res, () => {
        if (req.admin.role !== 'super_admin') {
            return res.status(403).json({ error: 'Accès refusé : réservé au Super Administrateur' });
        }
        next();
    });
}

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
        if (admin.status === 'banned') return res.status(403).json({ error: 'Compte banni' });
        const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: '24h' });
        res.cookie('admin_token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
        res.json({ success: true, username: admin.username });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/verify', isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT username, full_name, role FROM admins WHERE id = $1', [req.admin.id]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Utilisateur non trouvé' });
        res.json({ success: true, admin: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/manage/list', isSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, role, status, is_verified FROM admins');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/manage/status', isSuperAdmin, async (req, res) => {
    const { adminId, status } = req.body;
    try {
        await pool.query('UPDATE admins SET status = $1 WHERE id = $2', [status, adminId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const uploadCandidates = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Seuls PDF et images sont acceptés'), false);
    }
});

app.post('/api/apply', uploadCandidates.fields([{ name: 'cv', maxCount: 1 }, { name: 'diploma', maxCount: 1 }, { name: 'cert', maxCount: 1 }]), async (req, res) => {
    try {
        const data = req.body;
        const files = req.files;
        if (!data.first_name || !data.last_name || !data.email) return res.status(400).json({ error: 'Champs obligatoires manquants' });
        const ref = `UN-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const cv = files?.cv ? files.cv[0].path : null;
        const dip = files?.diploma ? files.diploma[0].path : null;
        const cert = files?.cert ? files.cert[0].path : null;
        const query = `INSERT INTO candidates (reference_number, first_name, last_name, email, phone, whatsapp, profession, country, city, education, experience, experience_years, skills, languages, certifications, motivation_letter, cv_filename, diploma_filename, cert_filename, offer_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`;
        const result = await pool.query(query, [ref, data.first_name, data.last_name, data.email, data.phone, data.whatsapp, data.profession, data.country, data.city, data.education, data.experience, parseInt(data.experience_years) || 0, data.skills, data.languages, data.certifications, data.motivation_letter, cv, dip, cert, data.offer_id ? parseInt(data.offer_id) : null]);
        const id = result.rows[0].id;
        const analysis = analyzeCandidate({ education: data.education, experience: data.experience, skills: data.skills, languages: data.languages, motivation_letter: data.motivation_letter });
        await updateCandidateScore(id, analysis);
        sendAcknowledgmentEmail({ id, first_name: data.first_name, last_name: data.last_name, email: data.email, reference_number: ref }).catch(e => console.error(e));
        res.json({ success: true, reference_number: ref });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/jobs', (req, res) => {
    pool.query(`SELECT * FROM job_offers WHERE status = 'active' ORDER BY created_at DESC`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

app.get('/api/admin/stats', isAdmin, async (req, res) => {
    try {
        const s = await getAnalysisStats();
        res.json({ total_candidates: parseInt(s.total) || 0, pending_candidates: parseInt(s.review) || 0, accepted_candidates: parseInt(s.strong_accept) + parseInt(s.accept), rejected_candidates: parseInt(s.reject) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/candidates', isAdmin, async (req, res) => {
    const { search, status } = req.query;
    try {
        let q = `SELECT c.*, j.title as job_title FROM candidates c LEFT JOIN job_offers j ON c.offer_id = j.id WHERE 1=1`;
        const v = [];
        if (search) { v.push(`%${search}%`); q += ` AND (c.first_name ILIKE $${v.length} OR c.last_name ILIKE $${v.length} OR c.profession ILIKE $${v.length})`; }
        if (status && status !== 'all') { v.push(status); q += ` AND c.status = $${v.length}`; }
        q += ` ORDER BY c.created_at DESC`;
        const result = await pool.query(q, v);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/candidates/:id', isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
        const c = result.rows[0];
        const analysis = analyzeCandidate({ education: c.education, experience: c.experience, skills: c.skills, languages: c.languages, motivation_letter: c.motivation_letter });
        res.json({ ...c, analysis });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/candidates/:id/status', isAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE candidates SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/candidates/:id/respond', isAdmin, async (req, res) => {
    const { channel, subject, message } = req.body;
    try {
        const result = await pool.query('SELECT email FROM candidates WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
        if (channel === 'email') {
            const { sendEmail } = require('./emailService');
            await sendEmail(result.rows[0].email, subject || 'Réponse ONU', message, req.params.id, 'admin_response');
        } else {
            await pool.query(`INSERT INTO email_logs (candidate_id, type, recipient, subject, body, status) VALUES ($1, $2, $3, $4, $5, 'simulated')`, [req.params.id, channel, result.rows[0].email, subject || 'Response', message]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/candidates/:id/document/:type', isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT cv_filename, diploma_filename, cert_filename FROM candidates WHERE id = $1', [req.params.id]);
        const c = result.rows[0];
        if (!c) return res.status(404).json({ error: 'Candidat non trouvé' });
        const docMap = { cv: 'cv_filename', diploma: 'diploma_filename', cert: 'cert_filename' };
        const file = c[docMap[req.params.type]];
        if (!file) return res.status(404).json({ error: 'Document absent' });
        res.redirect(file);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/profile', (req, res) => res.json({ success: true }));
app.put('/api/admin/config', (req, res) => res.json({ success: true }));

app.use((err, req, res, next) => {
    console.error('❌ GLOBAL ERROR:', err);
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload Error: ${err.message}` });
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

async function startServer() {
    try {
        await initDb();
        const adminEmail = 'maximej305@gmail.com';
        const adminPass = 'ONU20gost26';
        const hashedPass = await bcrypt.hash(adminPass, 10);
        const check = await pool.query('SELECT id FROM admins WHERE email = $1', [adminEmail]);
        if (check.rows.length === 0) {
            await pool.query(`INSERT INTO admins (username, password, email, full_name, role, status, is_verified) VALUES ($1, $2, $3, $4, $5, $6, $7)`, ['superadmin', hashedPass, adminEmail, 'Maxime SuperAdmin', 'super_admin', 'active', true]);
        } else {
            await pool.query(`UPDATE admins SET password = $1 WHERE email = $2`, [hashedPass, adminEmail]);
        }
        global.appConfig = {};
        const config = await pool.query("SELECT setting_key, setting_value FROM platform_settings");
        config.rows.forEach(row => global.appConfig[row.setting_key] = row.setting_value);
        server.listen(PORT, () => console.log('✅ Serveur ONU lancé sur http://localhost:' + PORT));
    } catch (err) {
        console.error('❌ Start Error:', err);
        process.exit(1);
    }
}

startServer();
