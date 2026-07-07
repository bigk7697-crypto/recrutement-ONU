const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'onu_recruitment.db');
const db = new sqlite3.Database(dbPath);

const query = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve({ rows });
        });
    });
};

const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
};

async function initDb() {
    const queries = [
        `CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, email TEXT UNIQUE, full_name TEXT, role TEXT DEFAULT 'admin', status TEXT DEFAULT 'active', is_verified BOOLEAN DEFAULT FALSE, verification_token TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS job_offers (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, department TEXT, location TEXT, type TEXT, description TEXT, requirements TEXT, salary_range TEXT, deadline DATE, status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, reference_number TEXT UNIQUE, first_name TEXT, last_name TEXT, email TEXT, phone TEXT, whatsapp TEXT, profession TEXT, country TEXT, city TEXT, education TEXT, experience TEXT, experience_years INTEGER, skills TEXT, languages TEXT, certifications TEXT, motivation_letter TEXT, cv_filename TEXT, diploma_filename TEXT, cert_filename TEXT, photo_filename TEXT, offer_id INTEGER, status TEXT DEFAULT 'En attente d''analyse', score INTEGER DEFAULT 0, analyzed_at DATETIME, decision TEXT, decision_date DATETIME, rejection_reason TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS platform_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT)`,
        `CREATE TABLE IF NOT EXISTS email_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER, type TEXT, recipient TEXT, subject TEXT, body TEXT, status TEXT, sent_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
    ];
    for (let q of queries) await run(q);
}

async function getSetting(key) {
    const result = await query('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key]);
    return result.rows.length > 0 ? result.rows[0].setting_value : null;
}

module.exports = { pool: { query, run }, initDb, getSetting };
