const express = require('express');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { sendVerificationEmail, sendAcknowledgmentEmail } = require('./emailService');
const { analyzeCandidate, updateCandidateScore, getAnalysisStats } = require('./analysisService');
require('dotenv').config();

if (process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_URL.startsWith('cloudinary://')) {
    delete process.env.CLOUDINARY_URL;
}

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { pool, initDb } = require('./database');

let storage;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    storage = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: { folder: 'onu_recruitment', format: async (req, file) => 'pdf', type: 'upload' },
    });
    console.log('✅ Cloudinary storage configured');
} else {
    console.log('⚠️ Cloudinary keys missing, using local storage');
    storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, 'uploads/');
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
        }
    });
}
const upload = multer({ storage });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ ERROR: JWT_SECRET is not defined in environment variables');
    process.exit(1);
}

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

async function isAdmin(req, res, next) {
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

app.post('/api/admin/login', async (req, res) => {
    const { username, password, captcha } = req.body;
    const storedCaptcha = req.cookies.captcha_res;
    if (!storedCaptcha || parseInt(captcha) !== parseInt(storedCaptcha)) {
        return res.status(400).json({ error: 'Captcha incorrect' });
    }
    try {
        const result = await pool.query('SELECT * FROM admins WHERE username = $1 OR email = $2', [username, username]);
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

app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.json({ success: true });
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
        await pool.run('UPDATE admins SET status = $1 WHERE id = $2', [status, adminId]);
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

app.post('/api/apply', uploadCandidates.fields([{ name: 'cv', maxCount: 1 }, { name: 'diploma', maxCount: 1 }, { name: 'cert', maxCount: 1 }, { name: 'photo', maxCount: 1 }]), async (req, res) => {
    try {
        const data = req.body;
        const files = req.files;
        if (!data.first_name?.trim() || !data.last_name?.trim() || !data.email?.trim()) return res.status(400).json({ error: 'Champs obligatoires manquants' });
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email)) return res.status(400).json({ error: 'Email invalide' });
        const ref = `UN-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const cv = files?.cv ? files.cv[0].path : null;
        const dip = files?.diploma ? files.diploma[0].path : null;
        const cert = files?.cert ? files.cert[0].path : null;
        const photo = files?.photo ? files.photo[0].path : null;
        const query = `INSERT INTO candidates (reference_number, first_name, last_name, email, phone, whatsapp, profession, country, city, education, experience, experience_years, skills, languages, certifications, motivation_letter, cv_filename, diploma_filename, cert_filename, photo_filename, offer_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`;
        const result = await pool.run(query, [ref, data.first_name, data.last_name, data.email, data.phone, data.whatsapp, data.profession, data.country, data.city, data.education, data.experience, parseInt(data.experience_years) || 0, data.skills, data.languages, data.certifications, data.motivation_letter, cv, dip, cert, photo, data.offer_id ? parseInt(data.offer_id) : null]);
        const id = result.lastID;
        const analysis = analyzeCandidate({ education: data.education, experience: data.experience, skills: data.skills, languages: data.languages, motivation_letter: data.motivation_letter });
        await updateCandidateScore(id, analysis);
        sendAcknowledgmentEmail({ id, first_name: data.first_name, last_name: data.last_name, email: data.email, reference_number: ref }).catch(e => console.error(e));
        res.json({ success: true, reference_number: ref });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/jobs', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM job_offers WHERE status = 'active' ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/jobs/:id', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM job_offers WHERE id = $1 AND status = 'active'`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Offre non trouvée' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/jobs', isAdmin, async (req, res) => {
    try {
        const { title, department, location, type, description, requirements, salary_range, deadline, status } = req.body;
        if (!title?.trim() || !department?.trim() || !location?.trim()) {
            return res.status(400).json({ error: 'Titre, département et localisation sont obligatoires' });
        }
        const result = await pool.run(
            `INSERT INTO job_offers (title, department, location, type, description, requirements, salary_range, deadline, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [title, department, location, type, description, requirements, salary_range, deadline, status || 'active']
        );
        res.json({ success: true, job: { id: result.lastID, ...req.body } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/jobs/:id', isAdmin, async (req, res) => {
    try {
        const { title, department, location, type, description, requirements, salary_range, deadline, status } = req.body;
        await pool.run(
            `UPDATE job_offers SET title=$1, department=$2, location=$3, type=$4, description=$5, requirements=$6, salary_range=$7, deadline=$8, status=$9 WHERE id=$10`,
            [title, department, location, type, description, requirements, salary_range, deadline, status, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/jobs/:id', isAdmin, async (req, res) => {
    try {
        await pool.run('DELETE FROM job_offers WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/jobs/:id/duplicate', isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM job_offers WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Offre non trouvée' });
        const job = result.rows[0];
        const { id, created_at } = job; // Remove id and date
        const duplicateJob = { ...job };
        delete duplicateJob.id;
        delete duplicateJob.created_at;
        
        const fields = Object.keys(duplicateJob).join(', ');
        const placeholders = Object.values(duplicateJob).map((_, i) => '$' + (i + 1)).join(', ');
        const query = `INSERT INTO job_offers (${fields}) VALUES (${placeholders})`;
        
        const insertResult = await pool.run(query, Object.values(duplicateJob));
        res.json({ success: true, job: { id: insertResult.lastID, ...duplicateJob } });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        if (search) { v.push(`%${search}%`); q += ` AND (c.first_name LIKE $1 OR c.last_name LIKE $2 OR c.profession LIKE $3)`; v.push(`%${search}%`, `%${search}%`); }
        if (status && status !== 'all') { 
            v.push(status); 
            const index = v.length;
            q += ` AND c.status = $${index}`; 
        }
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
        await pool.run('UPDATE candidates SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
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
            await pool.run(`INSERT INTO email_logs (candidate_id, type, recipient, subject, body, status) VALUES ($1, $2, $3, $4, $5, 'simulated')`, [req.params.id, channel, result.rows[0].email, subject || 'Response', message]);
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
        if (file.startsWith('http')) {
            return res.redirect(file);
        }
        res.sendFile(path.join(__dirname, file));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/candidates/:id/download', isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
        const c = result.rows[0];
        if (!c) return res.status(404).json({ error: 'Candidat non trouvé' });

        const zip = new AdmZip();
        
        // 1. Create profile info text file
        const profileInfo = `
CANDIDATURE ONU - DOSSIER COMPLET
==================================
Référence : ${c.reference_number}
Nom complet : ${c.first_name} ${c.last_name}
Email : ${c.email}
Téléphone : ${c.phone}
WhatsApp : ${c.whatsapp}
Profession : ${c.profession}
Localisation : ${c.city}, ${c.country}
Éducation : ${c.education}
Expérience : ${c.experience_years} ans
Compétences : ${c.skills}
Langues : ${c.languages}
Certifications : ${c.certifications}
Score Analyse : ${c.score}/100
Statut actuel : ${c.status}

LETTRE DE MOTIVATION :
--------------------
${c.motivation_letter}
        `;
        zip.addFile('informations_candidat.txt', Buffer.from(profileInfo, 'utf8'));

        // 2. Add files from local storage or download from Cloudinary
        const files = [
            { type: 'Photo', filename: c.photo_filename },
            { type: 'CV', filename: c.cv_filename },
            { type: 'Diplome', filename: c.diploma_filename },
            { type: 'Certification', filename: c.cert_filename }
        ];

        for (const f of files) {
            if (f.filename) {
                try {
                    if (f.filename.startsWith('http')) {
                        // For Cloudinary/Remote files: we would normally download them here
                        // For this implementation, we'll just add a note if it's a URL to avoid async complexity in ZIP
                        zip.addFile(`${f.type}_link.txt`, Buffer.from(`Lien vers le document : ${f.filename}`, 'utf8'));
                    } else {
                        const filePath = path.join(__dirname, f.filename);
                        if (fs.existsSync(filePath)) {
                            zip.addLocalFile(filePath);
                        }
                    }
                } catch (e) {
                    console.error(`Error adding ${f.type}:`, e);
                }
            }
        }

        const zipBuffer = zip.toBuffer();
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename=Candidature_${c.reference_number}.zip`);
        res.send(zipBuffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/profile', (req, res) => res.json({ success: true }));
app.put('/api/admin/config', (req, res) => res.json({ success: true }));

app.get('/api/status/:ref', async (req, res) => {
    try {
        const result = await pool.query(`SELECT c.*, j.title as job_title FROM candidates c LEFT JOIN job_offers j ON c.offer_id = j.id WHERE c.reference_number = $1`, [req.params.ref]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Référence introuvable' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use((err, req, res, next) => {
    console.error('❌ GLOBAL ERROR:', err);
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload Error: ${err.message}` });
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

let appConfig = {};

async function startServer() {
    try {
        await initDb();
        
        const adminEmail = 'admin@un.org';
        const adminPass = 'admin123';
        const hashedPass = await bcrypt.hash(adminPass, 10);
        const check = await pool.query('SELECT id FROM admins WHERE email = $1', [adminEmail]);
        if (check.rows.length === 0) {
            await pool.run(`INSERT INTO admins (username, password, email, full_name, role, status, is_verified) VALUES ($1, $2, $3, $4, $5, $6, $7)`, ['admin', hashedPass, adminEmail, 'System Admin', 'super_admin', 'active', true]);
        }
        
        let appConfig = {};
        const config = await pool.query("SELECT setting_key, setting_value FROM platform_settings");
        config.rows.forEach(row => appConfig[row.setting_key] = row.setting_value);
        server.listen(PORT, () => console.log('✅ Serveur ONU lancé sur http://localhost:' + PORT));
    } catch (err) {
        console.error('❌ Start Error:', err);
        process.exit(1);
    }
}

startServer();
