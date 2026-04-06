require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { pool, testDatabaseConnection } = require('./db');
const { calculateProfile } = require('./scoring');
const { buildSystemPrompt, buildProfileAnalysisPrompt } = require('./promptBuilder');

const app = express();
const port = process.env.PORT || 3000;
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function getDirectionLabel(value) {
  return Number(value) >= 0 ? 'wysoki' : 'niski';
}

async function getSessionBySessionId(sessionId) {
  const [rows] = await pool.execute('SELECT * FROM study_sessions WHERE session_id = ? LIMIT 1', [
    sessionId,
  ]);

  return rows[0] || null;
}

async function getChatMessages(studySessionId) {
  const [rows] = await pool.execute(
    `
      SELECT id, message_order, exchange_number, role, content, created_at
      FROM chat_messages
      WHERE study_session_id = ?
      ORDER BY message_order ASC
    `,
    [studySessionId]
  );

  return rows;
}

async function insertChatMessage(studySessionId, role, content, exchangeNumber) {
  const [maxRows] = await pool.execute(
    'SELECT COALESCE(MAX(message_order), 0) AS maxOrder FROM chat_messages WHERE study_session_id = ?',
    [studySessionId]
  );

  const nextOrder = Number(maxRows[0].maxOrder) + 1;

  await pool.execute(
    `
      INSERT INTO chat_messages (
        study_session_id,
        message_order,
        exchange_number,
        role,
        content
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [studySessionId, nextOrder, exchangeNumber, role, content]
  );
}

function buildProfileResponse(session) {
  const traits = [
    {
      code: 'EXT',
      label: 'Ekstrawersja',
      zScore: Number(session.z_ext),
      weight: Number(session.w_ext),
    },
    {
      code: 'AGREE',
      label: 'Ugodowość',
      zScore: Number(session.z_agree),
      weight: Number(session.w_agree),
    },
    {
      code: 'CONS',
      label: 'Sumienność',
      zScore: Number(session.z_cons),
      weight: Number(session.w_cons),
    },
    {
      code: 'STAB',
      label: 'Stabilność emocjonalna',
      zScore: Number(session.z_stab),
      weight: Number(session.w_stab),
    },
    {
      code: 'INTELL',
      label: 'Intelekt',
      zScore: Number(session.z_intell),
      weight: Number(session.w_intell),
    },
  ].map((item) => ({
    ...item,
    direction: getDirectionLabel(item.zScore),
  }));

  return {
    rawScores: {
      EXT: Number(session.ext_score),
      AGREE: Number(session.agree_score),
      CONS: Number(session.cons_score),
      STAB: Number(session.stab_score),
      INTELL: Number(session.intell_score),
    },
    zScores: {
      EXT: Number(session.z_ext),
      AGREE: Number(session.z_agree),
      CONS: Number(session.z_cons),
      STAB: Number(session.z_stab),
      INTELL: Number(session.z_intell),
    },
    weights: {
      EXT: Number(session.w_ext),
      AGREE: Number(session.w_agree),
      CONS: Number(session.w_cons),
      STAB: Number(session.w_stab),
      INTELL: Number(session.w_intell),
    },
    profileType: session.profile_type,
    dominantTrait: session.dominant_trait,
    ranking: traits.sort((a, b) => b.weight - a.weight),
  };
}

function buildAnthropicMessagesFromHistory(history) {
  return history
    .filter((message) => message.role === 'assistant' || message.role === 'user')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

async function createAnthropicResponse(systemPrompt, messages, maxTokens = 400) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('TU_WPISZ')) {
    throw new Error('Anthropic API key is missing in .env');
  }

  const response = await anthropic.messages.create({
    model: anthropicModel,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  const textParts = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text.trim())
    .filter(Boolean);

  return textParts.join('\n\n');
}

function parseJsonFromText(text) {
  const trimmed = text.trim();
  const normalized = trimmed
    .replace(/\\`/g, '`')
    .replace(/^`{3}json\s*/i, '')
    .replace(/^`{3}\s*/i, '')
    .replace(/\s*`{3}$/i, '')
    .trim();

  try {
    return JSON.parse(normalized);
  } catch (originalError) {
    const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

    if (fencedMatch) {
      try {
        return JSON.parse(fencedMatch[1].trim());
      } catch (fencedError) {
        // Continue to fallback extraction below.
      }
    }

    const startIndex = normalized.indexOf('{');
    const endIndex = normalized.lastIndexOf('}');

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      try {
        return JSON.parse(normalized.slice(startIndex, endIndex + 1));
      } catch (sliceError) {
        // Fall through to enriched error below.
      }
    }

    const excerpt = normalized.slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(`${originalError.message} | Raw response: ${excerpt}`);
  }
}

function extractJsonStringValue(rawText, key) {
  const keyIndex = rawText.indexOf(`"${key}"`);

  if (keyIndex === -1) {
    return null;
  }

  const colonIndex = rawText.indexOf(':', keyIndex);

  if (colonIndex === -1) {
    return null;
  }

  const firstQuoteIndex = rawText.indexOf('"', colonIndex + 1);

  if (firstQuoteIndex === -1) {
    return null;
  }

  let value = '';
  let escaped = false;

  for (let index = firstQuoteIndex + 1; index < rawText.length; index += 1) {
    const character = rawText[index];

    if (escaped) {
      value += character;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '"') {
      return value;
    }

    value += character;
  }

  return null;
}

function parseExpectedFieldsFromMalformedJson(rawText, keys) {
  const result = {};

  keys.forEach((key) => {
    const extracted = extractJsonStringValue(rawText, key);

    if (extracted !== null) {
      result[key] = extracted;
    }
  });

  return result;
}

async function generateProfileAnalysisForSession(session) {
  const analysisPrompt = buildProfileAnalysisPrompt(session);
  const analysisText = await createAnthropicResponse(
    analysisPrompt,
    [
      {
        role: 'user',
        content:
          'Przygotuj krótki, całościowy opis osoby oraz wskazówki komunikacyjne. Zwróć wyłącznie poprawny JSON.',
      },
    ],
    1400
  );

  let parsed;

  try {
    parsed = parseJsonFromText(analysisText);
  } catch (error) {
    parsed = parseExpectedFieldsFromMalformedJson(analysisText, [
      'overview',
      'communicationGuidance',
    ]);

    if (!parsed.overview || !parsed.communicationGuidance) {
      throw error;
    }
  }

  const analysis = {
    overview: parsed.overview || '',
    communicationGuidance: parsed.communicationGuidance || '',
  };

  if (session.id) {
    await pool.execute(
      `
        UPDATE study_sessions
        SET
          profile_overview = ?,
          communication_guidance = ?
        WHERE id = ?
      `,
      [analysis.overview, analysis.communicationGuidance, session.id]
    );
  }

  return analysis;
}

async function generateChatTurn(systemPrompt, messages) {
  const responseText = await createAnthropicResponse(systemPrompt, messages);
  let parsed;

  try {
    parsed = parseJsonFromText(responseText);
  } catch (error) {
    parsed = parseExpectedFieldsFromMalformedJson(responseText, [
      'assistantMessage',
      'rationale',
    ]);

    if (!parsed.assistantMessage || !parsed.rationale) {
      throw error;
    }
  }

  return {
    assistantMessage: parsed.assistantMessage || '',
    rationale: parsed.rationale || '',
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Backend is running.',
    port,
  });
});

app.get('/api/db-health', async (req, res) => {
  try {
    await testDatabaseConnection();

    res.json({
      ok: true,
      message: 'Database connection is working.',
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: 'Database connection failed.',
      error: error.message,
    });
  }
});

app.post('/api/sessions', async (req, res) => {
  const sessionId = crypto.randomUUID();

  try {
    await pool.execute(
      `
        INSERT INTO study_sessions (
          session_id,
          started_at,
          completed
        )
        VALUES (?, NOW(), 0)
      `,
      [sessionId]
    );

    res.status(201).json({
      ok: true,
      sessionId,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: 'Could not create study session.',
      error: error.message,
    });
  }
});

app.patch('/api/sessions/:sessionId/demographics', async (req, res) => {
  const { sessionId } = req.params;
  const { age, gender, donorStatus } = req.body;

  const allowedGenders = ['Kobieta', 'Mężczyzna'];
  const allowedDonorStatuses = [
    'Tak, jestem zarejestrowany/a',
    'Nie jestem zarejestrowany/a',
    'Nie wiem / nie pamiętam',
  ];

  if (!Number.isInteger(age) || age < 18 || age > 55) {
    return res.status(400).json({
      ok: false,
      message: 'Age must be an integer between 18 and 55.',
    });
  }

  if (!allowedGenders.includes(gender)) {
    return res.status(400).json({
      ok: false,
      message: 'Gender must be "Kobieta" or "Mężczyzna".',
    });
  }

  if (!allowedDonorStatuses.includes(donorStatus)) {
    return res.status(400).json({
      ok: false,
      message: 'Donor status has an invalid value.',
    });
  }

  try {
    const [result] = await pool.execute(
      `
        UPDATE study_sessions
        SET
          age = ?,
          gender = ?,
          donor_status = ?
        WHERE session_id = ?
      `,
      [age, gender, donorStatus, sessionId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        message: 'Study session not found.',
      });
    }

    return res.json({
      ok: true,
      message: 'Demographic data saved.',
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Could not save demographic data.',
      error: error.message,
    });
  }
});

app.patch('/api/sessions/:sessionId/questionnaire', async (req, res) => {
  const { sessionId } = req.params;
  const { answers } = req.body;

  if (!Array.isArray(answers) || answers.length !== 20) {
    return res.status(400).json({
      ok: false,
      message: 'Answers must be an array with exactly 20 values.',
    });
  }

  const hasInvalidAnswer = answers.some(
    (value) => !Number.isInteger(value) || value < 1 || value > 5
  );

  if (hasInvalidAnswer) {
    return res.status(400).json({
      ok: false,
      message: 'Each answer must be an integer between 1 and 5.',
    });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT gender FROM study_sessions WHERE session_id = ? LIMIT 1',
      [sessionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: 'Study session not found.',
      });
    }

    const gender = rows[0].gender;

    if (!gender) {
      return res.status(400).json({
        ok: false,
        message: 'Gender must be saved before questionnaire scoring.',
      });
    }

    const profile = calculateProfile(gender, answers);

    await pool.execute(
      `
        UPDATE study_sessions
        SET
          item_01 = ?, item_02 = ?, item_03 = ?, item_04 = ?, item_05 = ?,
          item_06 = ?, item_07 = ?, item_08 = ?, item_09 = ?, item_10 = ?,
          item_11 = ?, item_12 = ?, item_13 = ?, item_14 = ?, item_15 = ?,
          item_16 = ?, item_17 = ?, item_18 = ?, item_19 = ?, item_20 = ?,
          ext_score = ?, agree_score = ?, cons_score = ?, stab_score = ?, intell_score = ?,
          z_ext = ?, z_agree = ?, z_cons = ?, z_stab = ?, z_intell = ?,
          w_ext = ?, w_agree = ?, w_cons = ?, w_stab = ?, w_intell = ?,
          profile_type = ?,
          dominant_trait = ?
        WHERE session_id = ?
      `,
      [
        ...answers,
        profile.rawScores.EXT,
        profile.rawScores.AGREE,
        profile.rawScores.CONS,
        profile.rawScores.STAB,
        profile.rawScores.INTELL,
        profile.zScores.EXT,
        profile.zScores.AGREE,
        profile.zScores.CONS,
        profile.zScores.STAB,
        profile.zScores.INTELL,
        profile.weights.EXT,
        profile.weights.AGREE,
        profile.weights.CONS,
        profile.weights.STAB,
        profile.weights.INTELL,
        profile.profileType,
        profile.dominantTrait,
        sessionId,
      ]
    );

    const updatedSession = await getSessionBySessionId(sessionId);

    return res.json({
      ok: true,
      message: 'Questionnaire answers and profile saved.',
      profile: buildProfileResponse(updatedSession),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Could not save questionnaire data.',
      error: error.message,
    });
  }
});

app.post('/api/sessions/:sessionId/profile-analysis', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await getSessionBySessionId(sessionId);

    if (!session) {
      return res.status(404).json({
        ok: false,
        message: 'Study session not found.',
      });
    }

    if (
      session.z_ext === null ||
      session.z_agree === null ||
      session.z_cons === null ||
      session.z_stab === null ||
      session.z_intell === null
    ) {
      return res.status(400).json({
        ok: false,
        message: 'Questionnaire profile must be calculated before profile analysis.',
      });
    }

    return res.json({
      ok: true,
      analysis: await generateProfileAnalysisForSession(session),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Could not generate profile analysis.',
      error: error.message,
    });
  }
});

app.post('/api/sessions/:sessionId/chat/start', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await getSessionBySessionId(sessionId);

    if (!session) {
      return res.status(404).json({
        ok: false,
        message: 'Study session not found.',
      });
    }

    let history = await getChatMessages(session.id);

    if (history.length === 0) {
      const analysis = await generateProfileAnalysisForSession(session);
      const systemPrompt = buildSystemPrompt(session, analysis);

      await pool.execute(
        'UPDATE study_sessions SET system_prompt_used = ? WHERE id = ?',
        [systemPrompt, session.id]
      );

      const chatTurn = await generateChatTurn(systemPrompt, [
        {
          role: 'user',
          content:
            'Uczestnik właśnie otworzył czat. Przywitaj się krótko i ciepło, a następnie zapytaj, co wie o dawstwie szpiku kostnego lub z czym mu się ono kojarzy.',
        },
      ]);

      await insertChatMessage(session.id, 'assistant', chatTurn.assistantMessage, 1);
      history = await getChatMessages(session.id);

      return res.json({
        ok: true,
        messages: history,
        isCompleted: false,
        rationale: chatTurn.rationale,
      });
    }

    const userMessageCount = history.filter((message) => message.role === 'user').length;

    return res.json({
      ok: true,
      messages: history,
      isCompleted: userMessageCount >= 5,
      rationale: '',
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Could not start chat.',
      error: error.message,
    });
  }
});

app.post('/api/sessions/:sessionId/chat/message', async (req, res) => {
  const { sessionId } = req.params;
  const { content } = req.body;

  if (!content || !String(content).trim()) {
    return res.status(400).json({
      ok: false,
      message: 'Message content is required.',
    });
  }

  try {
    const session = await getSessionBySessionId(sessionId);

    if (!session) {
      return res.status(404).json({
        ok: false,
        message: 'Study session not found.',
      });
    }

    let history = await getChatMessages(session.id);
    const userMessageCountBeforeInsert = history.filter((message) => message.role === 'user').length;

    if (userMessageCountBeforeInsert >= 5) {
      return res.status(400).json({
        ok: false,
        message: 'Chat is already completed.',
      });
    }

    const nextUserCount = userMessageCountBeforeInsert + 1;
    await insertChatMessage(session.id, 'user', String(content).trim(), nextUserCount);

    history = await getChatMessages(session.id);
    let systemPrompt = session.system_prompt_used;

    if (!systemPrompt) {
      const analysis = await generateProfileAnalysisForSession(session);
      systemPrompt = buildSystemPrompt(session, analysis);
      await pool.execute('UPDATE study_sessions SET system_prompt_used = ? WHERE id = ?', [
        systemPrompt,
        session.id,
      ]);
    }

    const chatTurn = await generateChatTurn(
      systemPrompt,
      buildAnthropicMessagesFromHistory(history)
    );

    await insertChatMessage(session.id, 'assistant', chatTurn.assistantMessage, nextUserCount);

    const updatedHistory = await getChatMessages(session.id);
    const userMessageCount = updatedHistory.filter((message) => message.role === 'user').length;

    return res.json({
      ok: true,
      messages: updatedHistory,
      isCompleted: userMessageCount >= 5,
      rationale: chatTurn.rationale,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Could not send chat message.',
      error: error.message,
    });
  }
});

app.patch('/api/sessions/:sessionId/registration-choice', async (req, res) => {
  const { sessionId } = req.params;
  const { registrationWillingness } = req.body;

  if (typeof registrationWillingness !== 'boolean') {
    return res.status(400).json({
      ok: false,
      message: 'registrationWillingness must be a boolean.',
    });
  }

  try {
    const [result] = await pool.execute(
      `
        UPDATE study_sessions
        SET registration_willingness = ?
        WHERE session_id = ?
      `,
      [registrationWillingness ? 1 : 0, sessionId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        message: 'Study session not found.',
      });
    }

    return res.json({
      ok: true,
      message: 'Registration choice saved.',
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Could not save registration choice.',
      error: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
