const QUESTIONNAIRE_ITEMS = [
  'Jestem duszą towarzystwa.',
  'Niezbyt obchodzą mnie inni ludzie.',
  'Zostawiam moje rzeczy gdzie popadnie.',
  'Zwykle jestem zrelaksowany/a.',
  'Mam bogate słownictwo.',
  'Trzymam się z boku.',
  'Jestem wyrozumiały/a dla uczuć innych ludzi.',
  'Bez zwłoki wypełniam codzienne obowiązki.',
  'Często martwię się czymś.',
  'Mam trudności ze zrozumieniem abstrakcyjnych pojęć.',
  'Rozmawiam z wieloma różnymi ludźmi na przyjęciach.',
  'Nie interesują mnie problemy innych ludzi.',
  'Często zapominam odkładać rzeczy na miejsce.',
  'Rzadko czuję się przygnębiony/a.',
  'Mam głowę pełną pomysłów.',
  'Wśród nieznajomych jestem małomówny/a.',
  'Znajduję czas dla innych.',
  'Postępuję zgodnie z harmonogramem.',
  'Często miewam huśtawki nastrojów.',
  'Nie mam zbyt bogatej wyobraźni.',
];

const EXIT_MESSAGES = {
  'Tak, jestem zarejestrowany/a':
    'Dziękujemy za chęć udziału w badaniu. Ponieważ jesteś już zarejestrowany/a jako potencjalny dawca szpiku, to badanie nie jest skierowane do Ciebie.',
  'Nie wiem / nie pamiętam':
    'Dziękujemy za chęć udziału w badaniu. Ponieważ nie jesteś pewien/pewna swojego statusu rejestracji, zachęcamy do sprawdzenia tej informacji w bazie DKMS lub Poltransplant.',
};

const consentScreen = document.querySelector('#screen-consent');
const demographicsScreen = document.querySelector('#screen-demographics');
const exitScreen = document.querySelector('#screen-exit');
const questionnaireScreen = document.querySelector('#screen-questionnaire');
const profilePreviewScreen = document.querySelector('#screen-profile-preview');
const chatScreen = document.querySelector('#screen-chat');
const registrationChoiceScreen = document.querySelector('#screen-registration-choice');

const startButton = document.querySelector('#start-button');
const statusElement = document.querySelector('#status');
const demographicsForm = document.querySelector('#demographics-form');
const demographicsButton = document.querySelector('#demographics-button');
const demographicsStatus = document.querySelector('#demographics-status');
const exitMessage = document.querySelector('#exit-message');

const questionCounter = document.querySelector('#question-counter');
const questionText = document.querySelector('#question-text');
const progressBarFill = document.querySelector('#progress-bar-fill');
const questionnaireStatus = document.querySelector('#questionnaire-status');
const previousQuestionButton = document.querySelector('#question-prev-button');
const scaleButtons = Array.from(document.querySelectorAll('.scale-option'));
const profileZValues = document.querySelector('#profile-z-values');
const profileOverview = document.querySelector('#profile-overview');
const profileGuidance = document.querySelector('#profile-guidance');
const profileContinueButton = document.querySelector('#profile-continue-button');
const chatMessagesElement = document.querySelector('#chat-messages');
const chatStatus = document.querySelector('#chat-status');
const chatInput = document.querySelector('#chat-input');
const chatSendButton = document.querySelector('#chat-send-button');
const chatCounter = document.querySelector('#chat-counter');
const chatFinishActions = document.querySelector('#chat-finish-actions');
const chatFinishButton = document.querySelector('#chat-finish-button');
const chatRationale = document.querySelector('#chat-rationale');
const debugPanel = document.querySelector('#debug-panel');
const debugMessage = document.querySelector('#debug-message');
const chatComposer = document.querySelector('.chat-composer');
const choiceNoButton = document.querySelector('#choice-no-button');
const choiceYesButton = document.querySelector('#choice-yes-button');
const registrationChoiceStatus = document.querySelector('#registration-choice-status');

let currentQuestionIndex = 0;
let questionnaireAnswers = new Array(20).fill(null);
let chatCompleted = false;

function formatNumber(value, digits = 4) {
  return Number(value).toFixed(digits);
}

function setDebugMessage(message) {
  if (!message) {
    debugPanel.classList.add('hidden');
    debugMessage.textContent = '';
    return;
  }

  debugPanel.classList.remove('hidden');
  debugMessage.textContent = message;
}

function renderProfilePreview(profile) {
  const metricRows = [
    ['Ekstrawersja', profile.zScores.EXT],
    ['Ugodowość', profile.zScores.AGREE],
    ['Sumienność', profile.zScores.CONS],
    ['Stabilność emocjonalna', profile.zScores.STAB],
    ['Intelekt', profile.zScores.INTELL],
  ];

  profileZValues.innerHTML = metricRows
    .map(
      ([label, value]) => `
        <div class="metric-row">
          <span>${label}</span>
          <strong>${formatNumber(value, 4)}</strong>
        </div>
      `
    )
    .join('');
}

function setProfileAnalysisLoading() {
  profileOverview.textContent = 'Claude przygotowuje całościowy opis profilu...';
  profileGuidance.textContent = 'Claude przygotowuje wskazówki komunikacyjne...';
}

function renderProfileAnalysis(analysis) {
  profileOverview.textContent = analysis.overview;
  profileGuidance.textContent = analysis.communicationGuidance;
}

function renderProfileAnalysisError(message) {
  profileOverview.textContent = message;
  profileGuidance.textContent = message;
}

function showScreen(screenElement) {
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.remove('is-active');
  });

  screenElement.classList.add('is-active');
}

function updateQuestionnaireView() {
  const questionNumber = currentQuestionIndex + 1;
  const currentAnswer = questionnaireAnswers[currentQuestionIndex];

  questionCounter.textContent = `Pytanie ${questionNumber} z 20`;
  questionText.textContent = QUESTIONNAIRE_ITEMS[currentQuestionIndex];
  progressBarFill.style.width = `${(questionNumber / QUESTIONNAIRE_ITEMS.length) * 100}%`;

  scaleButtons.forEach((button) => {
    const isActive = Number(button.dataset.value) === currentAnswer;
    button.classList.toggle('is-selected', isActive);
  });

  previousQuestionButton.disabled = currentQuestionIndex === 0;
}

async function createSession() {
  const response = await fetch('/api/sessions', {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Nie udało się rozpocząć sesji badania.');
  }

  return response.json();
}

async function saveDemographics(payload) {
  const sessionId = localStorage.getItem('studySessionId');

  if (!sessionId) {
    throw new Error('Brak aktywnej sesji badania. Wróć do początku.');
  }

  const response = await fetch(`/api/sessions/${sessionId}/demographics`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      [data.message, data.error].filter(Boolean).join(' | ') || 'Nie udało się zapisać danych.'
    );
  }

  return data;
}

async function saveQuestionnaireAnswers(answers) {
  const sessionId = localStorage.getItem('studySessionId');

  const response = await fetch(`/api/sessions/${sessionId}/questionnaire`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ answers }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      [data.message, data.error].filter(Boolean).join(' | ') ||
        'Nie udało się zapisać odpowiedzi.'
    );
  }

  return data;
}

async function generateProfileAnalysis() {
  const sessionId = localStorage.getItem('studySessionId');

  const response = await fetch(`/api/sessions/${sessionId}/profile-analysis`, {
    method: 'POST',
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      [data.message, data.error].filter(Boolean).join(' | ') ||
        'Nie udało się przygotować analizy profilu.'
    );
  }

  return data;
}

async function startChat() {
  const sessionId = localStorage.getItem('studySessionId');

  const response = await fetch(`/api/sessions/${sessionId}/chat/start`, {
    method: 'POST',
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      [data.message, data.error].filter(Boolean).join(' | ') ||
        'Nie udało się rozpocząć rozmowy.'
    );
  }

  return data;
}

async function sendChatMessage(content) {
  const sessionId = localStorage.getItem('studySessionId');

  const response = await fetch(`/api/sessions/${sessionId}/chat/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      [data.message, data.error].filter(Boolean).join(' | ') ||
        'Nie udało się wysłać wiadomości.'
    );
  }

  return data;
}

async function saveRegistrationChoice(registrationWillingness) {
  const sessionId = localStorage.getItem('studySessionId');

  const response = await fetch(`/api/sessions/${sessionId}/registration-choice`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ registrationWillingness }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      [data.message, data.error].filter(Boolean).join(' | ') ||
        'Nie udało się zapisać decyzji.'
    );
  }

  return data;
}

function renderChatMessages(messages) {
  const visibleMessages = messages.filter(
    (message) => message.role === 'assistant' || message.role === 'user'
  );

  chatMessagesElement.innerHTML = visibleMessages
    .map(
      (message) => `
        <article class="chat-bubble ${message.role === 'assistant' ? 'assistant' : 'user'}">
          <p>${message.content.replace(/\n/g, '<br />')}</p>
        </article>
      `
    )
    .join('');

  chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;

  const userCount = visibleMessages.filter((message) => message.role === 'user').length;
  chatCounter.textContent = userCount >= 5 ? 'Rozmowa zakończona' : `Wymiana ${userCount + 1} z 5`;
}

function setChatInputState(disabled) {
  chatInput.disabled = disabled;
  chatSendButton.disabled = disabled;
}

function renderChatRationale(rationale) {
  chatRationale.textContent =
    rationale || 'Robocze uzasadnienie pytania będzie pojawiać się tutaj.';
}

function updateChatCompletionState(isCompleted) {
  chatCompleted = isCompleted;
  chatFinishActions.classList.toggle('hidden', !isCompleted);
  setChatInputState(isCompleted);
  chatComposer.classList.toggle('hidden', isCompleted);

  if (isCompleted) {
    chatStatus.textContent =
      'Dziękuję za rozmowę. Kliknij „Dalej”, aby przejść do ostatniej części badania.';
  }
}

startButton.addEventListener('click', async () => {
  setDebugMessage('');
  startButton.disabled = true;
  statusElement.textContent = 'Rozpoczynam badanie...';

  try {
    const data = await createSession();
    localStorage.setItem('studySessionId', data.sessionId);
    statusElement.textContent = '';
    showScreen(demographicsScreen);
  } catch (error) {
    statusElement.textContent = error.message;
    setDebugMessage(`Start sesji: ${error.message}`);
    startButton.disabled = false;
  }
});

demographicsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setDebugMessage('');

  const formData = new FormData(demographicsForm);
  const age = Number(formData.get('age'));
  const gender = formData.get('gender');
  const donorStatus = formData.get('donorStatus');

  demographicsButton.disabled = true;
  demographicsStatus.textContent = 'Zapisuję dane...';

  try {
    await saveDemographics({ age, gender, donorStatus });

    if (donorStatus !== 'Nie jestem zarejestrowany/a') {
      exitMessage.textContent = EXIT_MESSAGES[donorStatus];
      showScreen(exitScreen);
      return;
    }

    demographicsStatus.textContent = '';
    currentQuestionIndex = 0;
    questionnaireAnswers = new Array(20).fill(null);
    updateQuestionnaireView();
    showScreen(questionnaireScreen);
  } catch (error) {
    demographicsStatus.textContent = error.message;
    setDebugMessage(`Demografia: ${error.message}`);
    demographicsButton.disabled = false;
  }
});

scaleButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    setDebugMessage('');
    questionnaireAnswers[currentQuestionIndex] = Number(button.dataset.value);
    questionnaireStatus.textContent = '';
    updateQuestionnaireView();

    if (currentQuestionIndex < QUESTIONNAIRE_ITEMS.length - 1) {
      setTimeout(() => {
        currentQuestionIndex += 1;
        updateQuestionnaireView();
      }, 140);
      return;
    }

    scaleButtons.forEach((scaleButton) => {
      scaleButton.disabled = true;
    });
    previousQuestionButton.disabled = true;
    questionnaireStatus.textContent = 'Zapisuję odpowiedzi i liczę profil...';

    try {
      const data = await saveQuestionnaireAnswers(questionnaireAnswers);
      questionnaireStatus.textContent = '';
      renderProfilePreview(data.profile);
      setProfileAnalysisLoading();
      scaleButtons.forEach((scaleButton) => {
        scaleButton.disabled = false;
      });
      showScreen(profilePreviewScreen);

      generateProfileAnalysis()
        .then((analysisData) => {
          renderProfileAnalysis(analysisData.analysis);
        })
        .catch((error) => {
          renderProfileAnalysisError(error.message);
          setDebugMessage(`Analiza profilu: ${error.message}`);
        });
    } catch (error) {
      questionnaireStatus.textContent = error.message;
      setDebugMessage(`Kwestionariusz: ${error.message}`);
      scaleButtons.forEach((scaleButton) => {
        scaleButton.disabled = false;
      });
      previousQuestionButton.disabled = false;
    }
  });
});

previousQuestionButton.addEventListener('click', () => {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex -= 1;
    updateQuestionnaireView();
  }
});

profileContinueButton.addEventListener('click', () => {
  setDebugMessage('');
  showScreen(chatScreen);
  chatStatus.textContent = 'Przygotowuję rozmowę...';
  chatMessagesElement.innerHTML = '';
  chatFinishActions.classList.add('hidden');
  chatInput.value = '';
  renderChatRationale('');
  setChatInputState(true);

  startChat()
    .then((data) => {
      renderChatMessages(data.messages);
      renderChatRationale(data.rationale);
      chatStatus.textContent = '';
      updateChatCompletionState(data.isCompleted);

      if (!data.isCompleted) {
        setChatInputState(false);
        chatInput.focus();
      }
    })
    .catch((error) => {
      chatStatus.textContent = error.message;
      setDebugMessage(`Start czatu: ${error.message}`);
    });
});

chatSendButton.addEventListener('click', async () => {
  const content = chatInput.value.trim();

  if (!content || chatCompleted) {
    return;
  }

  setChatInputState(true);
  chatStatus.textContent = 'Asystent pisze...';
  setDebugMessage('');

  try {
    const data = await sendChatMessage(content);
    chatInput.value = '';
    renderChatMessages(data.messages);
    renderChatRationale(data.rationale);
    chatStatus.textContent = '';
    updateChatCompletionState(data.isCompleted);

    if (!data.isCompleted) {
      setChatInputState(false);
      chatInput.focus();
    }
  } catch (error) {
    chatStatus.textContent = error.message;
    setDebugMessage(`Wiadomość czatu: ${error.message}`);
    setChatInputState(false);
  }
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatSendButton.click();
  }
});

chatFinishButton.addEventListener('click', () => {
  showScreen(registrationChoiceScreen);
});

choiceNoButton.addEventListener('click', async () => {
  registrationChoiceStatus.textContent = 'Zapisuję odpowiedź...';
  setDebugMessage('');

  try {
    await saveRegistrationChoice(false);
    registrationChoiceStatus.textContent =
      'Odpowiedź została zapisana. Ekran końcowy dodamy w następnym kroku.';
  } catch (error) {
    registrationChoiceStatus.textContent = error.message;
    setDebugMessage(`Decyzja o rejestracji: ${error.message}`);
  }
});

choiceYesButton.addEventListener('click', async () => {
  registrationChoiceStatus.textContent = 'Zapisuję odpowiedź...';
  setDebugMessage('');

  try {
    await saveRegistrationChoice(true);
    registrationChoiceStatus.textContent =
      'Odpowiedź została zapisana. Ekran wyboru terminu dodamy w następnym kroku.';
  } catch (error) {
    registrationChoiceStatus.textContent = error.message;
    setDebugMessage(`Decyzja o rejestracji: ${error.message}`);
  }
});
