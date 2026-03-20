# Museum of Science Fiction — Virtual Guide (Backend)

Serverless-бэкенд для виртуального гида музея научной фантастики.  
Unity-приложение отправляет вопрос (текст или голос) → Firebase Cloud Function
передаёт его в OpenAI вместе с данными об экспонатах → возвращает ответ
(текст или голос).

---

## Архитектура

```
Unity App
   │  HTTPS callable
   ▼
Firebase Cloud Function
   ├── museumGuide            (текст → текст)
   │     1. Читает экспонаты из Firestore
   │     2. Формирует контекст + системный промпт
   │     3. Вызывает OpenAI GPT → ответ
   │
   ├── museumGuideWithAudio   (текст → текст + аудио)
   │     1. Читает экспонаты из Firestore
   │     2. GPT → генерация ответа
   │     3. TTS → синтез речи
   │
   └── museumVoiceGuide       (голос → текст + аудио)
         1. Whisper STT  → расшифровка аудио
         2. Читает экспонаты из Firestore
         3. GPT           → генерация ответа
         4. TTS           → синтез речи
   ▼
Ответ (текст + аудио) → Unity UI
```

| Компонент          | Технология                        |
|--------------------|-----------------------------------|
| Cloud Functions    | Firebase Functions v2 (Node 24)   |
| База данных        | Cloud Firestore                   |
| AI-модель (текст)  | OpenAI gpt-4o-mini                |
| AI-модель (STT)    | OpenAI Whisper                    |
| AI-модель (TTS)    | ElevenLabs (eleven_multilingual_v2) |
| Секреты            | Firebase Secret Manager             |
| Клиент             | Unity (C#) + Firebase SDK         |

---

## Структура проекта

```
Firebase/
├── firebase.json                   # конфигурация Firebase
├── firestore.rules                 # правила доступа Firestore
├── firestore.indexes.json          # индексы Firestore
├── VR Museum ... Database.csv      # CSV с данными экспонатов
└── functions/
    ├── package.json
    ├── tsconfig.json
    ├── .eslintrc.js
    └── src/
        ├── index.ts                # Cloud Functions (museumGuide + museumVoiceGuide)
        └── uploadFacts.ts          # утилита загрузки CSV → Firestore
```

---

## Первоначальная настройка

### 1. Установка зависимостей

```bash
cd functions
npm install
```

### 2. Авторизация Firebase CLI

```bash
firebase login
firebase use <YOUR_PROJECT_ID>
```

### 3. Задать API-ключи

```bash
# Ключ OpenAI (GPT + Whisper)
firebase functions:secrets:set MUSEUM_AI

# Ключ ElevenLabs (TTS)
firebase functions:secrets:set ELEVENLABS_KEY
```

Ключи хранятся в Google Secret Manager и доступны только Cloud Function.

### 4. Загрузить данные экспонатов в Firestore

```bash
cd functions
npm run build
node lib/uploadFacts.js
```

Скрипт:
- Парсит CSV-файл (360+ строк)
- Фильтрует реальные экспонаты (~117 шт.)
- Загружает каждый в коллекцию `museumFacts` через REST API
- Безопасен для повторного запуска (upsert по document ID)

> Если токен истёк (ошибка 401), выполните `firebase login --reauth`
> и повторите загрузку.

### 5. Деплой функции

```bash
cd ..   # корень проекта (Firebase/)
firebase deploy --only functions
```

---

## Обновление и деплой

### Обновить код функции

1. Отредактируйте `functions/src/index.ts`
2. Задеплойте:
   ```bash
   firebase deploy --only functions
   ```
   Predeploy автоматически запустит lint и build.

### Обновить данные экспонатов

1. Обновите CSV-файл в корне проекта
2. Пересоберите и запустите загрузку:
   ```bash
   cd functions
   npm run build
   node lib/uploadFacts.js
   ```
3. Данные обновятся в Firestore мгновенно — **передеплой функции не нужен**.

### Обновить API-ключи

```bash
# OpenAI (GPT + Whisper)
firebase functions:secrets:set MUSEUM_AI
firebase deploy --only functions

# ElevenLabs (TTS)
firebase functions:secrets:set ELEVENLABS_KEY
firebase deploy --only functions
```

### Сменить модель AI

В `functions/src/index.ts` измените строку:
```typescript
model: "gpt-4o-mini",    // → "gpt-4o" для лучшего качества
max_output_tokens: 350,  // → увеличьте при необходимости
```
Затем `firebase deploy --only functions`.

---

## Тестовый запрос

### Из командной строки (PowerShell / Windows)

```powershell
curl.exe -s -X POST `
  "https://us-central1-<YOUR_PROJECT_ID>.cloudfunctions.net/museumGuide" `
  -H "Content-Type: application/json" `
  --data-raw "{""data"":{""question"":""Tell me about HAL 9000""}}"
```

### Из командной строки (bash / macOS / Linux)

```bash
curl -s -X POST \
  "https://us-central1-<YOUR_PROJECT_ID>.cloudfunctions.net/museumGuide" \
  -H "Content-Type: application/json" \
  -d '{"data":{"question":"Tell me about HAL 9000"}}'
```

### Ожидаемый ответ

```json
{
  "result": {
    "answer": "HAL 9000 is the sentient computer from Stanley Kubrick's 2001: A Space Odyssey..."
  }
}
```

### Тест текст + аудио (PowerShell)

```powershell
$resp = Invoke-RestMethod `
  -Uri "https://us-central1-<YOUR_PROJECT_ID>.cloudfunctions.net/museumGuideWithAudio" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"data":{"question":"Tell me about HAL 9000"}}'

# Текстовый ответ
$resp.result.answer

# Сохранить аудио в файл
[IO.File]::WriteAllBytes("answer.mp3",
  [Convert]::FromBase64String($resp.result.audioBase64))
```

### Ожидаемый ответ (текст + аудио)

```json
{
  "result": {
    "answer": "HAL 9000 is the sentient computer from...",
    "audioBase64": "<base64-encoded MP3>"
  }
}
```

### Тест голосового гида (PowerShell)

```powershell
# Кодируем любой WAV файл в base64
$audio = [Convert]::ToBase64String([IO.File]::ReadAllBytes("test.wav"))

$body = @{
    data = @{
        audioBase64 = $audio
        language = "en"
    }
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://us-central1-<YOUR_PROJECT_ID>.cloudfunctions.net/museumVoiceGuide" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

### Ожидаемый ответ (голос)

```json
{
  "result": {
    "question": "Tell me about HAL 9000",
    "answer": "HAL 9000 is the sentient computer from...",
    "audioBase64": "<base64-encoded MP3>"
  }
}
```

### Голос TTS (ElevenLabs)

Проект использует кастомный голос ElevenLabs. Voice ID задан
в `index.ts` (константа `ELEVENLABS_VOICE_ID`). Вы можете создать
или клонировать голос на [elevenlabs.io](https://elevenlabs.io)
и заменить ID.

ElevenLabs также позволяет генерировать голос по текстовому описанию
(Voice Design) — без аудиозаписи.

### Просмотр логов

```bash
firebase functions:log --only museumGuide
```

---

## Интеграция с Unity

### 1. Установите Firebase SDK для Unity

- Скачайте [Firebase Unity SDK](https://firebase.google.com/docs/unity/setup)
- Импортируйте пакеты: `FirebaseAuth.unitypackage`, `FirebaseFunctions.unitypackage`
- Добавьте `google-services.json` (Android) / `GoogleService-Info.plist` (iOS) в Assets

### 2. Только текст — `museumGuide` (C#)

Отправить текстовый вопрос, получить текстовый ответ.

```csharp
using Firebase.Functions;
using Firebase.Extensions;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class MuseumGuideText : MonoBehaviour
{
    [SerializeField] private InputField questionInput;
    [SerializeField] private Text answerText;

    private FirebaseFunctions functions;

    private void Start()
    {
        functions = FirebaseFunctions.DefaultInstance;
    }

    public void AskQuestion()
    {
        string question = questionInput.text.Trim();
        if (string.IsNullOrEmpty(question)) return;

        answerText.text = "Думаю...";

        var data = new Dictionary<string, object>
        {
            { "question", question }
        };

        functions
            .GetHttpsCallable("museumGuide")
            .CallAsync(data)
            .ContinueWithOnMainThread(task =>
            {
                if (task.IsFaulted)
                {
                    answerText.text = "Ошибка. Попробуйте позже.";
                    Debug.LogError(task.Exception);
                    return;
                }

                var result = task.Result.Data
                    as IDictionary<string, object>;

                answerText.text = result != null &&
                    result.TryGetValue("answer", out var ans)
                    ? ans.ToString()
                    : "Нет ответа.";
            });
    }
}
```

### 3. Текст + аудио — `museumGuideWithAudio` (C#)

Отправить текстовый вопрос, получить текстовый ответ **и** MP3-аудио.

```csharp
using Firebase.Functions;
using Firebase.Extensions;
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

public class MuseumGuideWithAudio : MonoBehaviour
{
    [SerializeField] private InputField questionInput;
    [SerializeField] private Text answerText;
    [SerializeField] private AudioSource audioSource;

    private FirebaseFunctions functions;

    private void Start()
    {
        functions = FirebaseFunctions.DefaultInstance;
    }

    public void AskQuestion()
    {
        string question = questionInput.text.Trim();
        if (string.IsNullOrEmpty(question)) return;

        answerText.text = "Думаю...";

        var data = new Dictionary<string, object>
        {
            { "question", question }
        };

        functions
            .GetHttpsCallable("museumGuideWithAudio")
            .CallAsync(data)
            .ContinueWithOnMainThread(task =>
            {
                if (task.IsFaulted)
                {
                    answerText.text = "Ошибка. Попробуйте позже.";
                    Debug.LogError(task.Exception);
                    return;
                }

                var result = task.Result.Data
                    as IDictionary<string, object>;
                if (result == null) return;

                // Показать текстовый ответ
                if (result.TryGetValue("answer", out var ans))
                    answerText.text = ans.ToString();

                // Воспроизвести аудио
                if (result.TryGetValue("audioBase64", out var audio))
                {
                    string base64 = audio.ToString();
                    if (!string.IsNullOrEmpty(base64))
                        StartCoroutine(PlayMp3FromBase64(base64));
                }
            });
    }

    private IEnumerator PlayMp3FromBase64(string base64)
    {
        byte[] mp3Bytes = Convert.FromBase64String(base64);

        string path = System.IO.Path.Combine(
            Application.temporaryCachePath, "guide_answer.mp3");
        System.IO.File.WriteAllBytes(path, mp3Bytes);

        using (var www = UnityWebRequestMultimedia.GetAudioClip(
            "file://" + path, AudioType.MPEG))
        {
            yield return www.SendWebRequest();

            if (www.result == UnityWebRequest.Result.Success)
            {
                audioSource.clip =
                    DownloadHandlerAudioClip.GetContent(www);
                audioSource.Play();
            }
            else
            {
                Debug.LogError("Ошибка воспроизведения: "
                    + www.error);
            }
        }
    }
}
```

### 4. Голос → голос — `museumVoiceGuide` (C#)

Записать речь с микрофона, отправить на сервер, получить текст + аудио ответ.

```csharp
using Firebase.Functions;
using Firebase.Extensions;
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

public class MuseumVoiceGuide : MonoBehaviour
{
    [SerializeField] private Text answerText;
    [SerializeField] private AudioSource audioSource;
    [SerializeField] private Button recordButton;
    [SerializeField] private int recordSeconds = 10;
    [SerializeField] private int sampleRate = 16000;
    [SerializeField] private string language = "en";

    private FirebaseFunctions functions;
    private AudioClip recording;
    private bool isRecording;

    private void Start()
    {
        functions = FirebaseFunctions.DefaultInstance;
    }

    // ── Кнопка: начать/остановить запись ────────────────
    public void ToggleRecording()
    {
        if (!isRecording)
            StartRecording();
        else
            StopAndSend();
    }

    private void StartRecording()
    {
        if (Microphone.devices.Length == 0)
        {
            answerText.text = "Микрофон не найден!";
            return;
        }

        isRecording = true;
        recording = Microphone.Start(
            Microphone.devices[0], false,
            recordSeconds, sampleRate);
        answerText.text = "Запись... нажмите ещё раз для остановки.";
    }

    private void StopAndSend()
    {
        string mic = Microphone.devices[0];
        int position = Microphone.GetPosition(mic);
        Microphone.End(mic);
        isRecording = false;

        float[] samples = new float[position];
        recording.GetData(samples, 0);

        byte[] wav = EncodeToWav(samples, sampleRate);
        string base64 = Convert.ToBase64String(wav);

        answerText.text = "Обработка...";
        StartCoroutine(SendVoiceRequest(base64));
    }

    private IEnumerator SendVoiceRequest(string audioBase64)
    {
        var data = new Dictionary<string, object>
        {
            { "audioBase64", audioBase64 },
            { "language", language }
        };

        var task = functions
            .GetHttpsCallable("museumVoiceGuide")
            .CallAsync(data);

        yield return new WaitUntil(() => task.IsCompleted);

        if (task.IsFaulted)
        {
            answerText.text = "Ошибка. Попробуйте снова.";
            Debug.LogError(task.Exception);
            yield break;
        }

        var result = task.Result.Data
            as IDictionary<string, object>;
        if (result == null) yield break;

        string question = result.ContainsKey("question")
            ? result["question"].ToString() : "";
        string answer = result.ContainsKey("answer")
            ? result["answer"].ToString() : "";
        answerText.text = $"Вопрос: {question}\nОтвет: {answer}";

        if (result.TryGetValue("audioBase64", out var audio))
        {
            string b64 = audio.ToString();
            if (!string.IsNullOrEmpty(b64))
                StartCoroutine(PlayMp3FromBase64(b64));
        }
    }

    // ── WAV encoder (PCM 16-bit mono) ─────────────────────
    private byte[] EncodeToWav(float[] samples, int rate)
    {
        int sampleCount = samples.Length;
        int byteCount = sampleCount * 2;
        byte[] wav = new byte[44 + byteCount];

        System.Text.Encoding.ASCII.GetBytes("RIFF")
            .CopyTo(wav, 0);
        BitConverter.GetBytes(36 + byteCount).CopyTo(wav, 4);
        System.Text.Encoding.ASCII.GetBytes("WAVE")
            .CopyTo(wav, 8);
        System.Text.Encoding.ASCII.GetBytes("fmt ")
            .CopyTo(wav, 12);
        BitConverter.GetBytes(16).CopyTo(wav, 16);
        BitConverter.GetBytes((short)1).CopyTo(wav, 20);
        BitConverter.GetBytes((short)1).CopyTo(wav, 22);
        BitConverter.GetBytes(rate).CopyTo(wav, 24);
        BitConverter.GetBytes(rate * 2).CopyTo(wav, 28);
        BitConverter.GetBytes((short)2).CopyTo(wav, 32);
        BitConverter.GetBytes((short)16).CopyTo(wav, 34);
        System.Text.Encoding.ASCII.GetBytes("data")
            .CopyTo(wav, 36);
        BitConverter.GetBytes(byteCount).CopyTo(wav, 40);

        int offset = 44;
        for (int i = 0; i < sampleCount; i++)
        {
            short s = (short)(Mathf.Clamp(
                samples[i], -1f, 1f) * 32767);
            BitConverter.GetBytes(s).CopyTo(wav, offset);
            offset += 2;
        }
        return wav;
    }

    private IEnumerator PlayMp3FromBase64(string base64)
    {
        byte[] mp3Bytes = Convert.FromBase64String(base64);
        string path = System.IO.Path.Combine(
            Application.temporaryCachePath, "voice_answer.mp3");
        System.IO.File.WriteAllBytes(path, mp3Bytes);

        using (var www = UnityWebRequestMultimedia.GetAudioClip(
            "file://" + path, AudioType.MPEG))
        {
            yield return www.SendWebRequest();
            if (www.result == UnityWebRequest.Result.Success)
            {
                audioSource.clip =
                    DownloadHandlerAudioClip.GetContent(www);
                audioSource.Play();
            }
        }
    }
}
```

### 5. Настройка сцены

1. Создайте Canvas с `InputField`, `Button`, `Text` и `AudioSource`
2. Прикрепите один из скриптов выше к пустому GameObject
3. Свяжите UI-элементы через Inspector
4. Для текста: `Button.OnClick` → `AskQuestion()`
5. Для голоса: `Button.OnClick` → `ToggleRecording()`

### 6. Аутентификация

По умолчанию callable-функции Firebase требуют аутентификацию.
Для быстрого старта включите **анонимную аутентификацию**:

```csharp
using Firebase.Auth;

// В Start() или Awake():
FirebaseAuth.DefaultInstance
    .SignInAnonymouslyAsync()
    .ContinueWithOnMainThread(task =>
    {
        if (task.IsCompleted)
            Debug.Log("Signed in anonymously");
    });
```

В Firebase Console → Authentication → Sign-in method → включите «Anonymous».

---

## Настройка системного промпта

Промпт находится в `functions/src/index.ts` в переменной `SYSTEM_PROMPT`.
Вы можете:
- Изменить тон (формальный / дружелюбный)
- Ограничить длину ответов
- Добавить инструкции по языку
- Запретить выходить за рамки данных музея

## Полезные команды

| Действие                        | Команда                                        |
|---------------------------------|------------------------------------------------|
| Установить зависимости          | `cd functions && npm install`                  |
| Собрать TypeScript              | `cd functions && npm run build`                |
| Линтинг                         | `cd functions && npm run lint`                 |
| Деплой функций                  | `firebase deploy --only functions`             |
| Деплой правил Firestore         | `firebase deploy --only firestore:rules`       |
| Загрузить/обновить экспонаты    | `cd functions && npm run build && node lib/uploadFacts.js` |
| Задать/обновить секрет OpenAI    | `firebase functions:secrets:set MUSEUM_AI`     |
| Задать/обновить секрет ElevenLabs | `firebase functions:secrets:set ELEVENLABS_KEY` |
| Логи функции (текст)            | `firebase functions:log --only museumGuide`    |
| Логи функции (текст+аудио)      | `firebase functions:log --only museumGuideWithAudio` |
| Логи функции (голос)            | `firebase functions:log --only museumVoiceGuide` |
| Эмулятор (локально)             | `cd functions && npm run serve`                |

---

## Стоимость

| Ресурс               | Бесплатный лимит            | Примечание                     |
|-----------------------|-----------------------------|-------------------------------|
| Cloud Functions       | 2 млн вызовов/мес           | Blaze plan                    |
| Firestore reads       | 50 000/день                 | ~117 docs за вызов            |
| OpenAI gpt-4o-mini    | —                           | ~$0.15 / 1M input tokens     |
| OpenAI Whisper (STT)  | —                           | ~$0.006 / минута             |
| ElevenLabs TTS        | —                           | от $5/мес (Starter план)      |
| Secret Manager        | 10 000 обращений/мес        | бесплатно                     |

При ~100 текстовых вопросах в день расход OpenAI ≈ $1–3/мес.  
ElevenLabs Starter ($5/мес) включает ~30 000 символов ≈ 60–150 голосовых ответов.
