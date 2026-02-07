# Museum of Science Fiction — Virtual Guide (Backend)

Serverless-бэкенд для виртуального гида музея научной фантастики.  
Unity-приложение отправляет вопрос → Firebase Cloud Function передаёт его
OpenAI (gpt-4o-mini) вместе с данными об экспонатах → возвращает ответ.

---

## Архитектура

```
Unity App
   │  HTTPS callable
   ▼
Firebase Cloud Function  (museumGuide)
   │  1. Читает экспонаты из Firestore
   │  2. Формирует контекст + системный промпт
   │  3. Вызывает OpenAI API
   ▼
Ответ → Unity UI
```

| Компонент          | Технология                        |
|--------------------|-----------------------------------|
| Cloud Function     | Firebase Functions v2 (Node 24)   |
| База данных        | Cloud Firestore                   |
| AI-модель          | OpenAI gpt-4o-mini                |
| Секреты            | Firebase Secret Manager           |
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
        ├── index.ts                # Cloud Function (museumGuide)
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
firebase use museumai-2a2e6
```

### 3. Задать OpenAI API-ключ

```bash
firebase functions:secrets:set MUSEUM_AI
# Вставьте ваш OpenAI API ключ и нажмите Enter
```

Ключ хранится в Google Secret Manager и доступен только Cloud Function.

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

### Обновить OpenAI ключ

```bash
firebase functions:secrets:set MUSEUM_AI
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
  "https://us-central1-museumai-2a2e6.cloudfunctions.net/museumGuide" `
  -H "Content-Type: application/json" `
  --data-raw "{""data"":{""question"":""Tell me about HAL 9000""}}"
```

### Из командной строки (bash / macOS / Linux)

```bash
curl -s -X POST \
  "https://us-central1-museumai-2a2e6.cloudfunctions.net/museumGuide" \
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

### 2. Код вызова (C#)

```csharp
using Firebase.Functions;
using Firebase.Extensions;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class MuseumGuide : MonoBehaviour
{
    [SerializeField] private InputField questionInput;
    [SerializeField] private Text answerText;

    private FirebaseFunctions functions;

    private void Start()
    {
        functions = FirebaseFunctions.DefaultInstance;
    }

    /// <summary>
    /// Вызывается по нажатию кнопки «Спросить».
    /// </summary>
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
                    answerText.text =
                        "Ошибка. Попробуйте позже.";
                    Debug.LogError(task.Exception);
                    return;
                }

                var result = task.Result.Data
                    as IDictionary<string, object>;

                if (result != null &&
                    result.TryGetValue("answer", out var ans))
                {
                    answerText.text = ans.ToString();
                }
                else
                {
                    answerText.text = "Нет ответа.";
                }
            });
    }
}
```

### 3. Настройка сцены

1. Создайте Canvas с `InputField`, `Button` и `Text`
2. Прикрепите скрипт `MuseumGuide` к пустому GameObject
3. Свяжите UI-элементы через Inspector
4. `Button.OnClick` → `MuseumGuide.AskQuestion()`

### 4. Аутентификация

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
| Задать/обновить секрет          | `firebase functions:secrets:set MUSEUM_AI`     |
| Логи функции                    | `firebase functions:log --only museumGuide`    |
| Эмулятор (локально)             | `cd functions && npm run serve`                |

---

## Стоимость

| Ресурс               | Бесплатный лимит            | Примечание                     |
|-----------------------|-----------------------------|-------------------------------|
| Cloud Functions       | 2 млн вызовов/мес           | Blaze plan                    |
| Firestore reads       | 50 000/день                 | ~117 docs за вызов            |
| OpenAI gpt-4o-mini    | —                           | ~$0.15 / 1M input tokens     |
| Secret Manager        | 10 000 обращений/мес        | бесплатно                     |

При ~100 вопросах в день расход OpenAI ≈ $1–3/мес.
