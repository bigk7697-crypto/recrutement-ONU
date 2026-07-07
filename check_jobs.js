const { pool } = require('./database');
require('dotenv').config();

async function check() {
    try {
        const result = await pool.query('SELECT count(*) FROM job_offers');
        console.log('Total jobs in DB:', result.rows[0].count);
        const jobs = await pool.query('SELECT title, status FROM job_offers LIMIT 5');
        console.log('Sample jobs:', jobs.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit();
    }
}
check();
