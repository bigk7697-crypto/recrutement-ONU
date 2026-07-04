const { pool } = require('./database');

// Critères d'évaluation pondérés
const CRITERIA = {
    education: { weight: 25, maxScore: 25 },
    experience: { weight: 30, maxScore: 30 },
    skills: { weight: 20, maxScore: 20 },
    languages: { weight: 15, maxScore: 15 },
    motivation: { weight: 10, maxScore: 10 }
};

// Mots-clés valorisés pour chaque critère
const KEYWORDS = {
    education: {
        phd: 25,
        doctorat: 25,
        master: 20,
        mastère: 20,
        m2: 18,
        licence: 12,
        bachelor: 12,
        'bac+5': 18,
        'bac+4': 16,
        'bac+3': 12,
        ingenieur: 18,
        ingénieur: 18,
        mba: 20,
        'grandes écoles': 20,
        universite: 12,
        université: 12,
        diplome: 10,
        diplôme: 10
    },
    experience: {
        '10 ans': 30,
        '10+ ans': 30,
        '10+': 30,
        '15 ans': 28,
        '15+': 28,
        '8 ans': 25,
        '8+': 25,
        '7 ans': 22,
        '7+': 22,
        '5 ans': 20,
        '5+': 20,
        '4 ans': 16,
        '4+': 16,
        '3 ans': 14,
        '3+': 14,
        '2 ans': 10,
        '2+': 10,
        '1 an': 6,
        senior: 18,
        expert: 22,
        manager: 20,
        directeur: 22,
        directeur: 22,
        coordinateur: 18,
        chef: 16,
        lead: 18,
        consultanthumanitaire: 15,
        onu: 25,
        'nations unies': 25,
        ong: 15,
        'nations unies': 25,
        pnu: 25,
        unicef: 25,
        'oms': 25,
        who: 25,
        banque: 18,
        'mondiale': 18,
        gouvernement: 15,
        ministere: 15,
        ministère: 15,
        international: 15
    },
    skills: {
        gestion: 15,
        management: 18,
        leadership: 20,
        communication: 14,
        analytique: 16,
        analyse: 14,
        stratégique: 18,
        strategique: 18,
        négociation: 16,
        negotiation: 16,
        coordination: 16,
        programmation: 14,
        data: 15,
        reporting: 12,
        budget: 14,
        finance: 14,
        droit: 14,
        juridique: 14,
        logistique: 14,
        sante: 14,
        santé: 14,
        developpement: 15,
        développement: 15,
        humanitaire: 18,
        diplomatie: 18,
        recherche: 14,
        sql: 12,
        excel: 10,
        project: 16,
        projet: 16,
        evaluation: 14
    },
    languages: {
        anglais: 12,
        english: 12,
        français: 12,
        francais: 12,
        french: 12,
        espagnol: 10,
        spanish: 10,
        arabe: 10,
        arabic: 10,
        chinois: 10,
        chinese: 10,
        russe: 8,
        russian: 8,
        portugais: 8,
        portuguese: 8,
        bilingue: 12,
        trilingue: 14,
        multilingue: 15,
        'langues': 10,
        'fluent': 12,
        'native': 12
    },
    motivation: {
        passion: 10,
        engagement: 10,
        Nations: 10,
        unies: 10,
        développement: 8,
        développement: 8,
        durable: 8,
        paix: 10,
        justice: 8,
        humanitaire: 10,
        droits: 8,
        human: 8,
        mondial: 8,
        impact: 8,
        communauté: 6,
        communautaire: 6,
        servir: 8,
        contribuer: 8,
        changement: 8,
        inclusif: 6
    }
};

// Analyser un champ texte et retourner un score basé sur les mots-clés
function analyzeField(text, category) {
    if (!text) return 0;

    const keywords = KEYWORDS[category];
    if (!keywords) return 0;

    const textLower = text.toLowerCase();
    let score = 0;
    let foundKeywords = [];

    for (const [keyword, points] of Object.entries(keywords)) {
        if (textLower.includes(keyword.toLowerCase())) {
            if (points > score) {
                score = points;
            }
            foundKeywords.push(keyword);
        }
    }

    // Bonus pour la longueur du texte (montre l'effort fourni)
    const wordCount = text.split(/\s+/).length;
    const lengthBonus = Math.min(5, Math.floor(wordCount / 20));

    return Math.min(CRITERIA[category].maxScore, score + lengthBonus);
}

// Analyse complète d'un candidat
function analyzeCandidate(candidateData) {
    const scores = {
        education: analyzeField(candidateData.education, 'education'),
        experience: analyzeField(candidateData.experience, 'experience'),
        skills: analyzeField(candidateData.skills, 'skills'),
        languages: analyzeField(candidateData.languages, 'languages'),
        motivation: analyzeField(candidateData.motivation_letter, 'motivation')
    };

    const totalScore = Object.values(scores).reduce((sum, s) => sum + s, 0);

    // Déterminer le statut basé sur le score
    let recommendation;
    if (totalScore >= 75) {
        recommendation = 'strong_accept';
    } else if (totalScore >= 55) {
        recommendation = 'accept';
    } else if (totalScore >= 35) {
        recommendation = 'review';
    } else {
        recommendation = 'reject';
    }

    return {
        scores,
        totalScore: Math.min(100, totalScore),
        recommendation,
        details: {
            education: { score: scores.education, max: CRITERIA.education.maxScore, label: 'Formation' },
            experience: { score: scores.experience, max: CRITERIA.experience.maxScore, label: 'Expérience' },
            skills: { score: scores.skills, max: CRITERIA.skills.maxScore, label: 'Compétences' },
            languages: { score: scores.languages, max: CRITERIA.languages.maxScore, label: 'Langues' },
            motivation: { score: scores.motivation, max: CRITERIA.motivation.maxScore, label: 'Motivation' }
        }
    };
}

// Mettre à jour le score d'un candidat dans la base
async function updateCandidateScore(candidateId, analysisResult) {
    const result = await pool.query(`UPDATE candidates 
                    SET score = $1, status = $2, analyzed_at = CURRENT_TIMESTAMP 
                    WHERE id = $3`, 
                [analysisResult.totalScore, analysisResult.recommendation, candidateId]);
    return result.rowCount;
}

// Obtenir les statistiques d'analyse
async function getAnalysisStats() {
    const result = await pool.query(`SELECT 
                    COUNT(*) as total, 
                    AVG(score) as avg_score, 
                    COUNT(CASE WHEN score >= 75 THEN 1 END) as strong_accept, 
                    COUNT(CASE WHEN score >= 55 AND score < 75 THEN 1 END) as accept, 
                    COUNT(CASE WHEN score >= 35 AND score < 55 THEN 1 END) as review, 
                    COUNT(CASE WHEN score < 35 THEN 1 END) as reject 
                FROM candidates WHERE score > 0`);
    return result.rows[0];
}

module.exports = {
    analyzeCandidate,
    updateCandidateScore,
    getAnalysisStats,
    CRITERIA
};
