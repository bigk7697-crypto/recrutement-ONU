const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const query = async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return { rows: result.rows };
};

const run = async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return { 
        lastID: result.rows[0]?.id, 
        changes: result.rowCount 
    };
};

async function initDb() {
    const queries = [
        `CREATE TABLE IF NOT EXISTS admins (
            id SERIAL PRIMARY KEY, 
            username TEXT UNIQUE, 
            password TEXT, 
            email TEXT UNIQUE, 
            full_name TEXT, 
            role TEXT DEFAULT 'admin', 
            status TEXT DEFAULT 'active', 
            is_verified BOOLEAN DEFAULT FALSE, 
            verification_token TEXT, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS job_offers (
            id SERIAL PRIMARY KEY, 
            title TEXT, 
            department TEXT, 
            location TEXT, 
            type TEXT, 
            description TEXT, 
            requirements TEXT, 
            salary_range TEXT, 
            deadline DATE, 
            status TEXT DEFAULT 'active', 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS candidates (
            id SERIAL PRIMARY KEY, 
            reference_number TEXT UNIQUE, 
            first_name TEXT, 
            last_name TEXT, 
            email TEXT, 
            phone TEXT, 
            whatsapp TEXT, 
            profession TEXT, 
            country TEXT, 
            city TEXT, 
            education TEXT, 
            experience TEXT, 
            experience_years INTEGER, 
            skills TEXT, 
            languages TEXT, 
            certifications TEXT, 
            motivation_letter TEXT, 
            cv_filename TEXT, 
            diploma_filename TEXT, 
            cert_filename TEXT, 
            photo_filename TEXT, 
            offer_id INTEGER, 
            status TEXT DEFAULT 'En attente d''analyse', 
            score INTEGER DEFAULT 0, 
            analyzed_at TIMESTAMP, 
            decision TEXT, 
            decision_date TIMESTAMP, 
            rejection_reason TEXT, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS platform_settings (
            setting_key TEXT PRIMARY KEY, 
            setting_value TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS email_logs (
            id SERIAL PRIMARY KEY, 
            candidate_id INTEGER, 
            type TEXT, 
            recipient TEXT, 
            subject TEXT, 
            body TEXT, 
            status TEXT, 
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ];
    for (let q of queries) await pool.query(q);
}

async function getSetting(key) {
    const result = await query('SELECT setting_value FROM platform_settings WHERE setting_key = $1', [key]);
    return result.rows.length > 0 ? result.rows[0].setting_value : null;
}

module.exports = { pool, query, run, initDb, getSetting };
