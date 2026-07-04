const nodemailer = require('nodemailer');
const { pool, getSetting } = require('./database');

// Configuration du transporteur email (à personnaliser avec tes infos SMTP)
// Pour Gmail : activer "Accès moins sécurisé" ou utiliser un "App Password"
// Note: Utilise désormais getSetting() défini dans server.js
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    connectionTimeout: 5000, // 5 secondes max pour la connexion
    greetingTimeout: 5000,
    socketTimeout: 5000,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Vérifier la connexion email
transporter.verify((error, success) => {
    if (error) {
        console.log('⚠️  Email non configuré - les emails seront simulés en mode développement');
        console.log('   Pour activer les emails : configure EMAIL_USER et EMAIL_PASS dans les variables d\'environnement');
    } else {
        console.log('✅ Serveur email prêt');
    }
});

// Envoyer un email
async function sendEmail(to, subject, htmlContent, candidateId, type) {
    const mailOptions = {
        from: `"United Nations Recruitment" <${process.env.EMAIL_USER || 'recruitment@un.org'}>`,
        to: to,
        subject: subject,
        html: htmlContent
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`📧 [SUCCESS] Email envoyé à ${to}. ID: ${info.messageId}`);
        
        await pool.query(`INSERT INTO email_logs (candidate_id, type, recipient, subject, body, status) 
                VALUES ($1, $2, $3, $4, $5, 'sent')`, 
            [candidateId, type, to, subject, htmlContent]);

        return { success: true, simulated: false, messageId: info.messageId };
    } catch (error) {
        console.error(`❌ [EMAIL ERROR] Échec d'envoi à ${to}:`, error.message);
        console.error(`Détails techniques:`, error);

        await pool.query(`INSERT INTO email_logs (candidate_id, type, recipient, subject, body, status) 
                VALUES ($1, $2, $3, $4, $5, 'failed')`, 
            [candidateId, type, to, subject, htmlContent]);

        return { success: false, simulated: false, error: error.message };
    }

}

// Email d'accusé de réception
async function sendAcknowledgmentEmail(candidate) {
    const subject = `[ONU] Accusé de réception - Référence: ${candidate.reference_number}`;
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; }
            .header { background: #009edb; color: white; padding: 30px; text-align: center; }
            .header img { max-width: 80px; }
            .body { padding: 30px; }
            .ref-box { background: #e8f4f8; border-left: 4px solid #009edb; padding: 15px; margin: 20px 0; }
            .footer { background: #f8f8f8; padding: 20px; text-align: center; font-size: 12px; color: #666; }
            h1 { margin: 0; font-size: 20px; }
            h2 { color: #009edb; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>联合国</h1>
                <h1 style="font-size:16px; font-weight:normal;">United Nations</h1>
            </div>
            <div class="body">
                <h2>Accusé de réception de votre candidature</h2>
                <p>Cher(e) ${candidate.first_name} ${candidate.last_name},</p>
                <p>Nous accusons bonne réception de votre candidature soumise dans le cadre de notre processus de recrutement. Votre dossier est actuellement en cours d'examen par notre équipe.</p>
                <div class="ref-box">
                    <strong>Votre numéro de référence :</strong><br>
                    <span style="font-size:18px; color: #009edb; font-weight:bold;">${candidate.reference_number}</span><br><br>
                    <em>Conservez ce numéro pour suivre l'état de votre candidature.</em>
                </div>
                <p>Vous recevrez une notification par email dès qu'une décision sera prise concernant votre candidature. Le processus d'évaluation peut prendre plusieurs semaines.</p>
                <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
                <p>Cordialement,<br><strong>L'équipe de recrutement<br>Organisation des Nations Unies</strong></p>
            </div>
            <div class="footer">
                <p>© ${new Date().getFullYear()} Organisation des Nations Unies. Tous droits réservés.</p>
                <p>Ce message a été envoyé automatiquement. Merci de ne pas y répondre directement.</p>
            </div>
        </div>
    </body>
    </html>`;

    return await sendEmail(candidate.email, subject, html, candidate.id, 'acknowledgment');
}

// Email d'acceptation
async function sendAcceptanceEmail(candidate) {
    const subject = `[ONU] Félicitations - Votre candidature a été retenue - Réf: ${candidate.reference_number}`;
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; }
            .header { background: #4CAF50; color: white; padding: 30px; text-align: center; }
            .body { padding: 30px; }
            .success-box { background: #e8f5e9; border-left: 4px solid #4CAF50; padding: 15px; margin: 20px 0; }
            .footer { background: #f8f8f8; padding: 20px; text-align: center; font-size: 12px; color: #666; }
            h1 { margin: 0; }
            h2 { color: #4CAF50; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎉 Félicitations !</h1>
                <p style="margin:5px 0 0;">Organisation des Nations Unies</p>
            </div>
            <div class="body">
                <h2>Votre candidature a été retenue</h2>
                <p>Cher(e) ${candidate.first_name} ${candidate.last_name},</p>
                <p>Nous avons le plaisir de vous informer que votre candidature (référence: <strong>${candidate.reference_number}</strong>) a été sélectionnée lors de notre processus de recrutement.</p>
                <div class="success-box">
                    <strong>Prochaines étapes :</strong>
                    <ul>
                        <li>Vous recevrez sous peu un email détaillant les modalités de votre intégration</li>
                        <li>Préparez les documents nécessaires pour votre dossier administratif</li>
                        <li>Un entretien de briefing sera programmé avec votre futur responsable</li>
                    </ul>
                </div>
                <p>Félicitations pour cette sélection. Nous avons hâte de vous accueillir au sein de l'Organisation des Nations Unies.</p>
                <p>Cordialement,<br><strong>L'équipe de recrutement<br>Organisation des Nations Unies</strong></p>
            </div>
            <div class="footer">
                <p>© ${new Date().getFullYear()} Organisation des Nations Unies. Tous droits réservés.</p>
            </div>
        </div>
    </body>
    </html>`;

    return await sendEmail(candidate.email, subject, html, candidate.id, 'acceptance');
}

// Email de rejet
async function sendRejectionEmail(candidate, reason) {
    const subject = `[ONU] Suite à votre candidature - Réf: ${candidate.reference_number}`;
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; }
            .header { background: #009edb; color: white; padding: 30px; text-align: center; }
            .body { padding: 30px; }
            .info-box { background: #e8f4f8; border-left: 4px solid #009edb; padding: 15px; margin: 20px 0; }
            .footer { background: #f8f8f8; padding: 20px; text-align: center; font-size: 12px; color: #666; }
            h1 { margin: 0; }
            h2 { color: #009edb; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Organisation des Nations Unies</h1>
                <p style="margin:5px 0 0;">Division du Recrutement</p>
            </div>
            <div class="body">
                <h2>Suite à votre candidature</h2>
                <p>Cher(e) ${candidate.first_name} ${candidate.last_name},</p>
                <p>Nous vous remercions de l'intérêt que vous avez porté à l'Organisation des Nations Unies en soumettant votre candidature (référence: <strong>${candidate.reference_number}</strong>).</p>
                <p>Après un examen attentif de votre dossier, nous regrettons de vous informer que nous ne sommes pas en mesure de donner suite à votre candidature à ce stade de notre processus de sélection.</p>
                ${reason ? `<div class="info-box"><strong>Observations :</strong><br>${reason}</div>` : ''}
                <p>Cette décision ne remet pas en cause la qualité de votre profil. Nous conservons votre dossier et pourrions vous recontacter si des opportunités correspondant à votre profil se présentent à l'avenir.</p>
                <p>Nous vous encourageons à consulter régulièrement notre portail de recrutement pour de nouvelles opportunités.</p>
                <p>Cordialement,<br><strong>L'équipe de recrutement<br>Organisation des Nations Unies</strong></p>
            </div>
            <div class="footer">
                <p>© ${new Date().getFullYear()} Organisation des Nations Unies. Tous droits réservés.</p>
            </div>
        </div>
    </body>
    </html>`;

    return await sendEmail(candidate.email, subject, html, candidate.id, 'rejection');
}

// Email de vérification de compte
async function sendVerificationEmail(admin, token) {
    const verificationUrl = `${process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'}/api/admin/verify-email?token=${token}`;
    const subject = `[ONU] Vérification de votre compte administrateur`;
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; }
            .header { background: #009edb; color: white; padding: 30px; text-align: center; }
            .body { padding: 30px; text-align: center; }
            .btn { display: inline-block; padding: 15px 25px; background: #009edb; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
            .footer { background: #f8f8f8; padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Vérification de Compte</h1>
                <p>Organisation des Nations Unies</p>
            </div>
            <div class="body">
                <h2>Bienvenue, ${admin.full_name}</h2>
                <p>Pour activer votre accès administrateur, veuillez cliquer sur le bouton ci-dessous :</p>
                <a href="${verificationUrl}" class="btn">Vérifier mon compte</a>
                <p>Ce lien expirera dans 24 heures.</p>
            </div>
            <div class="footer">
                <p>© ${new Date().getFullYear()} ONU. Tous droits réservés.</p>
            </div>
        </div>
    </body>
    </html>`;

    return await sendEmail(admin.email, subject, html, null, 'verification');
}

module.exports = {
    sendEmail,
    sendAcknowledgmentEmail,
    sendAcceptanceEmail,
    sendRejectionEmail,
    sendVerificationEmail
};
