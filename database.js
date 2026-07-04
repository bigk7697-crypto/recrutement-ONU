const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Requis pour la plupart des providers cloud (Neon, Supabase)
});

// Initialisation des tables (doit être exécuté une seule fois à la mise en place)
async function initDb() {
    const queries = [
        `CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT, email TEXT UNIQUE, full_name TEXT, role TEXT DEFAULT 'admin', status TEXT DEFAULT 'active', is_verified BOOLEAN DEFAULT FALSE, verification_token TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS job_offers (id SERIAL PRIMARY KEY, title TEXT, department TEXT, location TEXT, type TEXT, description TEXT, requirements TEXT, salary_range TEXT, deadline DATE, status TEXT DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS candidates (id SERIAL PRIMARY KEY, reference_number TEXT UNIQUE, first_name TEXT, last_name TEXT, email TEXT UNIQUE, phone TEXT, whatsapp TEXT, profession TEXT, country TEXT, city TEXT, education TEXT, experience TEXT, experience_years INTEGER, skills TEXT, languages TEXT, certifications TEXT, motivation_letter TEXT, cv_filename TEXT, diploma_filename TEXT, cert_filename TEXT, offer_id INTEGER, status TEXT DEFAULT 'En attente d''analyse', score INTEGER DEFAULT 0, analyzed_at TIMESTAMP, decision TEXT, decision_date TIMESTAMP, rejection_reason TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS platform_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT)`,
        `CREATE TABLE IF NOT EXISTS email_logs (id SERIAL PRIMARY KEY, candidate_id INTEGER, type TEXT, recipient TEXT, subject TEXT, body TEXT, status TEXT, sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    ];
    for (let q of queries) await pool.query(q);

    // Migration : S'assurer que les nouvelles colonnes existent pour les installations existantes
    try {
        await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin'`);
        await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
        await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS verification_token TEXT`);
    } catch (err) {
        console.log('Schema update: some columns already existed or update failed');
    }
}

async function getSetting(key) {
    const result = await pool.query('SELECT setting_value FROM platform_settings WHERE setting_key = $1', [key]);
    return result.rows.length > 0 ? result.rows[0].setting_value : null;
}

module.exports = { pool, initDb, getSetting };
