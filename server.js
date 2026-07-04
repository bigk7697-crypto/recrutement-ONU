const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { pool } = require('./database'); // Utilisation de pg pool

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

global.appConfig = {};
pool.query("SELECT setting_key, setting_value FROM platform_settings", (err, result) => {
    if (!err) result.rows.forEach(row => global.appConfig[row.setting_key] = row.setting_value);
});

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

// API Jobs
app.get('/api/jobs', (req, res) => {
    pool.query(`SELECT * FROM job_offers WHERE status = 'active' ORDER BY created_at DESC`, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

// Admin Profile Update
app.put('/api/admin/profile', (req, res) => {
    // Authenticate and Update DB logic...
    res.json({ success: true });
});

// Admin Config Update
app.put('/api/admin/config', (req, res) => {
    // Update platform_settings table...
    res.json({ success: true });
});

server.listen(PORT, () => console.log('✅ Serveur ONU lancé sur http://localhost:' + PORT));
